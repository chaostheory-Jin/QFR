import { reconcileInvoices, normaliseInvoiceNumber, statementIdentifiers, type InvoiceExtraction, type StatementRecord } from './reconciliation'
import { isInvoiceCurrency, minorAmount } from './invoice-evidence'

export type ReviewDecision = {
  invoiceIndex: number; invoiceNumber: string; amount: number; currency: string; documentType: 'invoice' | 'credit_note'
  statementIndex: number | null; action: 'approve' | 'reject'; reason: string; reviewer: string; role: 'finance' | 'manager'
}
export type SavedDecision = ReviewDecision & { revision: number; updatedAt: string; status: 'approved' | 'rejected' | 'needs_manager'; difference: number | null; identityMatches: boolean }
export type EvidenceFile = { index: number; name: string; sha256: string; mime: string; archived: boolean }
export type ReconciliationRun = {
  schemaVersion: 1; id: string; createdAt: string; sample: boolean; currency: string; materiality: number; revision: number
  invoices: InvoiceExtraction[]; statements: StatementRecord[]; files: EvidenceFile[]
  reviews: Record<string, SavedDecision>; history: Array<{ before: SavedDecision | null; after: SavedDecision }>
}
export function validateRunInput(value: unknown): Omit<ReconciliationRun, 'id' | 'createdAt' | 'schemaVersion' | 'revision' | 'reviews' | 'history'> {
  if (!value || typeof value !== 'object') throw new Error('Invalid reconciliation snapshot.')
  const input = value as Record<string, unknown>
  if (typeof input.sample !== 'boolean' || typeof input.currency !== 'string' || !isInvoiceCurrency(input.currency)
    || typeof input.materiality !== 'number' || input.materiality < 0 || minorAmount(input.materiality, input.currency) === null) throw new Error('Set a nonnegative materiality threshold in statement currency.')
  if (!Array.isArray(input.invoices) || !input.invoices.length || input.invoices.length > 12 || !Array.isArray(input.statements) || input.statements.length > 10000 || !Array.isArray(input.files)) throw new Error('Invalid snapshot record counts.')
  const indices = new Set<number>()
  input.invoices.forEach((invoice: InvoiceExtraction) => {
    if (!invoice || !Number.isInteger(invoice.documentIndex) || invoice.documentIndex < 0 || invoice.documentIndex >= (input.invoices as unknown[]).length || indices.has(invoice.documentIndex)) throw new Error('Invalid document index.')
    indices.add(invoice.documentIndex)
    if (typeof invoice.fileName !== 'string' || invoice.fileName.length > 512 || typeof invoice.invoiceNumber !== 'string' || invoice.invoiceNumber.length > 256
      || typeof invoice.totalAmount !== 'number' || !Number.isFinite(invoice.totalAmount) || invoice.totalAmount < 0 || invoice.totalAmount > 1e12
      || typeof invoice.currency !== 'string' || (invoice.currency !== 'UNKNOWN' && !isInvoiceCurrency(invoice.currency)) || !['invoice', 'credit_note', 'unknown'].includes(invoice.documentType ?? '')) throw new Error('Invalid extracted invoice fields.')
    for (const box of [invoice.invoiceNumberBox, invoice.totalAmountBox]) if (!Array.isArray(box) || box.length !== 4 || box.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1000) || box[2] < box[0] || box[3] < box[1]) throw new Error('Invalid evidence box.')
    if (invoice.fieldVerification && (['invoiceNumberVerified', 'totalAmountVerified', 'arithmeticVerified'] as const).some(key => typeof invoice.fieldVerification![key] !== 'boolean')) throw new Error('Invalid field verification.')
  })
  input.statements.forEach((record: StatementRecord) => {
    if (!record || typeof record.invoiceNumber !== 'string' || typeof record.amount !== 'number' || !Number.isFinite(record.amount) || minorAmount(record.amount, input.currency as string) === null
      || (record.identifiers !== undefined && (!Array.isArray(record.identifiers) || record.identifiers.some(id => typeof id !== 'string')))
      || (record.currency !== undefined && record.currency !== input.currency)) throw new Error('Invalid statement fields or currency.')
  })
  if (input.sample && input.files.length) throw new Error('Sample runs cannot contain customer evidence files.')
  if (!input.sample && input.files.length !== input.invoices.length + 1) throw new Error('Archive one statement and every invoice original.')
  const fileIndices = new Set<number>()
  const files = input.files.map((file: EvidenceFile) => {
    if (!file || !Number.isInteger(file.index) || file.index < -1 || file.index >= (input.invoices as unknown[]).length || fileIndices.has(file.index)
      || typeof file.name !== 'string' || file.name.length > 512 || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.mime !== 'string') throw new Error('Invalid original file manifest.')
    fileIndices.add(file.index)
    const invoice = (input.invoices as InvoiceExtraction[]).find(invoice => invoice.documentIndex === file.index)
    if (invoice && (file.name !== invoice.fileName || (invoice.sourceHash && invoice.sourceHash !== file.sha256))) throw new Error('Original manifest differs from the extracted invoice evidence.')
    return { ...file, archived: false }
  })
  return { sample: input.sample, currency: input.currency, materiality: input.materiality, invoices: input.invoices as InvoiceExtraction[], statements: input.statements as StatementRecord[], files }
}
export function validateDecision(value: unknown, run: ReconciliationRun): ReviewDecision {
  if (!value || typeof value !== 'object') throw new Error('Invalid review decision.')
  const decision = value as ReviewDecision
  if (!Number.isInteger(decision.invoiceIndex) || !run.invoices.some(invoice => invoice.documentIndex === decision.invoiceIndex)
    || typeof decision.invoiceNumber !== 'string' || decision.invoiceNumber.length > 256
    || typeof decision.amount !== 'number' || decision.amount < 0 || decision.amount > 1e12 || minorAmount(decision.amount, run.currency) === null
    || (decision.action === 'approve' && (!decision.invoiceNumber.trim() || decision.amount === 0))
    || decision.currency !== run.currency || !['invoice', 'credit_note'].includes(decision.documentType)
    || !['approve', 'reject'].includes(decision.action) || !['finance', 'manager'].includes(decision.role)
    || typeof decision.reviewer !== 'string' || !decision.reviewer.trim() || decision.reviewer.length > 120
    || typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.length > 2000) throw new Error('Provide valid confirmed fields, reviewer, role and reason.')
  if (decision.statementIndex !== null && (!Number.isInteger(decision.statementIndex) || decision.statementIndex < 0 || decision.statementIndex >= run.statements.length)) throw new Error('Invalid candidate selection.')
  if (decision.action === 'approve' && decision.statementIndex === null) throw new Error('Select a statement row before approving.')
  return { invoiceIndex: decision.invoiceIndex, invoiceNumber: decision.invoiceNumber.trim(), amount: decision.amount, currency: decision.currency, documentType: decision.documentType,
    statementIndex: decision.statementIndex, action: decision.action, reason: decision.reason.trim(), reviewer: decision.reviewer.trim(), role: decision.role }
}
export function decide(run: ReconciliationRun, decision: ReviewDecision): SavedDecision {
  if (!run.sample && run.files.some(file => !file.archived)) throw new Error('Archive all original files before approving or rejecting evidence.')
  const record = decision.statementIndex === null ? null : run.statements[decision.statementIndex]
  const signed = decision.documentType === 'credit_note' ? -decision.amount : decision.amount
  const difference = record ? (minorAmount(signed, run.currency)! - minorAmount(record.amount, run.currency)!) / 10 ** (new Intl.NumberFormat('en', { style: 'currency', currency: run.currency }).resolvedOptions().maximumFractionDigits ?? 2) : null
  const original = run.invoices.find(invoice => invoice.documentIndex === decision.invoiceIndex)!
  const material = Math.max(Math.abs(original.totalAmount), decision.amount, Math.abs(record?.amount ?? 0)) >= run.materiality
  const status = decision.action === 'reject' ? 'rejected' : material && decision.role !== 'manager' ? 'needs_manager' : 'approved'
  if (decision.action === 'approve' && record) {
    if (decision.documentType === 'credit_note' ? record.description !== 'Credit note' : record.description && record.description !== 'Sales invoice') throw new Error('Selected statement row is not the same document kind.')
    const baseline = reconcileInvoices(run.invoices, run.statements, { currency: run.currency })
    for (const invoice of run.invoices) {
      if (invoice.documentIndex === decision.invoiceIndex) continue
      const review = run.reviews[String(invoice.documentIndex)]
      const occupied = review ? review.action === 'approve' && review.statementIndex === decision.statementIndex
        : baseline.find(match => match.invoice.documentIndex === invoice.documentIndex)?.statementRecord === record
      if (occupied) throw new Error('Statement row already assigned to another invoice. Reject that assignment first.')
    }
  }
  return { ...decision, revision: (run.reviews[String(decision.invoiceIndex)]?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), status, difference,
    identityMatches: record ? statementIdentifiers(record).includes(normaliseInvoiceNumber(decision.invoiceNumber)) : false }
}
export function reviewedResults(run: ReconciliationRun) {
  const originalsArchived = run.sample || run.files.every(file => file.archived)
  return reconcileInvoices(run.invoices, run.statements, { currency: run.currency }).map(match => {
    const review = run.reviews[String(match.invoice.documentIndex)]
    const record = review ? review.statementIndex === null ? null : run.statements[review.statementIndex] : match.statementRecord
    const material = Math.max(match.invoice.totalAmount, Math.abs(record?.amount ?? 0)) >= run.materiality
    const status = review ? review.status === 'approved' && (review.difference !== 0 || !review.identityMatches) ? 'approved_variance' : review.status
      : !originalsArchived ? 'archive_pending' : material ? 'needs_manager' : match.matched ? 'automatic_match' : 'needs_review'
    return { original: match.invoice, baseline: match, review: review ?? null, statementRecord: record, status,
      matched: originalsArchived && (review ? review.status === 'approved' && review.difference === 0 && review.identityMatches : match.matched && !material),
      difference: review ? review.difference : match.amountDifference }
  })
}
