import { describe, expect, it } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { readSourceTables, suggestColumns, validateImport, type ColumnMap, type ImportMetadata, type ValidationResult } from './data-intake'
import { createImport, updateImport } from './import-store'

const directory = fileURLToPath(new URL('../../../test-data/uploads/', import.meta.url))
type Options = { dateFormat: 'ISO' | 'DMY' | 'MDY'; duplicates: 'block' | 'exclude' | 'keep' }
type Expected = { records: number; errors: Record<string, number>; warnings: Record<string, number>; excludedRows?: number[]; categoryTotals?: Record<string, number>; category?: string; role?: string }
type Fixture = { file: string; bytes: number; sha256: string; metadata: ImportMetadata; readError?: string; sheets: Array<{ name: string; rows: number; kind?: ImportMetadata['kind']; mapping?: ColumnMap; options: Options; expected: Expected; alternatives?: Array<{ options: Options; expected: Expected }> }> }
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as { synthetic: boolean; categories: string[]; fixtures: Fixture[] }
function verify(result: ValidationResult, expected: Expected) {
  expect(result.records).toHaveLength(expected.records)
  for (const severity of ['error', 'warning'] as const) {
    const counts: Record<string, number> = {}
    for (const issue of result.issues.filter(issue => issue.severity === severity)) counts[issue.field] = (counts[issue.field] ?? 0) + 1
    expect(counts).toEqual(expected[severity === 'error' ? 'errors' : 'warnings'])
  }
  expect(result.excludedRows).toEqual(expected.excludedRows ?? [])
  if (expected.categoryTotals) {
    const cents: Record<string, number> = {}
    for (const record of result.records) cents[record.category] = (cents[record.category] ?? 0) + Math.round(record.amount * 100)
    expect(Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, value / 100]))).toEqual(expected.categoryTotals)
  }
  if (expected.category) expect(result.records.every(record => record.category === expected.category)).toBe(true)
  if (expected.role) expect(result.records.every(record => record.role === expected.role)).toBe(true)
}
describe('delivered upload fixture pack', () => {
  for (const fixture of manifest.fixtures) {
    it(fixture.file, async () => {
      expect(manifest.synthetic).toBe(true)
      const bytes = await readFile(join(directory, fixture.file))
      expect(bytes.length).toBe(fixture.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256)
      if (fixture.readError) {
        expect(() => readSourceTables(bytes, fixture.file)).toThrow(fixture.readError)
        return
      }
      const tables = readSourceTables(bytes, fixture.file)
      expect(tables.map(table => table.sheet)).toEqual(fixture.sheets.map(sheet => sheet.name))
      for (const sheet of fixture.sheets) {
        const table = tables.find(table => table.sheet === sheet.name)!
        expect(table.rows).toHaveLength(sheet.rows)
        const mapping = sheet.mapping ?? suggestColumns(table.headers)
        const metadata = { ...fixture.metadata, kind: sheet.kind ?? fixture.metadata.kind }
        verify(validateImport(table, mapping, metadata, 'fixture-qa', fixture.file, sheet.options, manifest.categories), sheet.expected)
        for (const alternate of sheet.alternatives ?? []) verify(validateImport(table, mapping, metadata, 'fixture-qa', fixture.file, alternate.options, manifest.categories), alternate.expected)
        if (/dates_(dmy|mdy)/.test(fixture.file)) {
          const iso = validateImport(table, mapping, metadata, 'fixture-qa', fixture.file, { ...sheet.options, dateFormat: 'ISO' }, manifest.categories)
          expect(iso.issues.filter(issue => issue.field === 'date' && issue.severity === 'error')).toHaveLength(30)
        }
        if (fixture.file.includes('edge_cases')) {
          const result = validateImport(table, mapping, metadata, 'fixture-qa', fixture.file, sheet.options, manifest.categories)
          expect(result.records[2].amount).toBe(1250.5)
          expect(result.records[3]).toMatchObject({ sourceRecordId: '00000042', description: 'Synthetic café, "meeting"\n第二行摘要' })
        }
      }
    })
  }
  it('blocks the five cross-batch IDs only after committing A; an identical re-upload is idempotent', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'qfr-fixture-store-'))
    const previous = process.env.QFR_DATA_STORE_DIR
    process.env.QFR_DATA_STORE_DIR = temporary
    try {
      const first = manifest.fixtures.find(fixture => fixture.file === '16_cross_batch_a_20.csv')!
      const second = manifest.fixtures.find(fixture => fixture.file === '17_cross_batch_b_20.csv')!
      const bytesA = await readFile(join(directory, first.file))
      const a = await createImport(bytesA, first.file, first.metadata)
      await updateImport(a.id, 0, a.sheet, a.mapping, a.options, true, manifest.categories)
      expect((await createImport(bytesA, first.file, first.metadata)).id).toBe(a.id)
      const b = await createImport(await readFile(join(directory, second.file)), second.file, second.metadata)
      const preview = await updateImport(b.id, 0, b.sheet, b.mapping, b.options, false, manifest.categories)
      expect(preview.validation!.issues.filter(issue => issue.field === 'recordId' && issue.severity === 'error')).toHaveLength(5)
      await expect(updateImport(b.id, preview.revision, b.sheet, b.mapping, b.options, true, manifest.categories)).rejects.toThrow('Resolve validation errors')
    } finally {
      if (previous === undefined) delete process.env.QFR_DATA_STORE_DIR
      else process.env.QFR_DATA_STORE_DIR = previous
      await rm(temporary, { recursive: true, force: true })
    }
  })
})
