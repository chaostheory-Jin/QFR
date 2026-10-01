import { describe, expect, it } from 'vitest'
import { applyAmountReread } from './invoice-amount-reread'
import { verifyInvoice } from './invoice-evidence'
import type { InvoiceExtraction } from './reconciliation'

const original: InvoiceExtraction = verifyInvoice({ documentIndex: 2, fileName: 'scan.jpg', invoiceNumber: 'DI100', invoiceNumberText: 'DI100',
  totalAmount: 498, totalAmountText: '498', totalAmountLabel: 'Gross Amount Payable', netAmount: 400, taxAmount: 100,
  currency: 'UGX', documentType: 'invoice', invoiceNumberBox: [0,0,0,0], totalAmountBox: [0,0,0,0] })
const read = { totalAmount: 500, totalAmountText: '500', totalAmountLabel: 'Gross Amount Payable', netAmount: 400, taxAmount: 100 }

describe('independent invoice-only totals reread', () => {
  it('accepts direct printed evidence while retaining the first extraction and its ID', () => {
    const snapshot = JSON.stringify(original)
    const result = applyAmountReread(original, read)
    expect(result.totalAmount).toBe(500)
    expect(result.invoiceNumber).toBe('DI100')
    expect(result.documentIndex).toBe(2)
    expect(result.fieldVerification?.invoiceNumberVerified).toBe(false)
    expect(result.fieldVerification?.totalAmountVerified).toBe(false)
    expect(result.amountReread).toMatchObject({ accepted: true, original: { totalAmount: 498 }, reread: { totalAmount: 500 } })
    expect(JSON.stringify(original)).toBe(snapshot)
  })
  it('rejects inconsistent, missing, conflicting-OCR or nonfinal rereads without calculating replacement totals', () => {
    for (const patch of [{ totalAmount: 501 }, { totalAmountText: '' }, { netAmount: null }, { totalAmountLabel: 'Net Amount' }]) {
      const result = applyAmountReread(original, { ...read, ...patch })
      expect(result.totalAmount).toBe(498)
      expect(result.amountReread?.accepted).toBe(false)
    }
    expect(applyAmountReread({ ...original, ocrEvidence: { invoiceNumberText: '', totalAmountText: '499' } }, read).totalAmount).toBe(498)
  })
  it('rejects schema/type errors and never silently verifies disagreement with the first reading', () => {
    for (const response of [null, [], { ...read, extra: 1 }, { ...read, totalAmount: '500' }, { ...read, totalAmount: Infinity }]) {
      expect(() => applyAmountReread(original, response)).toThrow()
    }
    const verified = verifyInvoice({ ...original, totalAmount: 500, totalAmountText: '500' })
    const result = applyAmountReread(verified, { ...read, totalAmount: 600, totalAmountText: '600', netAmount: 500 })
    expect(result.totalAmount).toBe(600)
    expect(result.fieldVerification?.totalAmountVerified).toBe(false)
    expect(result.amountReread?.original.totalAmount).toBe(500)
  })
})
