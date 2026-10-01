import { normaliseInvoiceNumber } from './invoice-id'
import { isInvoiceCurrency, minorAmount } from './invoice-evidence'
export { normaliseInvoiceNumber } from './invoice-id'

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
  currency?: string
}

export type FieldVerification = {
  invoiceNumberVerified: boolean
  totalAmountVerified: boolean
  arithmeticVerified: boolean
  arithmeticAvailable?: boolean
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
  currency?: string
  documentType?: 'invoice' | 'credit_note' | 'unknown'
  sourceHash?: string
  sourceModel?: string
  providerTrace?: {
    requestedModel: string; model?: string; responseId?: string; reasoningEffort: string
    tokenUsage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
  }
  imagePreparation?: { pipeline: string; views: Array<{ label: string; width: number; height: number; sha256: string; box: BoundingBox }> }
  ocrEvidence?: { invoiceNumberText: string; invoiceNumberConfidence?: number; totalAmountText: string }
  amountReread?: {
    original: { totalAmount: number; totalAmountText?: string; totalAmountLabel?: string; netAmount?: number | null; taxAmount?: number | null }
    reread?: { totalAmount: number; totalAmountText?: string; totalAmountLabel?: string; netAmount?: number | null; taxAmount?: number | null }
    accepted: boolean; reason: string
    providerModel?: string; providerResponseId?: string
    tokenUsage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
  }
}

export type MatchMethod = 'exact' | 'ocr_character_recovery' | 'unique_amount' | 'amount_and_fuzzy_id' | 'unmatched' | 'amount_mismatch'

