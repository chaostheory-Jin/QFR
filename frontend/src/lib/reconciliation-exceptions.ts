import { allStatementCandidates } from './reconciliation-candidates'
import type { ReconciliationMatch, StatementRecord } from './reconciliation'
import { reviewedResults, type ReconciliationRun } from './reconciliation-review'

export const EXCEPTION_TYPES = [
  { id: 'amount', label: 'Amount mismatch', description: 'Same ID, different signed amount.' },
  { id: 'identity', label: 'Possible ID issue', description: 'Same amount, different ID. OCR error is only a possibility.' },
  { id: 'multiple', label: 'Multiple candidates', description: 'More than one related statement line needs checking.' },
  { id: 'missing', label: 'No candidate found', description: 'No compatible candidate under the current matching rules.' },
  { id: 'shared', label: 'Shared statement line', description: 'Multiple invoices reference the same line. Check the assignment.' },
] as const
export type ExceptionKind = typeof EXCEPTION_TYPES[number]['id'] | 'other'
export type ExceptionFilter = ExceptionKind | 'pending' | 'all'

/** Read-only triage. Candidate suggestions never change matching or approval decisions. */
export function reconciliationExceptions(matches: ReconciliationMatch[], records: StatementRecord[], currency: string, run: ReconciliationRun | null) {
  const reviewed = new Map(run ? reviewedResults(run).map(result => [result.original.documentIndex, result]) : [])
  const entries = matches.map(match => {
    const result = reviewed.get(match.invoice.documentIndex)
    const decision = result?.review
    const evidence = decision && decision.action === 'approve' ? { ...match.invoice, invoiceNumber: decision.invoiceNumber,
      totalAmount: decision.amount, currency: decision.currency, documentType: decision.documentType } : match.invoice
    const candidates = allStatementCandidates(evidence, records, currency)
    const status = result?.status ?? (match.matched ? 'automatic_match' : 'needs_review')
    const pending = ['needs_review', 'needs_manager', 'archive_pending'].includes(status)
    // Exact references and saved positive assignments are claims; weak amount-only
    // suggestions are not claims and must not manufacture duplicate-assignment alerts.
    const references = decision ? decision.action === 'approve' && decision.statementIndex !== null ? [decision.statementIndex] : []
      : candidates.filter(candidate => candidate.priority <= 1).map(candidate => candidate.statementIndex)
    return { match, status, pending, matched: result?.matched ?? match.matched, candidates, references,
      comparableCurrency: evidence.currency === currency, usesReviewedFields: decision?.action === 'approve' }
  })
  const claims = new Map<number, Set<number>>()
  for (const entry of entries) for (const index of entry.references) {
    const owners = claims.get(index) ?? new Set<number>()
    owners.add(entry.match.invoice.documentIndex); claims.set(index, owners)
  }
  return entries.map(entry => {
    const kinds: ExceptionKind[] = []
    const sharedLines = entry.references.filter(index => (claims.get(index)?.size ?? 0) > 1)
    if (entry.pending) {
      if (entry.comparableCurrency && entry.candidates.some(candidate => candidate.priority === 1 && candidate.amountDifference !== null && candidate.amountDifference !== 0)) kinds.push('amount')
      if (entry.comparableCurrency && entry.candidates.some(candidate => candidate.priority > 1 && candidate.amountDifference === 0)) kinds.push('identity')
      if (entry.candidates.length > 1) kinds.push('multiple')
      if (!entry.candidates.length) kinds.push('missing')
      if (sharedLines.length) kinds.push('shared')
      if (!kinds.length) kinds.push('other')
    }
    return { ...entry, kinds, sharedLines }
  })
}
export type ExceptionEntry = ReturnType<typeof reconciliationExceptions>[number]
export function filterExceptions(entries: ExceptionEntry[], filter: ExceptionFilter) {
  return entries.filter(entry => filter === 'all' || (filter === 'pending' ? entry.pending : entry.kinds.includes(filter)))
}
