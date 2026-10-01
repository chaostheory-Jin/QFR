import { dirname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { atomicJSON, dataPath, digest, immutableBytes, locked, readJSON } from './durable-store'
import { originalTraceRecord, type SupportingDocument } from './trace-data'
import type { TraceReport, TraceSource } from './trace-navigation'
import { QUICKBOOKS_DATA } from './quickbooks-report-data'
import { REPORT_DATA } from './report-data-mock'

export type DocumentScope = { source: TraceSource; report: TraceReport; record: string }
type DocumentStore = { schemaVersion: 1; original: ReturnType<typeof originalTraceRecord> & { snapshot: string }; documents: SupportingDocument[] }
function identity(scope: DocumentScope) {
  const record = originalTraceRecord(scope.source, scope.report, scope.record)
  const original = { ...record, snapshot: digest(JSON.stringify(scope.source === 'quickbooks' ? QUICKBOOKS_DATA : REPORT_DATA)) }
  return { original, id: digest(JSON.stringify(original)) }
}
async function readStore(scope: DocumentScope) {
  const { original, id } = identity(scope)
  const value = await readJSON<DocumentStore>(dataPath('documents', id))
  if (value && (value.schemaVersion !== 1 || digest(JSON.stringify(value.original)) !== id)) throw new Error('Unsupported document store or changed source record.')
  return { id, store: value ?? { schemaVersion: 1 as const, original, documents: [] } }
}
export async function listTraceDocuments(scope: DocumentScope) { return (await readStore(scope)).store.documents }
function documentMime(bytes: Uint8Array): string {
  const head = Buffer.from(bytes)
  if (head.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return 'image/jpeg'
  throw new Error('Choose an original PDF, PNG or JPEG file.')
}
export async function addTraceDocument(scope: DocumentScope, bytes: Uint8Array, name: string, note: string) {
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new Error('Choose a file up to 3 MB.')
  if (!name.trim() || name.length > 200 || note.length > 1000) throw new Error('File name or note is too long.')
  const mime = documentMime(bytes), { id } = identity(scope)
  return locked(dirname(dataPath('documents', id)), async () => {
    const { store } = await readStore(scope), fileId = digest(bytes)
    if (store.documents.some(document => document.id === fileId)) return store.documents
    if (store.documents.length >= 20) throw new Error('This record already has 20 supporting documents.')
    await immutableBytes(dataPath('documents', id, `${fileId}.bin`), bytes)
    store.documents.push({ id: fileId, name, mime, size: bytes.length, addedAt: new Date().toISOString(), note: note.trim() })
    await atomicJSON(dataPath('documents', id), store)
    return store.documents
  })
}
export async function readTraceDocument(scope: DocumentScope, fileId: string) {
  const { id, store } = await readStore(scope)
  const document = store.documents.find(file => file.id === fileId)
  if (!document) throw new Error('Document is not linked to this record.')
  const bytes = await readFile(dataPath('documents', id, `${document.id}.bin`))
  if (digest(bytes) !== document.id) throw new Error('Stored document differs from the original.')
  return { document, bytes }
}
