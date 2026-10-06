import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_DATABASE, browserDigest, browserRead, browserUpdate } from './browser-storage'
import { browserDataRequest } from './browser-data'
import { loadBrowserReviews, saveBrowserReview } from './browser-mapping-reviews'
import { loadPayrollReviews, savePayrollReview } from './payroll-reviews'
import { REPORT_DATA } from './report-data-mock'
import { withLineIds } from './mapping-reviews'
import { PAYROLL_LINES } from './payroll-mock'
import { reviewedResults } from './reconciliation-review'
import type { InvoiceExtraction } from './reconciliation'

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(BROWSER_DATABASE); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Persistence must not call a server.') }))
  vi.stubEnv('VERCEL', '1')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function request(url: string, body?: unknown, method = 'POST') {
  const response = await browserDataRequest(url, body === undefined ? {} : { method, body: body instanceof FormData ? body : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error)
  return data
}
const csv = 'Date,Amount,Account,Description,LineID\n2026-01-01,12,Rent,Mock expense,id1\n'
async function uploadCSV(text = csv, company = 'Mock company') {
  const form = new FormData(); form.append('file', new File([text], 'mock.csv')); form.append('metadata', JSON.stringify({ source: 'Mock ledger', company, currency: 'AUD', kind: 'ledger', sample: true }))
  return request('/api/imports', form)
}
const invoice: InvoiceExtraction = { documentIndex: 0, fileName: 'mock.jpg', invoiceNumber: 'INV1', totalAmount: 112, currency: 'AUD', documentType: 'invoice',
  invoiceNumberBox: [0, 0, 0, 0], totalAmountBox: [0, 0, 0, 0], fieldVerification: { invoiceNumberVerified: true, totalAmountVerified: true, arithmeticVerified: false, reason: 'Mock' } }
const input = { sample: true, currency: 'AUD', materiality: 100, invoices: [invoice], statements: [{ invoiceNumber: 'INV1', amount: 110, description: 'Sales invoice' }], files: [] }
const decision = { invoiceIndex: 0, invoiceNumber: 'INV1', amount: 112, currency: 'AUD', documentType: 'invoice', statementIndex: 0, action: 'approve', reason: 'Original checked.', reviewer: 'Mock reviewer', role: 'finance' }

describe('browser-only persistence (also when VERCEL=1)', () => {
  it('persists Blob bytes across separate connections and atomically serializes updates', async () => {
    await browserUpdate('counter', () => 0)
    await Promise.all(Array.from({ length: 8 }, () => browserUpdate<number>('counter', value => value! + 1)))
    expect(await browserRead('counter')).toBe(8)
    await expect(browserUpdate('counter', () => { throw new Error('abort') })).rejects.toThrow('abort')
    expect(await browserRead('counter')).toBe(8)
  })
  it('handles unavailable storage explicitly instead of silently falling back to a Vercel path', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const response = await browserDataRequest('/api/imports')
    expect(response.ok).toBe(false)
    expect((await response.json()).error).toContain('unavailable')
  })
  it('archives unchanged spreadsheet, restores and deduplicates upload, commits immutable batch', async () => {
    const batch = await uploadCSV()
    expect((await uploadCSV()).id).toBe(batch.id)
    const original = await browserDataRequest(`/api/imports?id=${batch.id}&original=1`)
    expect(await original.text()).toBe(csv)
    const updated = await request('/api/imports', { ...batch, commit: true }, 'PUT')
    expect(updated.status).toBe('committed')
    expect((await request(`/api/imports?id=${batch.id}`)).validation.records[0].amount).toBe(12)
    await expect(request('/api/imports', { ...updated, commit: true }, 'PUT')).rejects.toThrow('immutable')
    expect((await request('/api/imports')).batches).toHaveLength(1)
  })
  it('checks cross-file duplicates inside the same atomic transaction', async () => {
    const a = await uploadCSV(), b = await uploadCSV(csv.replace(',12,', ',13,'))
    const results = await Promise.allSettled([a, b].map(batch => request('/api/imports', { ...batch, commit: true }, 'PUT')))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const separate = await uploadCSV(csv, 'Another company')
    expect((await request('/api/imports', { ...separate, commit: true }, 'PUT')).status).toBe('committed')
  })
  it('keeps review materiality, original extraction, revisions and before/after history', async () => {
    const run = await request('/api/reconciliation-reviews', input)
    const first = await request('/api/reconciliation-reviews', { id: run.id, revision: 0, decision }, 'PUT')
    expect(first.reviews['0'].status).toBe('needs_manager')
    await expect(request('/api/reconciliation-reviews', { id: run.id, revision: 0, decision }, 'PUT')).rejects.toThrow('elsewhere')
    const next = await request('/api/reconciliation-reviews', { id: run.id, revision: 1, decision: { ...decision, role: 'manager' } }, 'PUT')
    expect(reviewedResults(next)[0]).toMatchObject({ status: 'approved_variance', matched: false, difference: 2 })
    const restored = await request(`/api/reconciliation-reviews?id=${run.id}`)
    expect(restored.invoices[0].totalAmount).toBe(112)
    expect(restored.history).toHaveLength(2)
  })
  it('requires exact original bytes and restores evidence without uploading to a server', async () => {
    const text = 'mock original bytes', sha256 = await browserDigest(text)
    const run = await request('/api/reconciliation-reviews', { ...input, sample: false, files: [
      { index: -1, name: 'statement.pdf', sha256, mime: 'application/pdf' }, { index: 0, name: 'mock.jpg', sha256, mime: 'image/jpeg' },
    ] })
    await expect(request('/api/reconciliation-reviews', { id: run.id, revision: 0, decision }, 'PUT')).rejects.toThrow('Archive all')
    const corrupt = new FormData(); corrupt.append('id', run.id); corrupt.append('index', '0'); corrupt.append('file', new File(['corrupt'], 'mock.jpg'))
    await expect(request('/api/reconciliation-reviews', corrupt)).rejects.toThrow('do not match')
    for (const index of [-1, 0]) {
      const form = new FormData(); form.append('id', run.id); form.append('index', String(index)); form.append('file', new File([text], 'original'))
      await request('/api/reconciliation-reviews', form)
    }
    expect(await (await browserDataRequest(`/api/reconciliation-reviews?id=${run.id}&original=0`)).text()).toBe(text)
    expect((await request('/api/reconciliation-reviews', { id: run.id, revision: 0, decision }, 'PUT')).history).toHaveLength(1)
  })
  it('links and previews original documents by stable source identity, not user filesystem paths', async () => {
    const row = withLineIds(REPORT_DATA.raw_data)[0]
    const endpoint = `/api/trace-documents?source=xero&report=profit-loss&record=${encodeURIComponent(row.LineID!)}`
    const form = new FormData(); form.append('file', new File(['%PDF-1.4 mock'], 'source.pdf')); form.append('note', 'Checked original')
    const result = await request(endpoint, form), document = result.documents[0]
    expect((await request(endpoint)).documents).toHaveLength(1)
    expect((await request(endpoint, form)).documents).toHaveLength(1)
    const response = await browserDataRequest(`${endpoint}&file=${document.id}&preview=1`)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(await response.text()).toBe('%PDF-1.4 mock')
    expect((await browserDataRequest(`${endpoint.replace('xero', 'quickbooks')}&file=${document.id}`)).ok).toBe(false)
  })
  it('persists mapping reviews and payroll reviews with conflict protection', async () => {
    const row = withLineIds(REPORT_DATA.raw_data)[0], loaded = await loadBrowserReviews('xero', REPORT_DATA)
    const draft = { status: 'Approved' as const, category: REPORT_DATA.allowed_categories[0], note: 'Mock checked' }
    await saveBrowserReview('xero', REPORT_DATA, loaded.snapshotId, row.LineID!, draft, 0)
    expect((await loadBrowserReviews('xero', REPORT_DATA)).reviews[row.LineID!].revision).toBe(1)
    await expect(saveBrowserReview('xero', REPORT_DATA, loaded.snapshotId, row.LineID!, draft, 0)).rejects.toThrow('another tab')
    const line = PAYROLL_LINES.find(line => line.reason)!
    await savePayrollReview(line.id, 'Approved', 'Mock evidence checked', 0)
    expect((await loadPayrollReviews()).history).toHaveLength(1)
    await expect(savePayrollReview(line.id, 'Needs changes', 'Another note', 0)).rejects.toThrow('another tab')
    expect(PAYROLL_LINES.find(row => row.id === line.id)).toEqual(line)
  })
})
