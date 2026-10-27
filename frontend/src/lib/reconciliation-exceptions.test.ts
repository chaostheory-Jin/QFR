import { describe, expect, it } from 'vitest'
import { reconciliationExceptions, filterExceptions } from './reconciliation-exceptions'
import { reconcileInvoices, type InvoiceExtraction, type StatementRecord } from './reconciliation'
import { decide, type ReconciliationRun, type ReviewDecision } from './reconciliation-review'

const invoice = (id: string, index = 0, amount = 100): InvoiceExtraction => ({ documentIndex: index, fileName: `${index}.pdf`, invoiceNumber: id, totalAmount: amount,
  currency: 'AUD', documentType: 'invoice', invoiceNumberBox: [0, 0, 0, 0], totalAmountBox: [0, 0, 0, 0],
  fieldVerification: { invoiceNumberVerified: true, totalAmountVerified: true, arithmeticVerified: true, reason: 'test' } })
const entries = (invoices: InvoiceExtraction[], statements: StatementRecord[], run: ReconciliationRun | null = null) => reconciliationExceptions(reconcileInvoices(invoices, statements, { currency: 'AUD' }), statements, 'AUD', run)
const makeRun = (invoices: InvoiceExtraction[], statements: StatementRecord[], materiality = 1000): ReconciliationRun => ({ schemaVersion: 1, id: 'test', createdAt: '2026-10-27', revision: 0, sample: true, currency: 'AUD', materiality, invoices, statements, files: [], reviews: {}, history: [] })
const decision: ReviewDecision = { invoiceIndex: 0, invoiceNumber: 'INV-A', amount: 100, currency: 'AUD', documentType: 'invoice', statementIndex: 0, action: 'approve', reason: 'checked', reviewer: 'test', role: 'manager' }

