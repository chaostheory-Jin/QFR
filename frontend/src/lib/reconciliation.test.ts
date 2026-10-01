import { describe, expect, it } from 'vitest'
import { amountMatches, invoiceSimilarity, normaliseInvoiceNumber, ocrConfusionKey, reconcileInvoices as matchInvoices, type InvoiceExtraction, type StatementRecord } from './reconciliation'
import { verifyInvoice } from './invoice-evidence'

const box: [number, number, number, number] = [0, 0, 0, 0]

function reconcileInvoices(invoices: InvoiceExtraction[], records: StatementRecord[]) {
  return matchInvoices(invoices.map(invoice => {
    const withEvidence = { currency: 'UGX', documentType: 'invoice' as const, invoiceNumberText: invoice.invoiceNumber,
      totalAmountText: String(invoice.totalAmount), totalAmountLabel: 'Gross Amount Payable',
      ocrEvidence: { invoiceNumberText: invoice.invoiceNumber, invoiceNumberConfidence: 1, totalAmountText: String(invoice.totalAmount) }, ...invoice }
    return { ...verifyInvoice(withEvidence), ...(invoice.fieldVerification ? { fieldVerification: invoice.fieldVerification } : {}) }
  }), records)
}

describe('reconciliation matching', () => {
  it('keeps exact statement agreement in review when ID evidence is only a model echo', () => {
    const invoice = verifyInvoice({ documentIndex: 0, fileName: 'faint.jpg', invoiceNumber: 'DI100', invoiceNumberText: 'DI100',
      totalAmount: 500, totalAmountText: '500', totalAmountLabel: 'Total', currency: 'UGX', documentType: 'invoice',
      invoiceNumberBox: box, totalAmountBox: box })
    const [decision] = matchInvoices([invoice], [{ invoiceNumber: 'DI100', amount: 500 }])
    expect(decision.matched).toBe(false)
    expect(decision.status).toBe('needs_review')
    expect(decision.invoice.invoiceNumber).toBe('DI100')
  })
  it('normalises IDs without discarding transaction direction', () => {
    expect(normaliseInvoiceNumber('di-100 42')).toBe('DI10042')
    expect(amountMatches(-25108709, 25108709)).toBe(false)
    expect(amountMatches(25108709, 25108709)).toBe(true)
    expect(amountMatches(100, 100.01, 0, 'USD')).toBe(false)
    expect(amountMatches(100, 100.01, 1, 'USD')).toBe(true)
    expect(amountMatches(100, 100.001, 0, 'USD')).toBe(false)
    expect(invoiceSimilarity('', '')).toBe(0)
    expect(invoiceSimilarity('DI1000045981', 'DI100004598I')).toBeGreaterThan(0.9)
    expect(ocrConfusionKey('I100006424O')).toBe(ocrConfusionKey('I1000064240'))
  })

  it('matches exact IDs before using unique amounts', () => {
    const result = reconcileInvoices(
      [{ documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI1000045981', totalAmount: 25108709, invoiceNumberBox: box, totalAmountBox: box }],
      [
        { invoiceNumber: 'DI1000045981', amount: 25108709 },
        { invoiceNumber: 'I1000064240', amount: 25108709 },
      ],
    )
    expect(result[0].method).toBe('exact')
    expect(result[0].matched).toBe(true)
  })

  it('finds the target identifier anywhere in the complete statement line', () => {
    const result = reconcileInvoices(
      [{ documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI1000045981', totalAmount: 25108709, invoiceNumberBox: box, totalAmountBox: box }],
      [{
        invoiceNumber: 'I1000064240',
        identifiers: ['I1000064240', 'DI1000045981'],
        amount: 25108709,
        description: 'Sales invoice',
        lineIndex: 810,
      }],
    )
    expect(result[0].method).toBe('exact')
    expect(result[0].statementRecord?.lineIndex).toBe(810)
  })

  it('keeps statement-assisted OCR recovery visible in the audit result', () => {
    const result = reconcileInvoices(
      [{
        documentIndex: 0,
        fileName: 'invoice.jpg',
        invoiceNumber: 'DI1000045981',
        totalAmount: 25108709,
        invoiceNumberBox: box,
        totalAmountBox: box,
        recoveredFromStatementLine: true,
      }],
      [{ invoiceNumber: 'I1000064240', identifiers: ['I1000064240', 'DI1000045981'], amount: 25108709 }],
    )
    expect(result[0].matched).toBe(false)
    expect(result[0].reason).toContain('not independent')
  })

  it('does not assign one statement row to two uploaded invoices', () => {
    const invoice = { documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI100', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }
    const result = reconcileInvoices([invoice, { ...invoice, documentIndex: 1 }], [{ invoiceNumber: 'DI100', amount: 500 }])
    expect(result.map((item) => item.matched)).toEqual([false, false])
  })

  it('does not hide a duplicate copy just because its verification failed', () => {
    const invoice = { documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI100', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }
    const result = reconcileInvoices([invoice, { ...invoice, documentIndex: 1, totalAmount: 501, fieldVerification: { invoiceNumberVerified: true, totalAmountVerified: false, arithmeticVerified: false, reason: 'conflicting copy' } }], [{ invoiceNumber: 'DI100', amount: 500 }])
    expect(result.every(item => !item.matched && item.status === 'needs_review')).toBe(true)
  })

  it('shows OCR character confusions as candidates, not verified identities', () => {
    const result = reconcileInvoices(
      [{ documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'I100006424O', totalAmount: 25108709, invoiceNumberBox: box, totalAmountBox: box }],
      [{ invoiceNumber: 'I1000064240', amount: 25108709 }],
    )
    expect(result[0].method).toBe('ocr_character_recovery')
    expect(result[0].confidence).toBe(0)
    expect(result[0].matched).toBe(false)
    expect(result[0].invoice.invoiceNumber).toBe('I100006424O')
  })

  it('does not pick the first row when OCR normalisation produces more than one candidate', () => {
    const result = reconcileInvoices(
      [{ documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'I10O', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }],
      [{ invoiceNumber: 'I100', amount: 500 }, { invoiceNumber: 'I1OO', amount: 500 }],
    )
    expect(result[0].matched).toBe(false)
    expect(result[0].confidence).toBe(0)
  })

  it('sends unresolved duplicate-amount candidates to review instead of guessing', () => {
    const result = reconcileInvoices(
      [{ documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'I1000', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }],
      [{ invoiceNumber: 'I1001', amount: 500 }, { invoiceNumber: 'I1002', amount: 500 }],
    )
    expect(result[0].matched).toBe(false)
    expect(result[0].confidence).toBe(0)
  })

  it('never auto-matches fields that failed printed-evidence verification', () => {
    const result = reconcileInvoices(
      [{
        documentIndex: 0,
        fileName: 'invoice.jpg',
        invoiceNumber: 'DI100',
        totalAmount: 500,
        invoiceNumberBox: box,
        totalAmountBox: box,
        fieldVerification: { invoiceNumberVerified: true, totalAmountVerified: false, arithmeticVerified: false, reason: 'net amount selected' },
      }],
      [{ invoiceNumber: 'DI100', amount: 500 }],
    )
    expect(result[0].matched).toBe(false)
    expect(result[0].reason).toContain('not verified')
  })

  it('keeps genuine amount differences inside the old recovery tolerance', () => {
    const original = { documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI100', totalAmount: 25108700, invoiceNumberBox: box, totalAmountBox: box }
    const [result] = reconcileInvoices([original], [{ invoiceNumber: 'DI100', amount: 25108709 }])
    expect(result.status).toBe('amount_mismatch')
    expect(result.amountDifference).toBe(-9)
    expect(result.invoice.totalAmount).toBe(25108700)
    expect(original.totalAmount).toBe(25108700)
  })
  it('never uses a unique amount as proof of invoice identity', () => {
    const [result] = reconcileInvoices([{ documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI999', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }], [{ invoiceNumber: 'DI100', amount: 500 }])
    expect(result.method).toBe('unique_amount')
    expect(result.status).toBe('needs_review')
    expect(result.matched).toBe(false)
  })
  it('does not let a weak candidate steal a later exact row, independent of upload order', () => {
    const weak = { documentIndex: 0, fileName: 'weak.jpg', invoiceNumber: 'DI999', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }
    const strong = { ...weak, documentIndex: 1, fileName: 'strong.jpg', invoiceNumber: 'DI100' }
    const records = [{ invoiceNumber: 'DI100', amount: 500 }]
    const forward = reconcileInvoices([weak, strong], records)
    const reverse = reconcileInvoices([strong, weak], records)
    expect(forward[1].matched).toBe(true)
    expect(forward[0].matched).toBe(false)
    expect(reverse[0].status).toBe(forward[1].status)
    expect(reverse[1].status).toBe(forward[0].status)
  })
  it('refuses to choose the first identical statement record', () => {
    const original = { documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI100', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }
    const [result] = reconcileInvoices([original], [{ invoiceNumber: 'DI100', amount: 500 }, { invoiceNumber: 'DI100', amount: 500 }])
    expect(result.matched).toBe(false)
    expect(result.candidates).toHaveLength(2)
  })
  it('does not match a sales invoice against a payment or credit line with the same reference', () => {
    const original = { documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI100', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }
    const [result] = reconcileInvoices([original], [{ invoiceNumber: 'DI100', amount: 500, description: 'Payment' }, { invoiceNumber: 'DI100', amount: -500, description: 'Credit note' }])
    expect(result.matched).toBe(false)
  })
  it('handles credit-note direction explicitly, preserving its printed face value', () => {
    const original = { documentIndex: 0, fileName: 'credit.jpg', invoiceNumber: 'C100', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box,
      documentType: 'credit_note' as const, totalAmountLabel: 'Total credit' }
    const [result] = reconcileInvoices([original], [{ invoiceNumber: 'C100', amount: -500, description: 'Credit note' }])
    expect(result.matched).toBe(true)
    expect(result.invoice.totalAmount).toBe(500)
  })
})
