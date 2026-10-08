import { amountMatches, invoiceSimilarity, normaliseInvoiceNumber, ocrConfusionKey, statementIdentifiers, type InvoiceExtraction, type StatementRecord } from './reconciliation'
import { minorAmount } from './invoice-evidence'

export type StatementCandidate = {
  statementIndex: number
  statementRecord: StatementRecord
  reason: string
  similarity: number
  amountDifference: number | null
  priority: number
}

// Review suggestions only. This intentionally does NOT require OCR verification
// and never changes extracted fields, auto-match gates or row assignments.
export function rankStatementCandidates(invoice: InvoiceExtraction, records: StatementRecord[], currency: string): StatementCandidate[] {
  if (invoice.currency && invoice.currency !== 'UNKNOWN' && invoice.currency !== currency) return []
  const id = normaliseInvoiceNumber(invoice.invoiceNumber)
  const knownKind = invoice.documentType === 'invoice' || invoice.documentType === 'credit_note'
  const signed = invoice.documentType === 'credit_note' ? -invoice.totalAmount : invoice.totalAmount
  const validAmount = knownKind && Number.isFinite(signed) && invoice.totalAmount > 0 && minorAmount(signed, currency) !== null
  return records.flatMap((record, statementIndex): StatementCandidate[] => {
    if ((record.currency && record.currency !== currency) || minorAmount(record.amount, currency) === null) return []
    if (invoice.documentType === 'credit_note' ? record.description !== 'Credit note'
      : invoice.documentType === 'invoice' ? Boolean(record.description && record.description !== 'Sales invoice')
        : Boolean(record.description && !['Sales invoice', 'Credit note'].includes(record.description))) return []
    const identifiers = statementIdentifiers(record)
    const exact = Boolean(id) && identifiers.includes(id)
    const confused = id.length >= 4 && identifiers.some(value => ocrConfusionKey(value) === ocrConfusionKey(id))
    const similarity = Math.max(0, ...identifiers.map(value => invoiceSimilarity(id, value)))
    const sameAmount = validAmount && amountMatches(signed, record.amount, 0, currency)
    // Do not fill the list with arbitrary nearby amounts or short random IDs.
    if (!exact && !confused && !sameAmount && !(id.length >= 6 && similarity >= 0.78)) return []
    const amountDifference = validAmount ? Number((signed - record.amount).toFixed(6)) : null
    const priority = exact && sameAmount ? 0 : exact ? 1 : confused && sameAmount ? 2 : confused ? 3 : sameAmount ? 4 : 5
    const reasons = [exact ? 'Exact extracted ID' : confused ? 'Possible OCR character confusion' : `ID text similarity ${Math.round(similarity * 100)}%`]
    reasons.push(sameAmount ? 'same signed amount' : validAmount ? 'amount differs' : 'amount/direction needs confirmation')
    if (invoice.currency !== currency) reasons.push('confirm invoice currency')
    if (!knownKind) reasons.push('confirm document kind')
    if (!invoice.fieldVerification?.invoiceNumberVerified || !invoice.fieldVerification?.totalAmountVerified) reasons.push('source fields unverified')
    return [{ statementIndex, statementRecord: record, priority, reason: reasons.join(' · '), similarity, amountDifference }]
  }).sort((a, b) => a.priority - b.priority || b.similarity - a.similarity
    || Math.abs(a.amountDifference ?? Infinity) - Math.abs(b.amountDifference ?? Infinity)
    || a.statementIndex - b.statementIndex).slice(0, 5)
}

// Preserve row identity by array position, including duplicate-looking rows.
export function candidateFocus(candidates: StatementCandidate[], selectedIndex?: number | null): number | null {
  return selectedIndex !== undefined && selectedIndex !== null ? selectedIndex : candidates[0]?.statementIndex ?? null
}
