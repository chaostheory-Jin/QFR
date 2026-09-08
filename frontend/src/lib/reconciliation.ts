export type BoundingBox = [number, number, number, number]

export type StatementRecord = {
  invoiceNumber: string
  amount: number
  date?: string
  invoiceNumberText?: string
  amountText?: string
  identifiers?: string[]
  description?: string
  rawText?: string
  lineIndex?: number
  page?: number
}

export type FieldVerification = {
  invoiceNumberVerified: boolean
  totalAmountVerified: boolean
  arithmeticVerified: boolean
  reason: string
}

export type InvoiceExtraction = {
  documentIndex: number
  fileName: string
  invoiceNumber: string
  totalAmount: number
  invoiceNumberText?: string
  totalAmountText?: string
  totalAmountLabel?: string
  netAmount?: number | null
  taxAmount?: number | null
  invoiceNumberBox: BoundingBox
  totalAmountBox: BoundingBox
  fieldVerification?: FieldVerification
  recoveredFromStatementLine?: boolean
}

export type MatchMethod = 'exact' | 'ocr_character_recovery' | 'unique_amount' | 'amount_and_fuzzy_id' | 'unmatched'

export type ReconciliationMatch = {
  invoice: InvoiceExtraction
  statementRecord: StatementRecord | null
  method: MatchMethod
  similarity: number
  confidence: number
  matched: boolean
  reason: string
}

export function normaliseInvoiceNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function ocrConfusionKey(value: string): string {
  const normalised = normaliseInvoiceNumber(value)
  let prefix = ''
  let body = normalised
  if (body.startsWith('DI')) {
    prefix = 'DI'
    body = body.slice(2)
  } else if (body.startsWith('D1') || body.startsWith('DL')) {
    prefix = 'DI'
    body = body.slice(2)
  } else if (body.startsWith('I') || body.startsWith('L') || body.startsWith('1')) {
    prefix = 'I'
    body = body.slice(1)
  }
  return prefix + body
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/B/g, '8')
}

export function amountMatches(left: number, right: number, tolerance = 1): boolean {
  return Math.abs(Math.abs(left) - Math.abs(right)) < tolerance
}

export function statementIdentifiers(record: StatementRecord): string[] {
  const values = record.identifiers?.length ? record.identifiers : [record.invoiceNumber]
  return Array.from(new Set(values.map(normaliseInvoiceNumber).filter(Boolean)))
}

function recordSimilarity(invoiceNumber: string, record: StatementRecord): number {
  return Math.max(0, ...statementIdentifiers(record).map((identifier) => invoiceSimilarity(invoiceNumber, identifier)))
}

