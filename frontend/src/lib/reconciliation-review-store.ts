import { dirname, join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { atomicJSON, dataDirectory, dataPath, digest, immutableBytes, locked, readJSON } from './durable-store'
import { decide, validateDecision, validateRunInput, type ReconciliationRun } from './reconciliation-review'

export async function loadRun(id: string) {
  const run = await readJSON<ReconciliationRun>(dataPath('reconciliation', id))
  if (!run || run.schemaVersion !== 1) throw new Error('Reconciliation run not found or unsupported version.')
  return run
}
export async function listRuns() {
  let names: string[] = []
  try { names = await readdir(join(dataDirectory(), 'reconciliation')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const candidates = await Promise.all(names.filter(name => /^[a-f0-9]{64}$/.test(name)).map(id => readJSON<ReconciliationRun>(dataPath('reconciliation', id))))
  const runs = candidates.filter((run): run is ReconciliationRun => run !== null)
  if (runs.some(run => run.schemaVersion !== 1)) throw new Error('Unsupported reconciliation store version.')
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(run => ({ id: run.id, createdAt: run.createdAt, sample: run.sample, count: run.invoices.length, currency: run.currency }))
}
export async function createRun(value: unknown) {
  const input = validateRunInput(value)
  const id = digest(JSON.stringify(input)), path = dataPath('reconciliation', id)
  return locked(dirname(path), async () => {
    const existing = await readJSON<ReconciliationRun>(path)
    if (existing) {
      if (existing.schemaVersion !== 1) throw new Error('Unsupported reconciliation store version.')
      return existing
    }
    const run: ReconciliationRun = { ...input, id, schemaVersion: 1, createdAt: new Date().toISOString(), revision: 0, reviews: {}, history: [] }
    await immutableBytes(dataPath('reconciliation', id, 'original-extraction.json'), new TextEncoder().encode(JSON.stringify(input)))
    await atomicJSON(path, run)
    return run
  })
}
export async function archiveRunFile(id: string, index: number, bytes: Uint8Array) {
  return locked(dirname(dataPath('reconciliation', id)), async () => {
    const run = await loadRun(id), file = run.files.find(file => file.index === index)
    if (!file || digest(bytes) !== file.sha256) throw new Error('Original bytes do not match the extraction manifest.')
    await immutableBytes(dataPath('reconciliation', id, index === -1 ? 'statement.bin' : `invoice-${index}.bin`), bytes)
    file.archived = true
    await atomicJSON(dataPath('reconciliation', id), run)
    return run
  })
}
export async function saveDecision(id: string, value: unknown, revision: number) {
  return locked(dirname(dataPath('reconciliation', id)), async () => {
    const run = await loadRun(id)
    if (!Number.isInteger(revision) || run.revision !== revision) throw new Error('Run changed elsewhere. Reload to see the latest review.')
    const decision = validateDecision(value, run), saved = decide(run, decision)
    run.history.push({ before: run.reviews[String(decision.invoiceIndex)] ?? null, after: saved })
    run.reviews[String(decision.invoiceIndex)] = saved
    run.revision++
    await atomicJSON(dataPath('reconciliation', id), run)
    return run
  })
}
