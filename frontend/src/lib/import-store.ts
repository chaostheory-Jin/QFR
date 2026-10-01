import { join, dirname } from 'node:path'
import { readdir } from 'node:fs/promises'
import { atomicJSON, dataDirectory, dataPath, digest, immutableBytes, locked, readJSON } from './durable-store'
import { readSourceTables, suggestColumns, validateImport, type ColumnMap, type ImportMetadata, type SourceTable, type ValidationResult } from './data-intake'

export type ImportBatch = {
  schemaVersion: 1; id: string; fileName: string; sha256: string; uploadedAt: string; committedAt?: string; metadata: ImportMetadata
  tables: SourceTable[]; sheet: string; mapping: ColumnMap; options: { dateFormat: 'ISO' | 'DMY' | 'MDY'; duplicates: 'block' | 'exclude' | 'keep' }
  revision: number; validation?: ValidationResult; status: 'draft' | 'committed'; period?: { from: string; to: string }
}
export async function loadImport(id: string) {
  const batch = await readJSON<ImportBatch>(dataPath('imports', id))
  if (!batch || batch.schemaVersion !== 1) throw new Error('Import batch not found or unsupported version.')
  return batch
}
export async function listImports() {
  let names: string[] = []
  try { names = await readdir(join(dataDirectory(), 'imports')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const candidates = await Promise.all(names.filter(name => /^[a-f0-9]{64}$/.test(name)).map(id => readJSON<ImportBatch>(dataPath('imports', id))))
  const batches = candidates.filter((batch): batch is ImportBatch => batch !== null)
  if (batches.some(batch => batch.schemaVersion !== 1)) throw new Error('Unsupported import store version.')
  return batches.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map(({ tables, validation, ...batch }) => ({ ...batch, rowCount: validation?.records.length ?? tables[0]?.rows.length ?? 0 }))
}
export async function createImport(bytes: Uint8Array, fileName: string, metadata: ImportMetadata) {
  if (fileName.length > 200 || !metadata || typeof metadata.source !== 'string' || typeof metadata.company !== 'string' || typeof metadata.currency !== 'string') throw new Error('Invalid import metadata.')
  const tables = readSourceTables(bytes, fileName)
  const sha256 = digest(bytes)
  const id = digest(JSON.stringify([sha256, metadata.source.trim(), metadata.company.trim(), metadata.currency, metadata.kind, metadata.sample]))
  const path = dataPath('imports', id)
  return locked(dirname(path), async () => {
    const existing = await readJSON<ImportBatch>(path)
    if (existing) {
      if (existing.schemaVersion !== 1) throw new Error('Unsupported import store version.')
      return existing
    }
    const batch: ImportBatch = { schemaVersion: 1, id, fileName, sha256, uploadedAt: new Date().toISOString(), metadata, tables,
      sheet: tables[0]?.sheet ?? '', mapping: suggestColumns(tables[0]?.headers ?? []), options: { dateFormat: 'ISO', duplicates: 'block' }, revision: 0, status: 'draft' }
    // Validate metadata and structural requirements before persisting, even though row issues stay in the preview.
    const table = tables[0]
    if (!table) throw new Error('Workbook is empty.')
    validateImport(table, { date: table.headers[0], amount: table.headers[0], account: table.headers[0], description: table.headers[0] }, metadata, id, fileName, batch.options, [])
    await immutableBytes(dataPath('imports', id, 'original.bin'), bytes)
    await atomicJSON(path, batch)
    return batch
  })
}
export async function updateImport(id: string, revision: number, sheet: string, mapping: ColumnMap, options: ImportBatch['options'], commit: boolean, categories: string[]) {
  // Global lock makes cross-batch duplicate checks atomic, not just checks in the browser.
  return locked(join(dataDirectory(), 'imports'), async () => {
    const batch = await loadImport(id)
    if (batch.revision !== revision) throw new Error('Import changed elsewhere. Reload before saving.')
    if (batch.status === 'committed') throw new Error('Committed batches are immutable. Upload a corrected source as a new batch.')
    const table = batch.tables.find(table => table.sheet === sheet)
    if (!table) throw new Error('Unknown source sheet.')
    const validation = validateImport(table, mapping, batch.metadata, id, batch.fileName, options, categories)
    const others = await listImports()
    const seen = new Set<string>()
    for (const other of others.filter(other => other.status === 'committed' && other.id !== id && other.metadata.source.trim() === batch.metadata.source.trim()
      && other.metadata.company.trim() === batch.metadata.company.trim() && other.metadata.kind === batch.metadata.kind && other.metadata.currency === batch.metadata.currency)) {
      for (const record of (await loadImport(other.id)).validation!.records) if (record.sourceRecordId) seen.add(record.sourceRecordId)
    }
    for (const record of validation.records) if (record.sourceRecordId && seen.has(record.sourceRecordId)) validation.issues.push({ row: record.sourceRow, field: 'recordId', severity: 'error', message: 'Source record ID already exists in a committed batch for this company/source/document kind.' })
    if (commit && validation.issues.some(issue => issue.severity === 'error')) throw new Error('Resolve validation errors before committing. Preview is not an imported report.')
    const dates = validation.records.map(record => record.date).filter(Boolean).sort()
    const next: ImportBatch = { ...batch, sheet, mapping, options, validation, revision: revision + 1,
      status: commit ? 'committed' : 'draft', ...(commit ? { committedAt: new Date().toISOString(), period: { from: dates[0], to: dates[dates.length - 1] } } : {}) }
    await atomicJSON(dataPath('imports', id), next)
    return next
  })
}