export type ReconciliationMatch = {
  invoice: InvoiceExtraction
  statementRecord: StatementRecord | null
  method: MatchMethod
  similarity: number
  confidence: number
  matched: boolean
  reason: string
  status: 'verified_match' | 'amount_mismatch' | 'needs_review' | 'unmatched' | 'invalid_extraction'
  amountDifference: number | null
  candidates: Array<{ statementRecord: StatementRecord; method: MatchMethod; similarity: number; amountDifference: number }>
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

export function amountMatches(left: number, right: number, tolerance = 0, currency = 'UGX'): boolean {
  const a = minorAmount(left, currency)
  const b = minorAmount(right, currency)
  return a !== null && b !== null && Number.isInteger(tolerance) && tolerance >= 0 && Math.abs(a - b) <= tolerance
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
  if (!longest) return 0
  return 1 - levenshtein(normalisedLeft, normalisedRight) / longest
}

export type ReconciliationOptions = { currency?: string; toleranceMinorUnits?: number }

export function reconcileInvoices(
  invoices: InvoiceExtraction[],
  statementRecords: StatementRecord[],
  options: ReconciliationOptions = {},
): ReconciliationMatch[] {
  const currency = options.currency ?? 'UGX'
  const tolerance = options.toleranceMinorUnits ?? 0
  if (!isInvoiceCurrency(currency) || !Number.isInteger(tolerance) || tolerance < 0) throw new Error('Invalid reconciliation currency or minor-unit tolerance.')
  const signedAmount = (invoice: InvoiceExtraction) => invoice.documentType === 'credit_note' ? -invoice.totalAmount : invoice.totalAmount
  const valid = invoices.map(invoice => Number.isFinite(invoice.totalAmount) && invoice.totalAmount > 0
    && minorAmount(invoice.totalAmount, currency) !== null && Boolean(normaliseInvoiceNumber(invoice.invoiceNumber))
    && invoice.recoveredFromStatementLine !== true && invoice.currency === currency
    && (invoice.documentType === 'invoice' || invoice.documentType === 'credit_note')
    && invoice.fieldVerification?.invoiceNumberVerified === true && invoice.fieldVerification?.totalAmountVerified === true)
  const applicable = (invoice: InvoiceExtraction, record: StatementRecord) =>
    (!record.currency || record.currency === currency)
    && Number.isFinite(record.amount)
    && (invoice.documentType === 'credit_note' ? record.description === 'Credit note' : !record.description || record.description === 'Sales invoice')
  const sameId = (invoice: InvoiceExtraction, record: StatementRecord) => statementIdentifiers(record).includes(normaliseInvoiceNumber(invoice.invoiceNumber))
  const sameAmount = (invoice: InvoiceExtraction, record: StatementRecord) => amountMatches(record.amount, signedAmount(invoice), tolerance, currency)
  const idKey = (invoice: InvoiceExtraction) => normaliseInvoiceNumber(invoice.invoiceNumber)
    ? `${invoice.currency}:${invoice.documentType}:${normaliseInvoiceNumber(invoice.invoiceNumber)}` : ''
  const duplicate = invoices.map((invoice, index) => invoices.some((other, otherIndex) => otherIndex !== index
    && ((invoice.sourceHash && invoice.sourceHash === other.sourceHash) || (idKey(invoice) && idKey(invoice) === idKey(other)))))
  const exactEdges = invoices.map((invoice, index) => valid[index]
    ? statementRecords.flatMap((record, position) => applicable(invoice, record) && sameId(invoice, record) && sameAmount(invoice, record) ? [position] : []) : [])
  const claims = new Map<number, number>()
  exactEdges.forEach(edges => edges.forEach(position => claims.set(position, (claims.get(position) ?? 0) + 1)))
  const assignments = exactEdges.map((edges, index) => !duplicate[index] && edges.length === 1 && claims.get(edges[0]) === 1 ? edges[0] : null)
  const reserved = new Set(assignments.filter((value): value is number => value !== null))

  // Only independent, globally unique exact edges are assigned automatically.
  // Weak candidates never consume a row, so upload order cannot steal a later exact match.
  return invoices.map((invoice, index): ReconciliationMatch => {
    const difference = (record: StatementRecord) => Number((signedAmount(invoice) - record.amount).toFixed(6))
    const base = { invoice, similarity: 0, confidence: 0, matched: false, amountDifference: null }
    const position = assignments[index]
    if (position !== null) {
      const record = statementRecords[position]
      return { ...base, statementRecord: record, method: 'exact', status: 'verified_match', matched: true,
        similarity: 1, confidence: 1, amountDifference: difference(record), candidates: [],
        reason: 'Independent invoice evidence, currency, direction, ID and amount agree with one globally unique statement row.' }
    }
    const idRecords = statementRecords.filter(record => applicable(invoice, record) && sameId(invoice, record))
    if (duplicate[index]) {
      return { ...base, statementRecord: null, method: 'unmatched', status: 'needs_review', candidates: [],
        reason: 'Duplicate uploaded bytes or invoice ID require review, including copies with conflicting extraction or failed verification.' }
    }
    if (!valid[index]) {
      return { ...base, statementRecord: null, method: 'unmatched', status: Number.isFinite(invoice.totalAmount) ? 'needs_review' : 'invalid_extraction', candidates: [],
        reason: invoice.recoveredFromStatementLine ? 'Legacy statement-derived correction is not independent invoice evidence.'
          : invoice.currency !== currency ? 'Invoice currency is unknown or differs from the selected statement currency.'
          : 'Extracted evidence was not verified: ' + (invoice.fieldVerification?.reason ?? 'Missing invoice-only verification or document type.') }
    }
    if (exactEdges[index].length) {
      const candidates = exactEdges[index].map(position => ({ statementRecord: statementRecords[position], method: 'exact' as const, similarity: 1, amountDifference: difference(statementRecords[position]) }))
      return { ...base, statementRecord: candidates.length === 1 ? candidates[0].statementRecord : null,
        method: 'exact', status: 'needs_review', similarity: 1, candidates,
        reason: 'Duplicate invoice or statement candidates prevent a unique one-to-one assignment; manual review required.' }
    }
    if (idRecords.length) {
      const candidates = idRecords.map(record => ({ statementRecord: record, method: 'amount_mismatch' as const, similarity: 1, amountDifference: difference(record) }))
      return { ...base, statementRecord: idRecords.length === 1 ? idRecords[0] : null,
        method: 'amount_mismatch', status: 'amount_mismatch', similarity: 1,
        amountDifference: idRecords.length === 1 ? difference(idRecords[0]) : null, candidates,
        reason: 'Printed invoice ID is present, but the original invoice amount differs. Both amounts are preserved; no OCR recovery is claimed.' }
    }
    const available = statementRecords.filter((record, position) => !reserved.has(position) && applicable(invoice, record))
    const amounts = available.filter(record => sameAmount(invoice, record))
    const ocr = amounts.filter(record => statementIdentifiers(record).some(id => ocrConfusionKey(id) === ocrConfusionKey(invoice.invoiceNumber)))
    const candidates = (ocr.length ? ocr : amounts.length ? amounts : available.filter(record => recordSimilarity(invoice.invoiceNumber, record) >= 0.78))
      .map(record => ({ statementRecord: record,
        method: (ocr.length ? 'ocr_character_recovery' : amounts.length === 1 ? 'unique_amount' : 'amount_and_fuzzy_id') as MatchMethod,
        similarity: recordSimilarity(invoice.invoiceNumber, record), amountDifference: difference(record) }))
      .sort((a, b) => b.similarity - a.similarity || (a.statementRecord.lineIndex ?? 0) - (b.statementRecord.lineIndex ?? 0)
        || a.statementRecord.invoiceNumber.localeCompare(b.statementRecord.invoiceNumber))
      .slice(0, 5)
    return { ...base, statementRecord: candidates.length === 1 ? candidates[0].statementRecord : null,
      method: candidates[0]?.method ?? 'unmatched', status: candidates.length ? 'needs_review' : 'unmatched',
      similarity: candidates[0]?.similarity ?? 0, candidates,
      amountDifference: candidates.length === 1 ? candidates[0].amountDifference : null,
      reason: candidates.length ? 'Candidate only: amount or approximate ID similarity is not independent proof of identity. Original invoice fields are unchanged; manual review required.'
        : 'No compatible unassigned statement row was found.' }
  })
}

export const RECONCILIATION_METHOD_LABELS: Record<MatchMethod, string> = {
  exact: 'Exact ID + amount',
  ocr_character_recovery: 'OCR-confusion candidate',
  unique_amount: 'Same-amount candidate',
  amount_and_fuzzy_id: 'Approximate ID candidate',
  unmatched: 'No verified match',
  amount_mismatch: 'ID matches; amount differs',
}
