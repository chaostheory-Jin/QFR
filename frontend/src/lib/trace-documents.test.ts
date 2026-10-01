import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { GET, POST } from '../app/api/trace-documents/route'
import { addTraceDocument, listTraceDocuments, readTraceDocument, type DocumentScope } from './trace-document-store'

let directory: string
const previous = process.env.QFR_DATA_STORE_DIR
const scope: DocumentScope = { source: 'quickbooks', report: 'profit-loss', record: 'quickbooks-pl-1' }
const original = Buffer.from('%PDF-1.4\nSynthetic document fixture\n%%EOF')
const base = `http://localhost:3000/api/trace-documents?${new URLSearchParams(scope)}`
const headers = { cookie: 'qfr_auth=1', host: 'localhost:3000', origin: 'http://localhost:3000' }
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'qfr-trace-test-')); process.env.QFR_DATA_STORE_DIR = directory })
afterEach(async () => { if (previous === undefined) delete process.env.QFR_DATA_STORE_DIR; else process.env.QFR_DATA_STORE_DIR = previous; await rm(directory, { recursive: true, force: true }) })
describe('persisted supporting documents', () => {
  it('archives the exact bytes, reloads metadata and isolates another transaction', async () => {
    const documents = await addTraceDocument(scope, original, 'synthetic.pdf', 'Manually checked receipt')
    expect(await listTraceDocuments(scope)).toEqual(documents)
    expect((await readTraceDocument(scope, documents[0].id)).bytes).toEqual(original)
    const other = { ...scope, record: 'quickbooks-pl-2' }
    expect(await listTraceDocuments(other)).toEqual([])
    await expect(readTraceDocument(other, documents[0].id)).rejects.toThrow('not linked')
    await expect(readTraceDocument(scope, '../outside')).rejects.toThrow('not linked')
  })
  it('deduplicates identical uploads and preserves independent concurrent uploads', async () => {
    await Promise.all([
      addTraceDocument(scope, original, 'synthetic.pdf', ''),
      addTraceDocument(scope, original, 'same-bytes.pdf', ''),
      addTraceDocument(scope, Buffer.from('%PDF-1.4\nSecond test\n%%EOF'), 'second.pdf', ''),
    ])
    expect(await listTraceDocuments(scope)).toHaveLength(2)
  })
  it('rejects disguised HTML, oversize files, missing names and nonexistent records', async () => {
    await expect(addTraceDocument(scope, Buffer.from('<html>not a PDF</html>'), 'invoice.pdf', '')).rejects.toThrow('PDF, PNG or JPEG')
    await expect(addTraceDocument(scope, Buffer.alloc(3 * 1024 * 1024 + 1), 'big.pdf', '')).rejects.toThrow('3 MB')
    await expect(addTraceDocument(scope, original, '', '')).rejects.toThrow('name')
    await expect(addTraceDocument({ ...scope, record: 'fake' }, original, 'synthetic.pdf', '')).rejects.toThrow('Unknown report record')
  })
  it('requires the existing sign-in and same-origin mutation guard', async () => {
    expect((await GET(new NextRequest(base))).status).toBe(401)
    expect((await POST(new NextRequest(base, { method: 'POST', headers: { ...headers, origin: 'https://foreign.invalid' } }))).status).toBe(403)
  })
  it('serves uploaded originals as downloads and controlled previews through the real API', async () => {
    const form = new FormData(); form.append('file', new File([original], 'synthetic.pdf', { type: 'application/pdf' })); form.append('note', 'QA fixture')
    const saved = await POST(new NextRequest(base, { method: 'POST', headers, body: form }))
    expect(saved.status).toBe(200)
    const { documents } = await saved.json()
    const restored = await GET(new NextRequest(base, { headers }))
    expect((await restored.json()).documents).toEqual(documents)
    const download = await GET(new NextRequest(`${base}&file=${documents[0].id}`, { headers }))
    expect(download.headers.get('content-type')).toBe('application/octet-stream')
    expect(Buffer.from(await download.arrayBuffer())).toEqual(original)
    const preview = await GET(new NextRequest(`${base}&file=${documents[0].id}&preview=1`, { headers }))
    expect(preview.headers.get('content-type')).toBe('application/pdf')
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff')
    expect(preview.headers.get('content-security-policy')).toContain('sandbox')
    expect(preview.headers.get('cache-control')).toBe('no-store')
  })
})
