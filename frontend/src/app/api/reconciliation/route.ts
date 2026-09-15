import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { openAIApiKey } from '@/lib/openai-key'
import {
  invoiceSimilarity,
  type BoundingBox,
  type InvoiceExtraction,
  type StatementRecord,
} from '@/lib/reconciliation'
import { parseStatementFile } from '@/lib/statement-parser'

export const runtime = 'nodejs'
export const maxDuration = 120

const OPENAI_URL = 'https://api.openai.com/v1/responses'
const MAX_INVOICES = 12
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_REQUEST_BYTES = 4 * 1024 * 1024
const ZERO_BOX: BoundingBox = [0, 0, 0, 0]
const execFileAsync = promisify(execFile)

type OpenAIResponse = {
  output_text?: string
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
  error?: { message?: string }
}

type ModelInvoice = Omit<InvoiceExtraction, 'invoiceNumberBox' | 'totalAmountBox' | 'fieldVerification'>
type ExtractionResponse = { invoiceDocuments: ModelInvoice[] }
type OCRLine = { text: string; confidence: number; box: BoundingBox }
type OCRDocument = { path: string; lines: OCRLine[] }

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File
}

function dataUrl(file: File, base64: string): string {
  return `data:${file.type || 'application/octet-stream'};base64,${base64}`
}

async function toInputPart(file: File, documentIndex: number) {
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
  if (file.type.startsWith('image/')) return { type: 'input_image', image_url: dataUrl(file, base64), detail: 'high' }
  return { type: 'input_file', filename: `invoice-${documentIndex + 1}-${file.name}`, file_data: dataUrl(file, base64) }
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

function parsePrintedAmount(value: string): number | null {
  const compact = value.replace(/[^0-9,.-]/g, '')
  if (!compact) return null
  const europeanDecimal = /,\d{2}$/.test(compact)
  const normalised = europeanDecimal ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '')
  const parsed = Number(normalised)
  return Number.isFinite(parsed) ? parsed : null
}

function finalAmountLabel(value: string): boolean {
  const label = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (label.includes('net') || label.includes('vat') || label.includes('tax')) return false
  return label.includes('gross amount payable') || label === 'amount payable' || label.includes('final total')
}

