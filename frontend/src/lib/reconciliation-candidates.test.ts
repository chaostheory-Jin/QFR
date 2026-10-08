import { describe, expect, it } from 'vitest'
import { candidateFocus, rankStatementCandidates } from './reconciliation-candidates'
import { reconcileInvoices, type InvoiceExtraction, type StatementRecord } from './reconciliation'

const invoice: InvoiceExtraction = { documentIndex: 0, fileName: 'faint.jpg', invoiceNumber: 'I100006424O', totalAmount: 500,
  currency: 'AUD', documentType: 'invoice', invoiceNumberBox: [0, 0, 0, 0], totalAmountBox: [0, 0, 0, 0],
  fieldVerification: { invoiceNumberVerified: false, totalAmountVerified: false, arithmeticVerified: false, reason: 'Faint printed text' } }

describe('review-only statement candidates', () => {
  it('offers several ranked choices even when source OCR is unverified, without approving or correcting it', () => {
    const records: StatementRecord[] = [
      { invoiceNumber: 'UNRELATED', amount: 500 }, { invoiceNumber: 'I1000064240', amount: 500 },
      { invoiceNumber: 'I1000064241', amount: 502 }, { invoiceNumber: 'I100006424O', amount: 503 },
    ]
    const before = structuredClone(invoice)
    const candidates = rankStatementCandidates(invoice, records, 'AUD')
    expect(candidates.map(candidate => candidate.statementIndex)).toEqual([3, 1, 0, 2])
    expect(candidates[1].reason).toContain('OCR character confusion')
    expect(candidates[0].reason).toContain('unverified')
    expect(reconcileInvoices([invoice], records, { currency: 'AUD' })[0].matched).toBe(false)
    expect(invoice).toEqual(before)
  })
  it('scans the entire statement and every reference, then caps the visible list at five', () => {
    const records = Array.from({ length: 900 }, (_, index) => ({ invoiceNumber: `OTHER-${index}`, amount: 500, lineIndex: index + 1 }))
    records.push({ invoiceNumber: 'I100006424O', amount: 500, lineIndex: 901 })
    const ranked = rankStatementCandidates(invoice, records, 'AUD')
    expect(ranked).toHaveLength(5)
    expect(ranked[0].statementIndex).toBe(900)
    const secondary = rankStatementCandidates(invoice, [{ invoiceNumber: 'OTHER', identifiers: ['OTHER', invoice.invoiceNumber], amount: 500 }], 'AUD')
    expect(secondary[0].priority).toBe(0)
  })
  it('never conflates identical-looking rows, and can focus a manual choice outside the shortlist', () => {
    const record = { invoiceNumber: invoice.invoiceNumber, amount: 500, lineIndex: 7 }
    const candidates = rankStatementCandidates(invoice, [record, { ...record }], 'AUD')
    expect(candidates.map(candidate => candidate.statementIndex)).toEqual([0, 1])
    expect(candidateFocus(candidates)).toBe(0)
    expect(candidateFocus(candidates, 1)).toBe(1)
    expect(candidateFocus(candidates, 810)).toBe(810)
    expect(candidateFocus([])).toBeNull()
  })
  it('does not invent filler candidates or silently compare incompatible currencies and payment kinds', () => {
    expect(rankStatementCandidates(invoice, [{ invoiceNumber: 'RANDOM', amount: 123 }], 'AUD')).toEqual([])
    expect(rankStatementCandidates(invoice, [{ invoiceNumber: invoice.invoiceNumber, amount: 500, currency: 'USD' }], 'AUD')).toEqual([])
    expect(rankStatementCandidates({ ...invoice, currency: 'USD' }, [{ invoiceNumber: invoice.invoiceNumber, amount: 500 }], 'AUD')).toEqual([])
    expect(rankStatementCandidates(invoice, [{ invoiceNumber: invoice.invoiceNumber, amount: 500, description: 'Payment' }], 'AUD')).toEqual([])
    expect(rankStatementCandidates(invoice, [{ invoiceNumber: invoice.invoiceNumber, amount: -500, description: 'Credit note' }], 'AUD')).toEqual([])
  })
  it('keeps credit direction, unknown fields and differences explicit', () => {
    const credit = { ...invoice, documentType: 'credit_note' as const }
    const candidates = rankStatementCandidates(credit, [{ invoiceNumber: invoice.invoiceNumber, amount: -490, description: 'Credit note' }], 'AUD')
    expect(candidates[0].amountDifference).toBe(-10)
    const unknown = rankStatementCandidates({ ...invoice, currency: 'UNKNOWN', documentType: 'unknown', totalAmount: 0 }, [{ invoiceNumber: invoice.invoiceNumber, amount: 500 }], 'AUD')
    expect(unknown[0].amountDifference).toBeNull()
    expect(unknown[0].reason).toContain('confirm invoice currency')
    expect(unknown[0].reason).toContain('confirm document kind')
  })
  it('suggestions cannot steal an independently verified exact assignment', () => {
    const strong = { ...invoice, documentIndex: 1, invoiceNumber: 'OTHER', fieldVerification: { invoiceNumberVerified: true, totalAmountVerified: true, arithmeticVerified: true, reason: 'Verified' } }
    const records = [{ invoiceNumber: 'OTHER', amount: 500 }]
    expect(rankStatementCandidates(invoice, records, 'AUD')).toHaveLength(1)
    const results = reconcileInvoices([invoice, strong], records, { currency: 'AUD' })
    expect(results.map(result => result.matched)).toEqual([false, true])
  })
})
