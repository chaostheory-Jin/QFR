import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadMappingReviews, saveMappingReview } from './mapping-review-store'
import { QUICKBOOKS_REPORT_DATA } from './quickbooks-report-data'

const data = { ...QUICKBOOKS_REPORT_DATA, raw_data: QUICKBOOKS_REPORT_DATA.raw_data.slice(0, 2) }
const draft = { status: 'Approved' as const, category: data.raw_data[0].MappedCategory, note: 'Supporting document verified' }
let directory: string
const previousDirectory = process.env.QFR_REVIEW_STORE_DIR

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'qfr-review-test-'))
  process.env.QFR_REVIEW_STORE_DIR = directory
})
afterEach(async () => {
  if (previousDirectory === undefined) delete process.env.QFR_REVIEW_STORE_DIR
  else process.env.QFR_REVIEW_STORE_DIR = previousDirectory
  await rm(directory, { recursive: true, force: true })
})

describe('persisted review results', () => {
  it('reloads decisions and writes effective backend results plus append-only audit history', async () => {
    const initial = await loadMappingReviews('quickbooks', data)
    const id = data.raw_data[0].LineID!
    await saveMappingReview('quickbooks', data, initial.snapshotId, id, draft, 0)
    await saveMappingReview('quickbooks', data, initial.snapshotId, id, { ...draft, status: 'Rejected' }, 1)
    const reloaded = await loadMappingReviews('quickbooks', data)
    expect(reloaded.reviews[id].status).toBe('Rejected')
    const path = (await readdir(directory)).find(name => name.endsWith('.json'))!
    const store = JSON.parse(await readFile(join(directory, path), 'utf8'))
    expect(store.history).toHaveLength(2)
    expect(store.reportData.raw_data[0].MappedCategory).toBe('Unmapped')
    expect(store.reportData.raw_data[0].ProposedCategory).toBe(data.raw_data[0].MappedCategory)
    expect(store.reportData.raw_data[0].ReviewerNote).toBe(draft.note)
  })
  it('preserves concurrent decisions on separate lines', async () => {
    const initial = await loadMappingReviews('quickbooks', data)
    await Promise.all(data.raw_data.map(row => saveMappingReview('quickbooks', data, initial.snapshotId, row.LineID!, { ...draft, category: row.MappedCategory }, 0)))
    expect(Object.keys((await loadMappingReviews('quickbooks', data)).reviews)).toHaveLength(2)
  })
  it('rejects stale revisions instead of overwriting another reviewer', async () => {
    const initial = await loadMappingReviews('quickbooks', data)
    const id = data.raw_data[0].LineID!
    await saveMappingReview('quickbooks', data, initial.snapshotId, id, draft, 0)
    await expect(saveMappingReview('quickbooks', data, initial.snapshotId, id, draft, 0)).rejects.toThrow('reviewed elsewhere')
    expect((await readdir(directory)).some(name => name.endsWith('.lock'))).toBe(false)
  })
  it('isolates sources and changed snapshots', async () => {
    const initial = await loadMappingReviews('quickbooks', data)
    await saveMappingReview('quickbooks', data, initial.snapshotId, data.raw_data[0].LineID!, draft, 0)
    expect((await loadMappingReviews('xero', data)).reviews).toEqual({})
    const changed = { ...data, raw_data: [{ ...data.raw_data[0], Amount: 999 }] }
    expect((await loadMappingReviews('quickbooks', changed)).reviews).toEqual({})
    await expect(saveMappingReview('quickbooks', changed, initial.snapshotId, changed.raw_data[0].LineID!, draft, 0)).rejects.toThrow('dataset has changed')
  })
})
