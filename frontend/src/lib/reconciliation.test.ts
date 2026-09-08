import { describe, expect, it } from 'vitest'
import { amountMatches, invoiceSimilarity, normaliseInvoiceNumber, ocrConfusionKey, reconcileInvoices } from './reconciliation'

const box: [number, number, number, number] = [0, 0, 0, 0]

describe('reconciliation matching', () => {
  it('normalises IDs and compares statement signs by absolute amount', () => {
    expect(normaliseInvoiceNumber('di-100 42')).toBe('DI10042')
    expect(amountMatches(-25108709, 25108709)).toBe(true)
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
    expect(result[0].method).toBe('ocr_character_recovery')
    expect(result[0].confidence).toBe(0.97)
  })

  it('does not assign one statement row to two uploaded invoices', () => {
    const invoice = { documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI100', totalAmount: 500, invoiceNumberBox: box, totalAmountBox: box }
    const result = reconcileInvoices([invoice, { ...invoice, documentIndex: 1 }], [{ invoiceNumber: 'DI100', amount: 500 }])
    expect(result.map((item) => item.matched)).toEqual([true, false])
  })

  it('recovers common OCR character confusions only when the amount agrees', () => {
    const result = reconcileInvoices(
      [{ documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'I100006424O', totalAmount: 25108709, invoiceNumberBox: box, totalAmountBox: box }],
      [{ invoiceNumber: 'I1000064240', amount: 25108709 }],
    )
    expect(result[0].method).toBe('ocr_character_recovery')
    expect(result[0].confidence).toBe(0.98)
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
})
