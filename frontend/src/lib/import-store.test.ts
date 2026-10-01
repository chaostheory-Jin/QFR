import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImport, loadImport, updateImport } from './import-store'
import { dataPath } from './durable-store'
import { suggestColumns, type ImportMetadata } from './data-intake'

let directory: string
const previous = process.env.QFR_DATA_STORE_DIR
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'qfr-intake-test-')); process.env.QFR_DATA_STORE_DIR = directory })
afterEach(async () => { if (previous === undefined) delete process.env.QFR_DATA_STORE_DIR; else process.env.QFR_DATA_STORE_DIR = previous; await rm(directory, { recursive: true, force: true }) })
const metadata: ImportMetadata = { source: 'Mock ledger', company: 'Mock company', currency: 'AUD', kind: 'ledger', sample: true }
const bytes = new TextEncoder().encode('Date,Amount,Account,Description,LineID\n2026-01-01,12,Rent,Mock expense,id1\n')
const options = { dateFormat: 'ISO' as const, duplicates: 'block' as const }
describe('durable import storage', () => {
  it('archives bytes unchanged, reuses identical upload, commits immutable snapshot with period', async () => {
    const batch = await createImport(bytes, 'mock.csv', metadata)
    expect(new Uint8Array(await readFile(dataPath('imports', batch.id, 'original.bin')))).toEqual(bytes)
    expect((await createImport(bytes, 'mock.csv', metadata)).id).toBe(batch.id)
    const saved = await updateImport(batch.id, 0, batch.sheet, suggestColumns(batch.tables[0].headers), options, true, ['Rent', 'Unmapped'])
    expect(saved.period).toEqual({ from: '2026-01-01', to: '2026-01-01' })
    expect((await loadImport(batch.id)).status).toBe('committed')
    await expect(updateImport(batch.id, saved.revision, batch.sheet, saved.mapping, options, false, [])).rejects.toThrow('immutable')
  })
  it('allows one concurrent commit and rejects stale revisions', async () => {
    const batch = await createImport(bytes, 'mock.csv', metadata)
    const results = await Promise.allSettled([1, 2].map(() => updateImport(batch.id, 0, batch.sheet, suggestColumns(batch.tables[0].headers), options, true, ['Rent'])))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  })
  it('blocks cross-file duplicate IDs but keeps sources, companies and document kinds separate', async () => {
    const first = await createImport(bytes, 'mock.csv', metadata)
    await updateImport(first.id, 0, first.sheet, suggestColumns(first.tables[0].headers), options, true, ['Rent'])
    const secondBytes = new TextEncoder().encode('Date,Amount,Account,Description,LineID\n2026-01-01,13,Rent,Changed expense,id1\n')
    const second = await createImport(secondBytes, 'second.csv', metadata)
    await expect(updateImport(second.id, 0, second.sheet, suggestColumns(second.tables[0].headers), options, true, ['Rent'])).rejects.toThrow('validation')
    for (const scoped of [{ ...metadata, company: 'Another mock company' }, { ...metadata, kind: 'bank' as const }, { ...metadata, source: 'Another source' }]) {
      const other = await createImport(secondBytes, 'second.csv', scoped)
      expect((await updateImport(other.id, 0, other.sheet, suggestColumns(other.tables[0].headers), options, true, ['Rent'])).status).toBe('committed')
    }
  })
  it('cannot commit invalid rows and rejects traversal identities', async () => {
    const batch = await createImport(new TextEncoder().encode('Date,Amount,Account,Description\n2026-02-30,bad,Rent,Expense'), 'bad.csv', metadata)
    await expect(updateImport(batch.id, 0, batch.sheet, suggestColumns(batch.tables[0].headers), options, true, [])).rejects.toThrow('validation')
    await expect(loadImport('../../secret')).rejects.toThrow('identity')
  })
})