function levenshtein(left: string, right: string): number {
  if (!left.length) return right.length
  if (!right.length) return left.length

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        substitution,
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

export function invoiceSimilarity(left: string, right: string): number {
  const normalisedLeft = normaliseInvoiceNumber(left)
  const normalisedRight = normaliseInvoiceNumber(right)
  const longest = Math.max(normalisedLeft.length, normalisedRight.length)
  if (!longest) return 1
  return 1 - levenshtein(normalisedLeft, normalisedRight) / longest
}

function closestRecord(invoiceNumber: string, records: StatementRecord[]) {
  return records.reduce<{ record: StatementRecord; similarity: number } | null>((best, record) => {
    const similarity = recordSimilarity(invoiceNumber, record)
    if (!best || similarity > best.similarity) return { record, similarity }
    return best
  }, null)
}

export function reconcileInvoices(
  invoices: InvoiceExtraction[],
  statementRecords: StatementRecord[],
): ReconciliationMatch[] {
  const unused = new Set(statementRecords.map((_, index) => index))

  return invoices.map((invoice) => {
    const available = Array.from(unused, (index) => ({ index, record: statementRecords[index] }))

    if (invoice.fieldVerification && (!invoice.fieldVerification.invoiceNumberVerified || !invoice.fieldVerification.totalAmountVerified)) {
      return {
        invoice,
        statementRecord: null,
        method: 'unmatched' as const,
        similarity: 0,
        confidence: 0,
        matched: false,
        reason: `Extracted evidence was not verified: ${invoice.fieldVerification.reason}`,
      }
    }

    const exact = available.find(({ record }) =>
      statementIdentifiers(record).includes(normaliseInvoiceNumber(invoice.invoiceNumber))
      && amountMatches(record.amount, invoice.totalAmount),
    )

    if (exact) {
      unused.delete(exact.index)
      return {
        invoice,
        statementRecord: exact.record,
        method: invoice.recoveredFromStatementLine ? 'ocr_character_recovery' as const : 'exact' as const,
        similarity: 1,
        confidence: invoice.recoveredFromStatementLine ? 0.97 : 1,
        matched: true,
        reason: invoice.recoveredFromStatementLine
          ? 'Unclear printed digits were resolved against one unique line in the complete statement.'
          : 'Invoice ID and gross amount both match.',
      }
    }

    const recoveredCharacters = available.filter(({ record }) =>
      statementIdentifiers(record).some((identifier) => ocrConfusionKey(identifier) === ocrConfusionKey(invoice.invoiceNumber))
      && amountMatches(record.amount, invoice.totalAmount),
    )

    if (recoveredCharacters.length === 1) {
      const recoveredCharacter = recoveredCharacters[0]
      unused.delete(recoveredCharacter.index)
      return {
        invoice,
        statementRecord: recoveredCharacter.record,
        method: 'ocr_character_recovery' as const,
        similarity: recordSimilarity(invoice.invoiceNumber, recoveredCharacter.record),
        confidence: 0.98,
        matched: true,
        reason: 'A common OCR character confusion was resolved and the gross amount verified.',
      }
    }

    const sameAmount = available.filter(({ record }) => amountMatches(record.amount, invoice.totalAmount))
    if (sameAmount.length === 1) {
      unused.delete(sameAmount[0].index)
      return {
        invoice,
        statementRecord: sameAmount[0].record,
        method: 'unique_amount' as const,
        similarity: recordSimilarity(invoice.invoiceNumber, sameAmount[0].record),
        confidence: 0.94,
        matched: true,
        reason: 'Gross amount occurs once in the statement; OCR invoice ID was recovered.',
      }
    }

    if (sameAmount.length > 1) {
      const ranked = sameAmount
        .map(({ index, record }) => ({ index, record, similarity: recordSimilarity(invoice.invoiceNumber, record) }))
        .sort((left, right) => right.similarity - left.similarity)
      const closest = ranked[0]
      const runnerUp = ranked[1]
      const unambiguous = closest.similarity >= 0.78 && closest.similarity - runnerUp.similarity >= 0.08
      if (unambiguous) {
        const selected = closest
        unused.delete(selected.index)
        return {
          invoice,
          statementRecord: selected.record,
          method: 'amount_and_fuzzy_id' as const,
          similarity: closest.similarity,
          confidence: Math.min(0.93, closest.similarity),
          matched: true,
          reason: 'Amount matched multiple rows; the closest invoice ID resolved the row.',
        }
      }
    }

    const closest = closestRecord(invoice.invoiceNumber, available.map(({ record }) => record))

    return {
      invoice,
      statementRecord: closest?.record ?? null,
      method: 'unmatched' as const,
      similarity: closest?.similarity ?? 0,
      confidence: 0,
      matched: false,
      reason: closest
        ? sameAmount.length > 1
          ? 'Multiple rows share the amount and no invoice ID candidate is clearly better; manual review is required.'
          : 'Closest invoice ID has a different gross amount.'
        : 'No statement row could be matched.',
    }
  })
}

export const RECONCILIATION_METHOD_LABELS: Record<MatchMethod, string> = {
  exact: 'Exact ID + amount',
  ocr_character_recovery: 'OCR character recovery',
  unique_amount: 'Unique amount recovery',
  amount_and_fuzzy_id: 'Fuzzy ID + amount',
  unmatched: 'Needs review',
}