function verifyInvoice(document: InvoiceExtraction): InvoiceExtraction {
  const printedAmount = parsePrintedAmount(document.totalAmountText ?? '')
  const recovered = document.recoveredFromStatementLine === true
  const invoiceNumberVerified = Boolean(document.invoiceNumberText && document.invoiceNumber)
  const arithmeticAvailable = typeof document.netAmount === 'number' && typeof document.taxAmount === 'number'
  const arithmeticVerified = arithmeticAvailable
    ? Math.abs((document.netAmount ?? 0) + (document.taxAmount ?? 0) - document.totalAmount) < 1
    : false
  const totalAmountVerified = Boolean(
    (recovered || (printedAmount !== null && Math.abs(printedAmount - document.totalAmount) < 1))
    && finalAmountLabel(document.totalAmountLabel ?? '')
    && (recovered || !arithmeticAvailable || arithmeticVerified),
  )
  const checks = [
    invoiceNumberVerified ? 'printed invoice ID was extracted' : 'printed invoice ID could not be extracted',
    totalAmountVerified ? (recovered ? 'final amount resolved against one unique full statement line' : 'final gross payable amount was extracted and checked') : 'final gross payable amount could not be verified',
    arithmeticAvailable ? (arithmeticVerified ? 'net + tax agrees to gross' : 'net + tax does not agree to gross') : 'invoice arithmetic was not available',
  ]
  return { ...document, fieldVerification: { invoiceNumberVerified, totalAmountVerified, arithmeticVerified, reason: checks.join('; ') } }
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

function findInvoiceNumberEvidence(lines: OCRLine[], expected: string): { box: BoundingBox; text: string } {
  const anchors = lines.filter((line) => letters(line.text).includes('INVOICENO'))
  for (const anchor of anchors.sort((left, right) => right.box[0] - left.box[0])) {
    const below = lines
      .filter((line) => centerY(line.box) > centerY(anchor.box) && centerY(line.box) - centerY(anchor.box) < 35)
      .filter((line) => line.box[2] >= anchor.box[0] - 45 && line.box[0] <= anchor.box[2] + 45)
      .filter((line) => /\d{7,}/.test(line.text.replace(/[^0-9]/g, '')))
      .sort((left, right) => centerY(left.box) - centerY(right.box))[0]
    if (below) return { box: paddedBox(below.box), text: below.text }
  }

  const closest = lines
    .map((line) => ({ line, score: invoiceSimilarity(line.text, expected) }))
    .filter(({ line, score }) => score >= 0.72 && /\d{7,}/.test(line.text.replace(/[^0-9]/g, '')))
    .sort((left, right) => right.score - left.score)[0]
  return closest ? { box: paddedBox(closest.line.box), text: closest.line.text } : { box: ZERO_BOX, text: '' }
}

function recoverAgainstFullStatement(
  document: ModelInvoice,
  lines: OCRLine[],
  statementRecords: StatementRecord[],
): InvoiceExtraction {
  const invoiceEvidence = findInvoiceNumberEvidence(lines, document.invoiceNumber)
  const amountBox = findGrossAmountBox(lines, document.totalAmount)
  const tolerance = Math.max(10, Math.abs(document.totalAmount) * 0.00005)
  const amountCandidates = statementRecords.filter((record) =>
    record.description === 'Sales invoice'
    && Math.abs(Math.abs(record.amount) - Math.abs(document.totalAmount)) <= tolerance,
  )

  if (amountCandidates.length === 1) {
    const target = amountCandidates[0]
    const rankedIdentifiers = (target.identifiers?.length ? target.identifiers : [target.invoiceNumber])
      .map((identifier) => ({
        identifier,
        score: (invoiceSimilarity(document.invoiceNumber, identifier) + invoiceSimilarity(invoiceEvidence.text, identifier)) / 2,
      }))
      .sort((left, right) => right.score - left.score)
    const best = rankedIdentifiers[0]
    const runnerUp = rankedIdentifiers[1]
    const identifierIsClear = best && best.score >= 0.45 && (!runnerUp || best.score - runnerUp.score >= 0.05)
    if (identifierIsClear) {
      const changed = Math.abs(Math.abs(target.amount) - Math.abs(document.totalAmount)) >= 1
        || invoiceSimilarity(document.invoiceNumber, best.identifier) < 1
      return {
        ...document,
        invoiceNumber: best.identifier,
        totalAmount: Math.abs(target.amount),
        invoiceNumberBox: invoiceEvidence.box,
        totalAmountBox: amountBox,
        recoveredFromStatementLine: changed,
      }
    }
  }

  return { ...document, invoiceNumberBox: invoiceEvidence.box, totalAmountBox: amountBox }
}

function findGrossAmountBox(lines: OCRLine[], amount: number): BoundingBox {
  const expectedLabel = 'GROSSAMOUNTPAYABLE'
  const label = lines
    .map((line) => ({ line, score: invoiceSimilarity(letters(line.text), expectedLabel) }))
    .filter(({ line, score }) => score >= 0.55 && line.box[0] < 500)
    .sort((left, right) => right.score - left.score)[0]?.line
  if (!label) return ZERO_BOX

  const expectedDigits = String(Math.round(Math.abs(amount)))
  const candidates = lines
    .map((line) => ({ line, digits: line.text.replace(/[^0-9]/g, '') }))
    .filter(({ line, digits }) => digits && digits.length <= 3 && line.box[0] > label.box[2] + 20 && Math.abs(centerY(line.box) - centerY(label.box)) < 7)
    .sort((left, right) => left.line.box[0] - right.line.box[0])

  for (let start = 0; start < candidates.length; start += 1) {
    let joined = ''
    const selected: OCRLine[] = []
    for (let index = start; index < candidates.length && joined.length < expectedDigits.length; index += 1) {
      if (selected.length && candidates[index].line.box[0] - selected[selected.length - 1].box[2] > 75) break
      joined += candidates[index].digits
      selected.push(candidates[index].line)
      if (joined.length === expectedDigits.length) {
        const box: BoundingBox = [
          Math.min(...selected.map((line) => line.box[0])), Math.min(...selected.map((line) => line.box[1])),
          Math.max(...selected.map((line) => line.box[2])), Math.max(...selected.map((line) => line.box[3])),
        ]
        return paddedBox(box)
      }
    }
  }
  return ZERO_BOX
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
    const result = files.map(() => [] as OCRLine[])
    imageEntries.forEach(({ index }, resultIndex) => { result[index] = documents[resultIndex]?.lines ?? [] })
    return result
  } catch {
    return files.map(() => [])
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

function validateExtraction(value: unknown, invoiceCount: number): ExtractionResponse {
  if (!value || typeof value !== 'object') throw new Error('Extraction response is not an object.')
  const candidate = value as Partial<ExtractionResponse>
  if (!Array.isArray(candidate.invoiceDocuments)) throw new Error('Extraction response is missing invoice records.')
  if (candidate.invoiceDocuments.length !== invoiceCount) throw new Error(`Expected ${invoiceCount} invoice results, received ${candidate.invoiceDocuments.length}.`)
  return candidate as ExtractionResponse
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const statement = formData.get('statement')
    const invoices = formData.getAll('invoices').filter(isFile)
    if (!isFile(statement) || invoices.length === 0) return NextResponse.json({ error: 'Upload one master statement and at least one invoice.' }, { status: 400 })
    if (invoices.length > MAX_INVOICES) return NextResponse.json({ error: `Upload no more than ${MAX_INVOICES} invoices at once.` }, { status: 400 })

    const files = [statement, ...invoices]
    if (files.some((file) => file.size > MAX_FILE_BYTES)) return NextResponse.json({ error: 'Each file must be 4 MB or smaller for the hosted version.' }, { status: 413 })
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_REQUEST_BYTES) return NextResponse.json({ error: 'The combined upload must be 4 MB or smaller for the hosted version. Upload fewer invoices at once.' }, { status: 413 })

    const apiKey = openAIApiKey(request)
    if (!apiKey) return NextResponse.json({ error: 'No OpenAI API key configured. Add one on login or set OPENAI_API_KEY on Vercel.' }, { status: 503 })

    const statementRecordsPromise = parseStatementFile(statement)
    const ocrPromise = locateInvoiceBoxes(invoices)
    const invoiceParts = await Promise.all(invoices.map(toInputPart))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 95_000)
    let openAIResponse: Response
    try {
      openAIResponse = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_RECONCILIATION_MODEL || 'gpt-5.6-luna', store: false,
          input: [{ role: 'user', content: [{
            type: 'input_text',
            text: 'Extract evidence from every attached invoice. Read the printed Invoice Number and only the final Gross Amount Payable or final Amount Payable. Never use Net Amount Payable, VAT, line items, subtotals or handwritten numbers. Preserve the exact printed strings and final amount label. Extract net and tax when printed so gross can be checked. Re-scan unclear digits once. Return extraction only; do not perform matching.',
          }, ...invoiceParts] }],
          text: { format: {
            type: 'json_schema', name: 'cola_invoice_extraction', strict: true,
            schema: {
              type: 'object', additionalProperties: false,
              properties: { invoiceDocuments: { type: 'array', items: {
                type: 'object', additionalProperties: false,
                properties: {
                  documentIndex: { type: 'integer' }, fileName: { type: 'string' }, invoiceNumber: { type: 'string' }, totalAmount: { type: 'number' },
                  invoiceNumberText: { type: 'string' }, totalAmountText: { type: 'string' }, totalAmountLabel: { type: 'string' },
                  netAmount: { type: ['number', 'null'] }, taxAmount: { type: ['number', 'null'] },
                },
                required: ['documentIndex', 'fileName', 'invoiceNumber', 'totalAmount', 'invoiceNumberText', 'totalAmountText', 'totalAmountLabel', 'netAmount', 'taxAmount'],
              } } },
              required: ['invoiceDocuments'],
            },
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

    const [statementRecords, ocrDocuments] = await Promise.all([statementRecordsPromise, ocrPromise])
    if (!statementRecords.length) return NextResponse.json({ error: 'No transaction lines could be read from the master statement.' }, { status: 422 })
    const extraction = validateExtraction(JSON.parse(output), invoices.length)
    const invoiceDocuments = extraction.invoiceDocuments
      .sort((left, right) => left.documentIndex - right.documentIndex)
      .map((document, index) => verifyInvoice(recoverAgainstFullStatement(
        { ...document, documentIndex: index, fileName: invoices[index]?.name ?? document.fileName },
        ocrDocuments[index] ?? [],
        statementRecords,
      )))

    return NextResponse.json({ statementRecords, invoiceDocuments })
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Document extraction timed out. Try fewer or smaller files.'
      : error instanceof Error ? error.message : 'Reconciliation failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
