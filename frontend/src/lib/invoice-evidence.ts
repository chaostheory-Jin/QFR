import { normaliseInvoiceNumber } from './invoice-id'
import type { InvoiceExtraction } from './reconciliation'

export type ModelInvoice = {
  documentIndex: number
  fileName: string
  invoiceNumber: string
  totalAmount: number
  invoiceNumberText: string
  totalAmountText: string
  totalAmountLabel: string
  netAmount: number | null
  taxAmount: number | null
  currency: string
  documentType: 'invoice' | 'credit_note' | 'unknown'
}

export class ExtractionValidationError extends Error {}

const currencies = new Set(Intl.supportedValuesOf('currency'))
export function isInvoiceCurrency(value: string): boolean { return currencies.has(value) }

export const INVOICE_EXTRACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { invoiceDocuments: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    properties: {
      documentIndex: { type: 'integer' }, fileName: { type: 'string' },
      invoiceNumber: { type: 'string' }, totalAmount: { type: 'number' },
      invoiceNumberText: { type: 'string' }, totalAmountText: { type: 'string' }, totalAmountLabel: { type: 'string' },
      netAmount: { type: ['number', 'null'] }, taxAmount: { type: ['number', 'null'] },
      currency: { type: 'string' }, documentType: { type: 'string', enum: ['invoice', 'credit_note', 'unknown'] },
    },
    required: ['documentIndex', 'fileName', 'invoiceNumber', 'totalAmount', 'invoiceNumberText', 'totalAmountText', 'totalAmountLabel', 'netAmount', 'taxAmount', 'currency', 'documentType'],
  } } }, required: ['invoiceDocuments'],
}

export const INVOICE_EXTRACTION_PROMPT = `Extract evidence from every attached document, in the explicitly supplied zero-based document order.
Read only the printed Invoice Number, and the final Gross Amount Payable / Amount Payable / final Total. Do not select an order, load, fiscal document, customer number, net amount, tax, subtotal or handwritten note.
Preserve exact printed strings, including spaces and digits; never infer an invoice ID or amount from another document. Transcribe net and tax when printed, or null when absent. Return the face value as a nonnegative number; identify credit notes separately with documentType.
Read currency from the document: Sh on a Uganda invoice is UGX. If not identifiable use UNKNOWN. Non-invoices or illegible fields must not be invented: use documentType unknown, empty missing evidence strings and totalAmount 0 if unreadable.
Several image views may represent the SAME document: full page, original-colour field crops, and enlarged channel/contrast crops. Return one result per explicit documentIndex, not one per image view.
First inspect the full page to identify document type and currency. Then read the printed header invoice ID left to right, character by character from its crop, including any alphabetic prefix. Do not turn letters into a numeric prefix or invent an INV prefix. Compare the original-colour and enlarged views before committing each faint character. If still illegible leave the ID empty.
Read the original printed net, tax and final gross independently from the totals crop. Use arithmetic only to detect a possible reading error and re-inspect the pixels; never manufacture an amount or replace the printed gross with a calculated sum. An enlarged view is a readability aid, not new evidence. Missing labels or fields stay missing.
Carefully re-read faint digits from the invoice itself once, especially the final amount's last digit and the printed invoice ID. Do not perform reconciliation or guess corrections. No statement or matching candidates are supplied.`

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateExtraction(value: unknown, invoiceCount: number): { invoiceDocuments: ModelInvoice[] } {
  if (!object(value) || Object.keys(value).some(key => key !== 'invoiceDocuments') || !Array.isArray(value.invoiceDocuments)) throw new ExtractionValidationError('Extraction must contain only invoiceDocuments.')
  if (value.invoiceDocuments.length !== invoiceCount) throw new ExtractionValidationError(`Expected ${invoiceCount} invoice results, received ${value.invoiceDocuments.length}.`)
  const indices = new Set<number>()
  const keys = INVOICE_EXTRACTION_SCHEMA.properties.invoiceDocuments.items.required
  const invoiceDocuments = value.invoiceDocuments.map((item: unknown) => {
    if (!object(item) || Object.keys(item).length !== keys.length || keys.some(key => !(key in item))) throw new ExtractionValidationError('Invoice fields do not match the extraction schema.')
    const index = item.documentIndex
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= invoiceCount || indices.has(index)) throw new ExtractionValidationError('Document indices must be unique integers covering the uploaded files.')
    indices.add(index)
    for (const key of ['fileName', 'invoiceNumber', 'invoiceNumberText', 'totalAmountText', 'totalAmountLabel', 'currency']) {
      if (typeof item[key] !== 'string' || (item[key] as string).length > (key === 'fileName' ? 512 : 256)) throw new ExtractionValidationError(`Invalid invoice string field: ${key}.`)
    }
    for (const key of ['totalAmount', 'netAmount', 'taxAmount']) {
      if (key !== 'totalAmount' && item[key] === null) continue
      if (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || (item[key] as number) < 0 || (item[key] as number) > 1e12) throw new ExtractionValidationError(`Invalid nonnegative finite invoice amount: ${key}.`)
    }
    if (!['invoice', 'credit_note', 'unknown'].includes(item.documentType as string)) throw new ExtractionValidationError('Invalid document type.')
    if (item.currency !== 'UNKNOWN' && !isInvoiceCurrency(item.currency as string)) throw new ExtractionValidationError('Invalid invoice currency.')
    return { ...item } as ModelInvoice
  })
  return { invoiceDocuments }
}

