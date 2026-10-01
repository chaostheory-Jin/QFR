import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, open } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { ReportData } from './report-data'
import { applyMappingReviews, withLineIds, type MappingReview, type ReviewDraft, type ReviewMap } from './mapping-reviews'

type Store = {
  schemaVersion: 1
  snapshotId: string
  source: string
  reviews: ReviewMap
  history: MappingReview[]
  reportData: ReportData
}

export function snapshotId(source: string, data: ReportData): string {
  return createHash('sha256').update(JSON.stringify({ source, data })).digest('hex')
}

function storageDirectory() {
  if (process.env.QFR_REVIEW_STORE_DIR) return resolve(process.env.QFR_REVIEW_STORE_DIR)
  if (process.env.VERCEL) throw new Error('Configure QFR_REVIEW_STORE_DIR on durable storage before saving reviews.')
  return resolve(process.cwd(), '..', 'output', 'reviews')
}

function storePath(source: string, id: string) {
  return join(storageDirectory(), `${source}-${id}.json`)
}

async function readStore(source: string, id: string, data: ReportData): Promise<Store> {
  try {
    const stored = JSON.parse(await readFile(storePath(source, id), 'utf8')) as Store
    if (stored.schemaVersion !== 1 || stored.snapshotId !== id || !stored.reviews || !Array.isArray(stored.history)) throw new Error('Invalid review store; restore the audit file before saving.')
    return stored
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { schemaVersion: 1, snapshotId: id, source, reviews: {}, history: [], reportData: { ...data, raw_data: withLineIds(data.raw_data) } }
  }
}

export async function loadMappingReviews(source: string, data: ReportData) {
  const id = snapshotId(source, data)
  const store = await readStore(source, id, data)
  return { snapshotId: id, reviews: store.reviews }
}

export async function saveMappingReview(source: string, data: ReportData, id: string, lineId: string, draft: ReviewDraft, expectedRevision: number) {
  if (snapshotId(source, data) !== id) throw new Error('The dataset has changed. Reload before reviewing.')
  if (!withLineIds(data.raw_data).some(row => row.LineID === lineId)) throw new Error('Unknown source line.')
  const path = storePath(source, id)
  await mkdir(storageDirectory(), { recursive: true })
  // Exclusive lock also protects multiple Next.js worker processes. Never
  // discard a stale-looking lock silently: that could overwrite another writer.
  let lock
  for (let attempt = 0; attempt < 40; attempt++) {
    try { lock = await open(`${path}.lock`, 'wx', 0o600); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await new Promise(resolveWait => setTimeout(resolveWait, 50))
    }
  }
  if (!lock) throw new Error('Review store is busy. Retry shortly.')
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const store = await readStore(source, id, data)
    if ((store.reviews[lineId]?.revision ?? 0) !== expectedRevision) throw new Error('This line was reviewed elsewhere. Reload to see the latest decision.')
    const review: MappingReview = { ...draft, lineId, revision: expectedRevision + 1, updatedAt: new Date().toISOString() }
    store.reviews[lineId] = review
    store.history.push(review)
    // The immutable proposal stays in the bundle. This persisted backend
    // payload is the reviewed mapping result consumed by reporting/export.
    store.reportData = { ...data, raw_data: applyMappingReviews(data.raw_data, store.reviews, data.review_threshold) }
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(store, null, 2))
      await file.sync()
    } finally { await file.close() }
    await rename(temporary, path)
    return { snapshotId: id, reviews: store.reviews }
  } finally {
    await unlink(temporary).catch(() => {})
    try { await lock.close() } finally { await unlink(`${path}.lock`) }
  }
}