describe('read-only reconciliation exception queues', () => {
  it('classifies exact ID amount differences, including unverified extraction', () => {
    const source = { ...invoice('INV-A'), fieldVerification: undefined }
    const rows = entries([source], [{ invoiceNumber: 'INV-A', amount: 110 }])
    expect(rows[0].kinds).toEqual(['amount'])
    expect(rows[0].matched).toBe(false)
  })
  it('keeps equal-amount, different-ID suggestions unconfirmed', () => {
    const rows = entries([invoice('INV-A')], [{ invoiceNumber: 'INV-B', amount: 100 }])
    expect(rows[0].kinds).toEqual(['identity'])
    expect(rows[0].matched).toBe(false)
  })
  it('counts overlapping categories once per invoice and preserves row identity', () => {
    const rows = entries([invoice('INV-A')], [{ invoiceNumber: 'INV-A', amount: 90 }, { invoiceNumber: 'INV-A', amount: 80 }])
    expect(rows[0].kinds).toEqual(['amount', 'multiple'])
    expect(filterExceptions(rows, 'pending')).toHaveLength(1)
    expect(filterExceptions(rows, 'amount')).toHaveLength(1)
    expect(filterExceptions(rows, 'multiple')).toHaveLength(1)
    expect(filterExceptions(rows, 'shared')).toHaveLength(0)
  })
  it('finds no candidate without inventing a statement assignment', () => {
    const rows = entries([invoice('INV-A')], [{ invoiceNumber: 'OTHER', amount: 900 }])
    expect(rows[0].kinds).toEqual(['missing'])
    expect(rows[0].match.statementRecord).toBeNull()
  })
  it('flags shared exact references even when duplicate uploads prevented automatic matching', () => {
    const rows = entries([invoice('INV-A', 0), invoice('INV-A', 1)], [{ invoiceNumber: 'INV-A', amount: 100 }])
    expect(filterExceptions(rows, 'shared')).toHaveLength(2)
    expect(rows.every(row => !row.matched && row.sharedLines[0] === 0)).toBe(true)
  })
  it('does not label shared weak same-amount suggestions as actual claims', () => {
    const rows = entries([invoice('INV-A', 0), invoice('INV-B', 1)], [{ invoiceNumber: 'OTHER', amount: 100 }])
    expect(filterExceptions(rows, 'identity')).toHaveLength(2)
    expect(filterExceptions(rows, 'shared')).toHaveLength(0)
  })
  it('examines all lines, including conflicts beyond the five visible candidates', () => {
    const statements = Array.from({ length: 6 }, (_, i) => ({ invoiceNumber: 'INV-A', identifiers: i === 5 ? ['INV-A', 'INV-B'] : ['INV-A'], amount: 100, lineIndex: i + 1 }))
    const rows = entries([invoice('INV-A', 0), invoice('INV-B', 1)], statements)
    expect(rows[0].candidates).toHaveLength(6)
    expect(filterExceptions(rows, 'shared')).toHaveLength(2)
    expect(rows[0].sharedLines).toContain(5)
  })
  it('keeps verification and manager-only work in Other review, not confirmed', () => {
    const source = invoice('INV-A'), statements = [{ invoiceNumber: 'INV-A', amount: 100 }]
    expect(entries([{ ...source, fieldVerification: undefined }], statements)[0].kinds).toEqual(['other'])
    const run = makeRun([source], statements, 100)
    expect(entries([source], statements, run)[0]).toMatchObject({ status: 'needs_manager', matched: false, kinds: ['other'] })
  })
  it('removes completed approvals and rejections from pending but keeps them in all results', () => {
    const sources = [invoice('INV-A')], statements = [{ invoiceNumber: 'INV-A', amount: 100 }]
    const run = makeRun(sources, statements)
    run.reviews['0'] = decide(run, decision)
    expect(filterExceptions(entries(sources, statements, run), 'pending')).toEqual([])
    run.reviews['0'] = decide(run, { ...decision, action: 'reject', statementIndex: null })
    const rows = entries(sources, statements, run)
    expect(filterExceptions(rows, 'pending')).toEqual([])
    expect(filterExceptions(rows, 'all')[0]).toMatchObject({ status: 'rejected', matched: false })
  })
  it('retains approved variances as variances, never converts them to matched', () => {
    const sources = [invoice('INV-A')], statements = [{ invoiceNumber: 'INV-A', amount: 90 }]
    const run = makeRun(sources, statements)
    run.reviews['0'] = decide(run, decision)
    expect(entries(sources, statements, run)[0]).toMatchObject({ status: 'approved_variance', pending: false, matched: false, kinds: [] })
  })
  it('uses saved pending review fields without mutating the invoice or run', () => {
    const sources = [invoice('INV-A')], statements = [{ invoiceNumber: 'INV-B', amount: 100 }]
    const run = makeRun(sources, statements, 100)
    run.reviews['0'] = decide(run, { ...decision, invoiceNumber: 'INV-B', role: 'finance' })
    const before = structuredClone(run)
    const rows = entries(sources, statements, run)
    expect(rows[0]).toMatchObject({ status: 'needs_manager', usesReviewedFields: true, kinds: ['other'] })
    expect(run).toEqual(before)
    expect(rows[0].match.invoice.invoiceNumber).toBe('INV-A')
  })
  it('respects currency, document direction, and zero-value uncertainty', () => {
    const source = invoice('INV-A')
    expect(entries([{ ...source, currency: 'USD' }], [{ invoiceNumber: 'INV-A', amount: 100 }])[0].kinds).toEqual(['missing'])
    expect(entries([{ ...source, currency: 'UNKNOWN' }], [{ invoiceNumber: 'INV-B', amount: 100 }])[0].kinds).toEqual(['other'])
    expect(entries([{ ...source, documentType: 'credit_note' }], [{ invoiceNumber: 'INV-A', amount: -90, description: 'Credit note' }])[0].kinds).toEqual(['amount'])
    expect(entries([source], [{ invoiceNumber: 'INV-A', amount: 100, description: 'Payment' }])[0].kinds).toEqual(['missing'])
    expect(entries([{ ...source, totalAmount: 0 }], [{ invoiceNumber: 'INV-A', amount: 100 }])[0].kinds).toEqual(['other'])
  })
})
