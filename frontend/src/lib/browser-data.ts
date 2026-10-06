import { browserDigest, browserList, browserRead, browserUpdate } from './browser-storage'
import { readSourceTables, suggestColumns, validateImport, type ImportMetadata, type ColumnMap } from './data-intake'
import type { ImportBatch } from './import-store'
import { decide, validateDecision, validateRunInput, type ReconciliationRun } from './reconciliation-review'
import { originalTraceRecord, type SupportingDocument } from './trace-data'
import type { DocumentScope } from './trace-document-store'
import { REPORT_DATA } from './report-data-mock'
import { QUICKBOOKS_DATA } from './quickbooks-report-data'

type ImportEntry = { batch: ImportBatch; original: Blob }
type RunEntry = { run: ReconciliationRun; originals: Record<string, Blob> }
type DocumentEntry = { documents: SupportingDocument[]; originals: Record<string, Blob> }
function required<T>(value: T | undefined): T {
  if (!value) throw new Error('Record not found in this browser. Use the original browser and site address, or upload the file again.')
  return value
}
function validId(id: string) { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid record identity.'); return id }
async function sourceFile(form: FormData) {
  const file = form.get('file')
  if (!(file instanceof Blob) || !('name' in file) || !file.size) throw new Error('Choose a nonempty original file.')
  return file as File
}
function download(blob: Blob, name: string, mime?: string) {
  return new Response(blob, { headers: { 'Content-Type': mime ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } })
}

async function imports(query: URLSearchParams, init: RequestInit) {
  const id = query.get('id'), method = init.method ?? 'GET'
  if (method === 'GET') {
    if (!id) return Response.json({ batches: (await browserList<ImportEntry>('import:')).map(entry => {
      const { tables, validation, ...batch } = entry.batch
      return { ...batch, rowCount: validation?.records.length ?? tables[0]?.rows.length ?? 0 }
    }).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)) })
    const entry = required(await browserRead<ImportEntry>(`import:${validId(id)}`))
    return query.has('original') ? download(entry.original, entry.batch.fileName) : Response.json(entry.batch)
  }
  if (method === 'POST') {
    const form = init.body as FormData, file = await sourceFile(form), metadata = JSON.parse(String(form.get('metadata'))) as ImportMetadata
    if (file.name.length > 200 || !metadata || typeof metadata.source !== 'string' || typeof metadata.company !== 'string') throw new Error('Invalid import metadata.')
    const bytes = new Uint8Array(await file.arrayBuffer()), tables = readSourceTables(bytes, file.name), sha256 = await browserDigest(bytes)
    const id = await browserDigest(JSON.stringify([sha256, metadata.source.trim(), metadata.company.trim(), metadata.currency, metadata.kind, metadata.sample]))
    if (!tables[0]) throw new Error('Workbook is empty.')
    const batch: ImportBatch = { schemaVersion: 1, id, fileName: file.name, sha256, uploadedAt: new Date().toISOString(), metadata, tables,
      sheet: tables[0].sheet, mapping: suggestColumns(tables[0].headers), options: { dateFormat: 'ISO', duplicates: 'block' }, revision: 0, status: 'draft' }
    validateImport(tables[0], { date: tables[0].headers[0], amount: tables[0].headers[0], account: tables[0].headers[0], description: tables[0].headers[0] }, metadata, id, file.name, batch.options, [])
    return Response.json((await browserUpdate<ImportEntry>(`import:${id}`, existing => existing ?? { batch, original: file })).batch)
  }
  if (method !== 'PUT') throw new Error('Unsupported browser import action.')
  const body = JSON.parse(String(init.body)) as { id: string; revision: number; sheet: string; mapping: ColumnMap; options: ImportBatch['options']; commit: boolean }
  if (!Number.isInteger(body.revision) || typeof body.commit !== 'boolean') throw new Error('Invalid import request.')
  return Response.json((await browserUpdate<ImportEntry>(`import:${validId(body.id)}`, (entry, peers) => {
    const { batch, original } = required(entry)
    if (batch.revision !== body.revision) throw new Error('Import changed elsewhere. Reload before saving.')
    if (batch.status === 'committed') throw new Error('Committed batches are immutable. Upload a corrected source as a new batch.')
    const table = batch.tables.find(table => table.sheet === body.sheet)
    if (!table) throw new Error('Unknown source sheet.')
    const validation = validateImport(table, body.mapping, batch.metadata, batch.id, batch.fileName, body.options, REPORT_DATA.allowed_categories)
    const seen = new Set(peers.filter(({ batch: other }) => other.id !== batch.id && other.status === 'committed'
      && other.metadata.source.trim() === batch.metadata.source.trim() && other.metadata.company.trim() === batch.metadata.company.trim()
      && other.metadata.kind === batch.metadata.kind && other.metadata.currency === batch.metadata.currency)
      .flatMap(entry => entry.batch.validation?.records.map(record => record.sourceRecordId).filter(Boolean) ?? []))
    for (const record of validation.records) if (record.sourceRecordId && seen.has(record.sourceRecordId)) validation.issues.push({ row: record.sourceRow, field: 'recordId', severity: 'error', message: 'Source record ID already exists in a committed batch for this company/source/document kind.' })
    if (body.commit && validation.issues.some(issue => issue.severity === 'error')) throw new Error('Resolve validation errors before committing. Preview is not an imported report.')
    const dates = validation.records.map(record => record.date).filter(Boolean).sort()
    return { original, batch: { ...batch, sheet: body.sheet, mapping: body.mapping, options: body.options, validation, revision: batch.revision + 1,
      status: body.commit ? 'committed' : 'draft', ...(body.commit ? { committedAt: new Date().toISOString(), period: { from: dates[0], to: dates.at(-1)! } } : {}) } }
  }, 'import:')).batch)
}

