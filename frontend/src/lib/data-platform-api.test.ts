import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GET, POST, PUT } from '../app/api/imports/route'
import { POST as createReview } from '../app/api/reconciliation-reviews/route'

let directory: string
const previous = process.env.QFR_DATA_STORE_DIR
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'qfr-data-api-test-')); process.env.QFR_DATA_STORE_DIR = directory })
afterEach(async () => { if (previous === undefined) delete process.env.QFR_DATA_STORE_DIR; else process.env.QFR_DATA_STORE_DIR = previous; await rm(directory, { recursive: true, force: true }) })
const base = 'http://localhost:3111/api/imports'
const headers = { cookie: 'qfr_auth=1', host: 'localhost:3111', origin: 'http://localhost:3111' }
describe('data platform API', () => {
  it('requires sign-in and rejects foreign mutation origins', async () => {
    expect((await GET(new NextRequest(base))).status).toBe(401)
    expect((await POST(new NextRequest(base, { method: 'POST', headers: { ...headers, origin: 'https://foreign.invalid' } }))).status).toBe(403)
    expect((await createReview(new NextRequest('http://localhost:3111/api/reconciliation-reviews', { method: 'POST' }))).status).toBe(401)
  })
  it('uploads, validates, commits, restores and downloads the exact original through the route handlers', async () => {
    const original = 'Date,Amount,Account,Description\n2026-01-01,12,Rent,Mock expense\n'
    const form = new FormData(); form.append('file', new File([original], 'mock.csv', { type: 'text/csv' }))
    form.append('metadata', JSON.stringify({ source: 'Mock', company: 'Mock company', currency: 'AUD', kind: 'ledger', sample: true }))
    const upload = await POST(new NextRequest(base, { method: 'POST', headers, body: form }))
    expect(upload.status).toBe(200)
    const batch = await upload.json()
    const committed = await PUT(new NextRequest(base, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: batch.id, revision: 0, sheet: batch.sheet, mapping: batch.mapping, options: batch.options, commit: true }) }))
    expect(committed.status).toBe(200)
    expect((await (await GET(new NextRequest(`${base}?id=${batch.id}`, { headers }))).json()).status).toBe('committed')
    const download = await GET(new NextRequest(`${base}?id=${batch.id}&original=1`, { headers }))
    expect(download.headers.get('content-type')).toBe('application/octet-stream')
    expect(await download.text()).toBe(original)
  })
  it('rejects malformed update identities, revisions and path traversal', async () => {
    const response = await PUT(new NextRequest(base, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '../outside', revision: -1 }) }))
    expect(response.status).toBe(400)
    expect((await GET(new NextRequest(`${base}?id=../outside`, { headers }))).status).toBe(400)
  })
})
