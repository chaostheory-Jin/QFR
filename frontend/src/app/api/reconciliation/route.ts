import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { openAIApiKey } from '@/lib/openai-key'
import type { BoundingBox } from '@/lib/reconciliation'
import { INVOICE_EXTRACTION_PROMPT, INVOICE_EXTRACTION_SCHEMA, ExtractionValidationError, validateExtraction, verifyInvoice, isInvoiceCurrency } from '@/lib/invoice-evidence'
import { parseStatementFile } from '@/lib/statement-parser'
import { prepareInvoiceImage, INVOICE_IMAGE_PIPELINE } from '@/lib/invoice-image-views'
import { AMOUNT_READ_PROMPT, AMOUNT_READ_SCHEMA, applyAmountReread } from '@/lib/invoice-amount-reread'

export const runtime = 'nodejs'
export const maxDuration = 120

const OPENAI_URL = 'https://api.openai.com/v1/responses'
const MAX_INVOICES = 12
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_REQUEST_BYTES = 4 * 1024 * 1024
const ZERO_BOX: BoundingBox = [0, 0, 0, 0]
const execFileAsync = promisify(execFile)

type OpenAIResponse = {
  id?: string
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
  output_text?: string
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
  error?: { message?: string }
}

type OCRLine = { text: string; confidence: number; box: BoundingBox }
type OCRDocument = { path: string; lines: OCRLine[] }

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File
}

function dataUrl(file: File, base64: string): string {
  return `data:${file.type || 'application/octet-stream'};base64,${base64}`
}

async function toInputParts(file: File, documentIndex: number) {
  const bytes = Buffer.from(await file.arrayBuffer())
  if (file.type.startsWith('image/')) return prepareInvoiceImage(bytes)
  return { parts: [{ type: 'input_file' as const, filename: `invoice-${documentIndex + 1}-${file.name}`, file_data: dataUrl(file, bytes.toString('base64')) }], views: [] }
}

function responseText(response: OpenAIResponse): string | null {
  if (response.output_text) return response.output_text
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text
    }
  }
  return null
}

function paddedBox(box: BoundingBox, padding = 4): BoundingBox {
  return [Math.max(0, box[0] - padding), Math.max(0, box[1] - padding), Math.min(1000, box[2] + padding), Math.min(1000, box[3] + padding)]
}

function centerY(box: BoundingBox): number {
  return (box[1] + box[3]) / 2
}

function letters(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, '')
}

function findInvoiceNumberEvidence(lines: OCRLine[]): { box: BoundingBox; text: string; confidence: number } {
  const anchors = lines.filter((line) => letters(line.text).includes('INVOICENO'))
  for (const anchor of anchors.sort((left, right) => right.box[0] - left.box[0])) {
    const below = lines
      .filter((line) => centerY(line.box) > centerY(anchor.box) && centerY(line.box) - centerY(anchor.box) < 35)
      .filter((line) => line.box[2] >= anchor.box[0] - 45 && line.box[0] <= anchor.box[2] + 45)
      .filter((line) => /\d{3,}/.test(line.text.replace(/[^0-9]/g, '')))
      .sort((left, right) => centerY(left.box) - centerY(right.box))[0]
    if (below) return { box: paddedBox(below.box), text: below.text, confidence: below.confidence }
  }

  // Never select an arbitrary OCR line because it resembles the model's guess.
  // Without a printed Invoice No anchor, independent field evidence is missing.
  return { box: ZERO_BOX, text: '', confidence: 0 }
}

function findGrossAmountEvidence(lines: OCRLine[]): { box: BoundingBox; text: string } {
  // Locate by the invoice's printed label and geometry, never by statement values
  // or the expected number of digits. Keep conflicting OCR evidence visible.
  const label = lines.filter(line => letters(line.text).includes('GROSSAMOUNTPAYABLE'))[0]
  if (!label) return { box: ZERO_BOX, text: '' }
  const candidates = lines.filter(line => line.box[0] > label.box[2] + 10
    && Math.abs(centerY(line.box) - centerY(label.box)) < 7 && /^[-0-9 .,]+$/.test(line.text.trim()))
    .sort((a, b) => a.box[0] - b.box[0])
  if (!candidates.length) return { box: ZERO_BOX, text: '' }
  return { text: candidates.map(line => line.text).join(' '), box: paddedBox([
    Math.min(...candidates.map(line => line.box[0])), Math.min(...candidates.map(line => line.box[1])),
    Math.max(...candidates.map(line => line.box[2])), Math.max(...candidates.map(line => line.box[3])),
  ]) }
}