export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

export function minorAmount(value: number, currency = 'UGX'): number | null {
  if (!Number.isFinite(value) || !isInvoiceCurrency(currency)) return null
  const scaled = value * 10 ** currencyDigits(currency)
  const rounded = Math.round(scaled)
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 0.0001 ? rounded : null
}

export function parsePrintedAmount(value: string): number | null {
  let compact = value.trim().replace(/^(?:UGX|USD|EUR|AUD|GBP|KES|TZS|USh|Sh|US\$|\$|€|£)\s*/i, '').replace(/\s+/g, '')
  if (!/^\d[\d.,]*$/.test(compact)) return null
  const lastComma = compact.lastIndexOf(',')
  const lastDot = compact.lastIndexOf('.')
  const lastSeparator = Math.max(lastComma, lastDot)
  const grouped = /^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/
  const decimalLength = compact.length - lastSeparator - 1
  if (lastSeparator >= 0 && decimalLength >= 1 && decimalLength <= 2) {
    const integer = compact.slice(0, lastSeparator)
    if (!/^\d+$/.test(integer) && !grouped.test(integer)) return null
    compact = integer.replace(/[.,]/g, '') + '.' + compact.slice(lastSeparator + 1)
  } else {
    if (!grouped.test(compact) && /[.,]/.test(compact)) return null
    compact = compact.replace(/[.,]/g, '')
  }
  const parsed = Number(compact)
  return Number.isFinite(parsed) ? parsed : null
}

function finalAmountLabel(value: string, kind?: string): boolean {
  const label = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (/net|vat|tax|sub.?total/.test(label)) return false
  return /gross amount payable|^amount payable$|^total amount$|^total$|final total/.test(label)
    || (kind === 'credit_note' && /credit amount|total credit/.test(label))
}

export function verifyInvoice(document: InvoiceExtraction): InvoiceExtraction {
  const currency = document.currency ?? 'UGX'
  const printedAmount = parsePrintedAmount(document.totalAmountText ?? '')
  const total = minorAmount(document.totalAmount, currency)
  const invoiceNumberVerified = Boolean(normaliseInvoiceNumber(document.invoiceNumber)
    && normaliseInvoiceNumber(document.invoiceNumberText ?? '') === normaliseInvoiceNumber(document.invoiceNumber))
  const arithmeticAvailable = document.netAmount !== null && document.netAmount !== undefined && document.taxAmount !== null && document.taxAmount !== undefined
  const net = arithmeticAvailable ? minorAmount(document.netAmount!, currency) : null
  const tax = arithmeticAvailable ? minorAmount(document.taxAmount!, currency) : null
  const arithmeticVerified = arithmeticAvailable && total !== null && net !== null && tax !== null && net + tax === total
  const ocr = document.ocrEvidence
  const ocrIdConflict = Boolean(ocr?.invoiceNumberText && normaliseInvoiceNumber(ocr.invoiceNumberText) !== normaliseInvoiceNumber(document.invoiceNumber))
  // Two fields produced by the same model are self-consistency, not independent
  // evidence. Missing / weak local OCR must not silently become a verified ID.
  const independentIdAgreement = Boolean(ocr?.invoiceNumberText
    && Number.isFinite(ocr.invoiceNumberConfidence) && ocr.invoiceNumberConfidence! >= 0.85
    && ocr.invoiceNumberConfidence! <= 1
    && normaliseInvoiceNumber(ocr.invoiceNumberText) === normaliseInvoiceNumber(document.invoiceNumber))
  const ocrAmount = ocr?.totalAmountText ? parsePrintedAmount(ocr.totalAmountText) : null
  const ocrAmountConflict = ocrAmount !== null && minorAmount(ocrAmount, currency) !== total
  const totalAmountVerified = document.totalAmount > 0 && total !== null && printedAmount !== null
    && minorAmount(printedAmount, currency) === total
    && finalAmountLabel(document.totalAmountLabel ?? '', document.documentType)
    && (!arithmeticAvailable || arithmeticVerified) && !ocrAmountConflict
    && document.recoveredFromStatementLine !== true
  const checks = [
    invoiceNumberVerified ? 'printed ID agrees with extracted ID' : 'printed ID is missing or conflicts with extracted ID',
    independentIdAgreement ? 'independent local OCR agrees with ID' : 'independent ID evidence is unavailable, weak or conflicting; manual review required',
    totalAmountVerified ? 'final printed amount agrees with extracted amount' : 'final printed amount, label or arithmetic failed verification',
    arithmeticAvailable ? (arithmeticVerified ? 'net + tax agrees with gross' : 'net + tax conflicts with gross') : 'arithmetic unavailable',
    ...(ocrIdConflict || ocrAmountConflict ? ['independent local OCR conflicts; manual review required'] : []),
    ...(document.recoveredFromStatementLine ? ['legacy statement-derived correction is not independent invoice evidence'] : []),
  ]
  return { ...document, fieldVerification: {
    invoiceNumberVerified: invoiceNumberVerified && independentIdAgreement && !ocrIdConflict && document.recoveredFromStatementLine !== true,
    totalAmountVerified, arithmeticVerified, arithmeticAvailable, reason: checks.join('; '),
  } }
}
