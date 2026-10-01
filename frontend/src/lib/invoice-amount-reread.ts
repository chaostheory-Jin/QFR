import { validateExtraction, verifyInvoice, type ModelInvoice } from './invoice-evidence'
import type { InvoiceExtraction } from './reconciliation'

export const AMOUNT_READ_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    totalAmount: { type: 'number' }, totalAmountText: { type: 'string' }, totalAmountLabel: { type: 'string' },
    netAmount: { type: ['number', 'null'] }, taxAmount: { type: ['number', 'null'] },
  }, required: ['totalAmount', 'totalAmountText', 'totalAmountLabel', 'netAmount', 'taxAmount'],
}
export const AMOUNT_READ_PROMPT = `Read these two views of the SAME invoice totals region only. One is original colour and one is enlarged channel contrast.
Transcribe the printed net amount, printed tax amount and final gross amount payable independently, including the original gross number string and its label.
Use null for missing net/tax, zero and empty strings for missing final gross. Never infer missing digits, compute a replacement gross, or use another document. Arithmetic can prompt you to look at the pixels again, but only return what is printed. No statement, candidate amount, previous extraction or expected answer is provided.`

function amountFields(value: ModelInvoice | InvoiceExtraction) {
  return { totalAmount: value.totalAmount, totalAmountText: value.totalAmountText, totalAmountLabel: value.totalAmountLabel,
    netAmount: value.netAmount, taxAmount: value.taxAmount }
}

/** A focused reread is a new extraction from invoice pixels, not a statement
 * correction. Display valid focused evidence but never silently verify conflicts. */
export function applyAmountReread(original: InvoiceExtraction, response: unknown): InvoiceExtraction {
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || Object.keys(response).length !== AMOUNT_READ_SCHEMA.required.length
    || AMOUNT_READ_SCHEMA.required.some(key => !(key in response))) throw new Error('Invalid amount reread fields.')
  const raw: ModelInvoice = {
    documentIndex: 0, fileName: original.fileName, invoiceNumber: original.invoiceNumber,
    invoiceNumberText: original.invoiceNumberText ?? '', totalAmount: original.totalAmount,
    totalAmountText: original.totalAmountText ?? '', totalAmountLabel: original.totalAmountLabel ?? '',
    netAmount: original.netAmount ?? null, taxAmount: original.taxAmount ?? null,
    currency: original.currency ?? 'UNKNOWN', documentType: original.documentType ?? 'unknown', ...response,
  }
  const [read] = validateExtraction({ invoiceDocuments: [raw] }, 1).invoiceDocuments
  const candidate = verifyInvoice({ ...original, ...amountFields(read) })
  const accepted = original.documentType !== 'unknown'
    && candidate.fieldVerification?.totalAmountVerified === true
    && candidate.fieldVerification.arithmeticVerified === true
  const disagreement = read.totalAmount !== original.totalAmount
    || read.netAmount !== original.netAmount || read.taxAmount !== original.taxAmount
  const result = accepted ? candidate : original
  const fieldVerification = result.fieldVerification && (disagreement || !accepted)
    ? { ...result.fieldVerification, totalAmountVerified: false,
      reason: result.fieldVerification.reason + '; independent totals readings disagree or reread failed; manual review required' }
    : result.fieldVerification
  return { ...result, fieldVerification, amountReread: {
    original: amountFields(original), reread: amountFields(read), accepted,
    reason: accepted ? 'Focused invoice-only totals extraction passed printed-label, amount and arithmetic checks; first extraction retained; disagreements require review.'
      : 'Reread is missing, conflicts or lacks arithmetic support; original retained for manual review.',
  } }
}