async function reconciliation(query: URLSearchParams, init: RequestInit) {
  const id = query.get('id'), method = init.method ?? 'GET'
  if (method === 'GET') {
    if (!id) return Response.json({ runs: (await browserList<RunEntry>('run:')).map(({ run }) => ({ id: run.id, createdAt: run.createdAt, sample: run.sample, count: run.invoices.length, currency: run.currency })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })
    const entry = required(await browserRead<RunEntry>(`run:${validId(id)}`))
    if (!query.has('original')) return Response.json(entry.run)
    const index = Number(query.get('original')), file = entry.run.files.find(file => file.index === index)
    if (!file?.archived || !entry.originals[index]) throw new Error('Original evidence is not saved in this browser.')
    const blob = entry.originals[index]
    if (await browserDigest(new Uint8Array(await blob.arrayBuffer())) !== file.sha256) throw new Error('Stored original fails its integrity check.')
    return download(blob, file.name, query.has('preview') ? file.mime : undefined)
  }
  if (method === 'POST' && init.body instanceof FormData) {
    const form = init.body, file = await sourceFile(form), id = validId(String(form.get('id'))), index = Number(form.get('index'))
    const sha256 = await browserDigest(new Uint8Array(await file.arrayBuffer()))
    return Response.json((await browserUpdate<RunEntry>(`run:${id}`, value => {
      const entry = required(value), manifest = entry.run.files.find(file => file.index === index)
      if (!manifest || sha256 !== manifest.sha256) throw new Error('Original bytes do not match the extraction manifest.')
      entry.originals[index] = file; manifest.archived = true
      return entry
    })).run)
  }
  if (method === 'POST') {
    const input = validateRunInput(JSON.parse(String(init.body))), id = await browserDigest(JSON.stringify(input))
    return Response.json((await browserUpdate<RunEntry>(`run:${id}`, existing => existing ?? {
      run: { ...input, id, schemaVersion: 1, createdAt: new Date().toISOString(), revision: 0, reviews: {}, history: [] }, originals: {},
    })).run)
  }
  if (method !== 'PUT') throw new Error('Unsupported browser review action.')
  const body = JSON.parse(String(init.body))
  return Response.json((await browserUpdate<RunEntry>(`run:${validId(body.id)}`, value => {
    const entry = required(value), run = entry.run
    if (!Number.isInteger(body.revision) || body.revision !== run.revision) throw new Error('Run changed elsewhere. Reload to see the latest review.')
    const decision = validateDecision(body.decision, run), saved = decide(run, decision)
    run.history.push({ before: run.reviews[String(decision.invoiceIndex)] ?? null, after: saved })
    run.reviews[String(decision.invoiceIndex)] = saved; run.revision++
    return entry
  })).run)
}

async function documents(query: URLSearchParams, init: RequestInit) {
  const scope = { source: query.get('source'), report: query.get('report'), record: query.get('record') } as DocumentScope
  const original = originalTraceRecord(scope.source, scope.report, scope.record)
  const snapshot = await browserDigest(JSON.stringify(scope.source === 'quickbooks' ? QUICKBOOKS_DATA : REPORT_DATA))
  const key = `document:${await browserDigest(JSON.stringify({ ...original, snapshot }))}`
  if (!init.method || init.method === 'GET') {
    const entry = await browserRead<DocumentEntry>(key), fileId = query.get('file')
    if (!fileId) return Response.json({ documents: entry?.documents ?? [] })
    const document = entry?.documents.find(document => document.id === fileId), blob = entry?.originals[fileId]
    if (!document || !blob) throw new Error('Document is not saved with this record in this browser.')
    if (await browserDigest(new Uint8Array(await blob.arrayBuffer())) !== fileId) throw new Error('Stored document differs from the original.')
    return download(blob, document.name, query.has('preview') ? document.mime : undefined)
  }
  if (init.method !== 'POST') throw new Error('Unsupported browser document action.')
  const form = init.body as FormData, file = await sourceFile(form), note = String(form.get('note') ?? '')
  if (file.size > 3 * 1024 * 1024 || file.name.length > 200 || note.length > 1000) throw new Error('Maximum file size is 3 MB; name 200 characters; note 1,000 characters.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-' ? 'application/pdf'
    : [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : ''
  if (!mime) throw new Error('Choose an original PDF, PNG or JPEG file.')
  const id = await browserDigest(bytes)
  return Response.json({ documents: (await browserUpdate<DocumentEntry>(key, value => {
    const entry = value ?? { documents: [], originals: {} }
    if (entry.documents.some(document => document.id === id)) return entry
    if (entry.documents.length >= 20) throw new Error('This record already has 20 supporting documents.')
    entry.originals[id] = new Blob([bytes], { type: mime })
    entry.documents.push({ id, name: file.name, mime, size: file.size, addedAt: new Date().toISOString(), note: note.trim() })
    return entry
  })).documents })
}

// Explicit adapter, not a global fetch override. These persistence requests
// never reach Vercel. AI extraction continues to use normal authenticated fetch.
export async function browserDataRequest(url: string, init: RequestInit = {}): Promise<Response> {
  init.signal?.throwIfAborted()
  try {
    const target = new URL(url, 'https://qfr.local')
    const handler = ({ '/api/imports': imports, '/api/reconciliation-reviews': reconciliation, '/api/trace-documents': documents } as Record<string, typeof imports>)[target.pathname]
    if (!handler) throw new Error('Unknown browser data request.')
    const response = await handler(target.searchParams, init)
    init.signal?.throwIfAborted()
    return response
  } catch (error) {
    if (init.signal?.aborted) throw error
    return Response.json({ error: error instanceof Error ? error.message : 'Browser storage failed.' }, { status: 400 })
  }
}
