import { describe, expect, it } from 'vitest'
import { validateExtraction, verifyInvoice, parsePrintedAmount, type ModelInvoice } from './invoice-evidence'

const model: ModelInvoice = { documentIndex: 0, fileName: 'invoice.jpg', invoiceNumber: 'DI100', invoiceNumberText: 'DI-100',
  totalAmount: 500, totalAmountText: '500,00', totalAmountLabel: 'Gross Amount Payable', netAmount: 400, taxAmount: 100,
  currency: 'UGX', documentType: 'invoice' }
const box: [number, number, number, number] = [0, 0, 0, 0]
const evidence = { ...model, invoiceNumberBox: box, totalAmountBox: box,
  ocrEvidence: { invoiceNumberText: 'DI100', invoiceNumberConfidence: 1, totalAmountText: '500' } }

describe('runtime invoice validation', () => {
  it('accepts a complete index permutation without silently renumbering it', () => {
    const result = validateExtraction({ invoiceDocuments: [{ ...model, documentIndex: 1 }, model] }, 2)
    expect(result.invoiceDocuments.map(document => document.documentIndex)).toEqual([1, 0])
  })
  it('rejects duplicate, missing, negative, fractional and out-of-range document indices', () => {
    for (const index of [-1, 1, 0.5, '0', null]) expect(() => validateExtraction({ invoiceDocuments: [{ ...model, documentIndex: index }] }, 1)).toThrow()
    expect(() => validateExtraction({ invoiceDocuments: [model, model] }, 2)).toThrow()
    expect(() => validateExtraction({ invoiceDocuments: [] }, 1)).toThrow()
  })
  it('rejects missing, extra or mistyped fields and invalid amounts', () => {
    for (const patch of [{ totalAmount: '500' }, { totalAmount: Infinity }, { totalAmount: NaN }, { totalAmount: -1 }, { netAmount: false }, { invoiceNumber: 100 }, { documentType: 'receipt' }, { currency: 'US dollar' }, { extra: 'injected' }]) expect(() => validateExtraction({ invoiceDocuments: [{ ...model, ...patch }] }, 1)).toThrow()
    const missing = { ...model } as Partial<ModelInvoice>
    delete missing.taxAmount
    expect(() => validateExtraction({ invoiceDocuments: [missing] }, 1)).toThrow()
  })
})

describe('invoice-only evidence verification', () => {
  it('parses decimal comma/dot and spaced thousands without truncating cents', () => {
    for (const printed of ['25 108 709,00', '25,108,709.00', '25.108.709,00', 'Sh 25108709']) expect(parsePrintedAmount(printed)).toBe(25108709)
    expect(parsePrintedAmount('100.01')).toBe(100.01)
    expect(parsePrintedAmount('100 VAT 20')).toBeNull()
    for (const malformed of ['100.', '100..00', '1,23,45', '1,234.567,00']) expect(parsePrintedAmount(malformed)).toBeNull()
  })
  it('requires printed ID equality, not just two nonempty strings', () => {
    expect(verifyInvoice(evidence).fieldVerification?.invoiceNumberVerified).toBe(true)
    expect(verifyInvoice({ ...evidence, invoiceNumberText: 'DI101' }).fieldVerification?.invoiceNumberVerified).toBe(false)
  })
  it('does not call a model echo independent ID verification', () => {
    expect(verifyInvoice({ ...evidence, ocrEvidence: undefined }).fieldVerification?.invoiceNumberVerified).toBe(false)
    for (const confidence of [undefined, 0.3, 0.849, NaN, Infinity, 1.01]) {
      expect(verifyInvoice({ ...evidence, ocrEvidence: { invoiceNumberText: 'DI100', invoiceNumberConfidence: confidence, totalAmountText: '' } }).fieldVerification?.invoiceNumberVerified).toBe(false)
    }
    expect(verifyInvoice({ ...evidence, ocrEvidence: { invoiceNumberText: 'DI100', invoiceNumberConfidence: 0.85, totalAmountText: '' } }).fieldVerification?.invoiceNumberVerified).toBe(true)
  })
  it('does not bypass final amount, label, or net-plus-tax conflicts', () => {
    expect(verifyInvoice({ ...evidence, netAmount: 401 }).fieldVerification?.totalAmountVerified).toBe(false)
    expect(verifyInvoice({ ...evidence, totalAmountText: '501' }).fieldVerification?.totalAmountVerified).toBe(false)
    expect(verifyInvoice({ ...evidence, totalAmountLabel: 'Net Amount Payable' }).fieldVerification?.totalAmountVerified).toBe(false)
    expect(verifyInvoice({ ...evidence, recoveredFromStatementLine: true }).fieldVerification?.totalAmountVerified).toBe(false)
    expect(verifyInvoice({ ...evidence, currency: 'UNKNOWN' }).fieldVerification?.totalAmountVerified).toBe(false)
  })
  it('keeps independent OCR conflicts visible without choosing the statement-friendly value', () => {
    const result = verifyInvoice({ ...evidence, ocrEvidence: { invoiceNumberText: 'DI101', totalAmountText: '501' } })
    expect(result.fieldVerification?.invoiceNumberVerified).toBe(false)
    expect(result.fieldVerification?.totalAmountVerified).toBe(false)
    expect(result.invoiceNumber).toBe('DI100')
    expect(result.totalAmount).toBe(500)
  })
  it('distinguishes unavailable arithmetic from failed arithmetic', () => {
    const result = verifyInvoice({ ...evidence, netAmount: null, taxAmount: null })
    expect(result.fieldVerification?.arithmeticAvailable).toBe(false)
    expect(result.fieldVerification?.totalAmountVerified).toBe(true)
  })
})