async function locateInvoiceBoxes(files: File[]): Promise<OCRLine[][]> {
  if (process.platform !== 'darwin') return files.map(() => [])
  const imageEntries = files.flatMap((file, index) => file.type.startsWith('image/') ? [{ file, index }] : [])
  if (!imageEntries.length) return files.map(() => [])
  const tempDirectory = await mkdtemp(join(tmpdir(), 'qfr-invoices-'))
  try {
    const paths = await Promise.all(imageEntries.map(async ({ file, index }) => {
      const path = join(tempDirectory, `invoice-${index}.${file.type.split('/')[1] || 'jpg'}`)
      await writeFile(path, Buffer.from(await file.arrayBuffer()))
      return path
    }))
    const script = join(process.cwd(), 'scripts', 'ocr_boxes.swift')
    const { stdout } = await execFileAsync('swift', [script, ...paths], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, timeout: 60_000 })
    const documents = JSON.parse(stdout) as OCRDocument[]
    if (!Array.isArray(documents) || documents.length !== paths.length || documents.some((document, index) =>
      !document || document.path !== paths[index] || !Array.isArray(document.lines) || document.lines.some(line =>
        typeof line.text !== 'string' || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1
        || !Array.isArray(line.box) || line.box.length !== 4 || line.box.some(value => !Number.isFinite(value) || value < 0 || value > 1000)
        || line.box[0] > line.box[2] || line.box[1] > line.box[3]))) throw new Error('Invalid local OCR evidence.')
    const result = files.map(() => [] as OCRLine[])
    imageEntries.forEach(({ index }, resultIndex) => { result[index] = documents[resultIndex]?.lines ?? [] })
    return result
  } catch {
    return files.map(() => [])
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  try {
    const formData = await request.formData()
    const statement = formData.get('statement')
    const invoices = formData.getAll('invoices').filter(isFile)
    if (!isFile(statement) || invoices.length === 0) return NextResponse.json({ error: 'Upload one master statement and at least one invoice.' }, { status: 400 })
    if (invoices.length > MAX_INVOICES) return NextResponse.json({ error: `Upload no more than ${MAX_INVOICES} invoices at once.` }, { status: 400 })

    const statementCurrency = String(formData.get('statementCurrency') ?? 'UGX')
    if (!isInvoiceCurrency(statementCurrency)) return NextResponse.json({ error: 'Invalid statement currency.' }, { status: 400 })
    const files = [statement, ...invoices]
    if (files.some((file) => file.size > MAX_FILE_BYTES)) return NextResponse.json({ error: 'Each file must be 4 MB or smaller for the hosted version.' }, { status: 413 })
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_REQUEST_BYTES) return NextResponse.json({ error: 'The combined upload must be 4 MB or smaller for the hosted version. Upload fewer invoices at once.' }, { status: 413 })

    const apiKey = openAIApiKey(request)
    if (!apiKey) return NextResponse.json({ error: 'No OpenAI API key configured. Add one on login or set OPENAI_API_KEY on Vercel.' }, { status: 503 })

    const sourceEvidencePromise = Promise.all([parseStatementFile(statement), locateInvoiceBoxes(invoices)])
    // A provider error can return early; do not leave a parser rejection unhandled.
    void sourceEvidencePromise.catch(() => undefined)
    const prepared = await Promise.all(invoices.map(toInputParts))
    const invoiceParts = prepared.flatMap((document, index) => [
      { type: 'input_text', text: `The next views belong ONLY to documentIndex ${index}, fileName ${JSON.stringify(invoices[index].name)}. Return ONE result for this document regardless of the number of views.` },
      ...document.parts,
    ])
    const model = process.env.OPENAI_RECONCILIATION_MODEL || 'gpt-6-astra'
    const effort = process.env.OPENAI_RECONCILIATION_REASONING_EFFORT || 'high'
    if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) return NextResponse.json({ error: 'Invalid reconciliation reasoning effort.' }, { status: 503 })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 95_000)
    let openAIResponse: Response
    try {
      openAIResponse = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, store: false,
          reasoning: { effort },
          input: [{ role: 'user', content: [{
            type: 'input_text',
            text: INVOICE_EXTRACTION_PROMPT,
          }, ...invoiceParts] }],
          text: { format: {
            type: 'json_schema', name: 'cola_invoice_extraction', strict: true,
            schema: INVOICE_EXTRACTION_SCHEMA,
          } },
          max_output_tokens: 8_000,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const payload = await openAIResponse.json() as OpenAIResponse
    if (!openAIResponse.ok) return NextResponse.json({ error: payload.error?.message || `OpenAI extraction failed (${openAIResponse.status}).` }, { status: openAIResponse.status })
    const output = responseText(payload)
    if (!output) return NextResponse.json({ error: 'OpenAI returned no extraction data.' }, { status: 502 })

    const [statementRecords, ocrDocuments] = await sourceEvidencePromise
    if (!statementRecords.length) return NextResponse.json({ error: 'No transaction lines could be read from the master statement.' }, { status: 422 })
    const extraction = validateExtraction(JSON.parse(output), invoices.length)
    const invoiceDocuments = await Promise.all(extraction.invoiceDocuments.map(async document => {
      const index = document.documentIndex
      const lines = ocrDocuments[index] ?? []
      const id = findInvoiceNumberEvidence(lines)
      const amount = findGrossAmountEvidence(lines)
      const verified = verifyInvoice({
        ...document, fileName: invoices[index].name,
        invoiceNumberBox: id.box, totalAmountBox: amount.box,
        ocrEvidence: { invoiceNumberText: id.text, invoiceNumberConfidence: id.confidence, totalAmountText: amount.text },
        sourceHash: createHash('sha256').update(Buffer.from(await invoices[index].arrayBuffer())).digest('hex'),
        sourceModel: model,
        providerTrace: { requestedModel: model, model: payload.model, responseId: payload.id,
          reasoningEffort: effort, tokenUsage: payload.usage },
        imagePreparation: { pipeline: INVOICE_IMAGE_PIPELINE, views: prepared[index].views },
      })
      if (verified.documentType === 'unknown') return verified
      const parts = prepared[index].parts.flatMap((part, position) => {
        const next = prepared[index].parts[position + 1]
        return part.type === 'input_text' && part.text.startsWith('Printed totals region') && next?.type === 'input_image'
          ? [part, next] : []
      })
      const remainingMs = Math.min(45_000, 110_000 - (Date.now() - startedAt))
      if (!parts.length || remainingMs < 5_000) return verified
      try {
        const rereadResponse = await fetch(OPENAI_URL, {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, store: false, reasoning: { effort }, max_output_tokens: 4_000,
            input: [{ role: 'user', content: [{ type: 'input_text', text: AMOUNT_READ_PROMPT }, ...parts] }],
            text: { format: { type: 'json_schema', name: 'invoice_totals_reread', strict: true, schema: AMOUNT_READ_SCHEMA } },
          }), signal: AbortSignal.timeout(remainingMs),
        })
        const rereadPayload = await rereadResponse.json() as OpenAIResponse
        const rereadText = responseText(rereadPayload)
        if (!rereadResponse.ok || !rereadText) throw new Error('Independent totals reread failed.')
        const reread = applyAmountReread(verified, JSON.parse(rereadText))
        return { ...reread, amountReread: { ...reread.amountReread!, providerModel: rereadPayload.model,
          providerResponseId: rereadPayload.id, tokenUsage: rereadPayload.usage } }
      } catch {
        return { ...verified, fieldVerification: verified.fieldVerification && { ...verified.fieldVerification, totalAmountVerified: false,
          reason: verified.fieldVerification.reason + '; independent totals reread failed; manual review required' }, amountReread: {
          original: { totalAmount: verified.totalAmount, totalAmountText: verified.totalAmountText, totalAmountLabel: verified.totalAmountLabel,
            netAmount: verified.netAmount, taxAmount: verified.taxAmount },
          accepted: false, reason: 'Independent invoice-only totals reread failed or timed out; original retained for review.',
        } }
      }
    }))
    invoiceDocuments.sort((a, b) => a.documentIndex - b.documentIndex)

    return NextResponse.json({ statementRecords, invoiceDocuments, audit: {
      schemaVersion: 3, createdAt: new Date().toISOString(), model, statementCurrency,
      imagePipeline: INVOICE_IMAGE_PIPELINE,
      reasoningEffort: effort,
      providerResponseId: payload.id,
      providerModel: payload.model,
      tokenUsage: payload.usage,
      idVerificationPolicy: 'matching invoice-only local OCR with confidence >= 0.85; model echo alone is unverified',
      amountRereadPolicy: 'portrait invoices receive independent focused totals read; disagreements require review; no expected/statement amount; all readings retained',
      evidenceSource: 'invoice-only; statement never changes extracted fields',
      statementHash: createHash('sha256').update(Buffer.from(await statement.arrayBuffer())).digest('hex'),
    } })
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Document extraction timed out. Try fewer or smaller files.'
      : error instanceof Error ? error.message : 'Reconciliation failed.'
    return NextResponse.json({ error: message }, { status: error instanceof ExtractionValidationError || error instanceof SyntaxError ? 502 : 500 })
  }
}
