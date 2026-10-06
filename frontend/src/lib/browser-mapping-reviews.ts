import { browserDigest, browserRead, browserUpdate } from './browser-storage'
import { applyMappingReviews, validateReviewDraft, withLineIds, type MappingReview, type ReviewDraft, type ReviewMap } from './mapping-reviews'
import type { ReportData } from './report-data'

type Store = { snapshotId: string; reviews: ReviewMap; history: MappingReview[]; reportData: ReportData }
export async function loadBrowserReviews(identity: string, data: ReportData) {
  const snapshotId = await browserDigest(JSON.stringify({ identity, data }))
  const store = await browserRead<Store>(`mapping:${snapshotId}`)
  return { snapshotId, reviews: store?.reviews ?? {} }
}
export async function saveBrowserReview(identity: string, data: ReportData, snapshotId: string, lineId: string, value: ReviewDraft, revision: number) {
  if (await browserDigest(JSON.stringify({ identity, data })) !== snapshotId) throw new Error('The dataset changed. Reload before reviewing.')
  if (!withLineIds(data.raw_data).some(row => row.LineID === lineId)) throw new Error('Unknown source line.')
  const draft = validateReviewDraft(value, data.allowed_categories)
  const store = await browserUpdate<Store>(`mapping:${snapshotId}`, current => {
    const next = current ?? { snapshotId, reviews: {}, history: [], reportData: data }
    if ((next.reviews[lineId]?.revision ?? 0) !== revision) throw new Error('This line was reviewed in another tab. Reload to see the latest decision.')
    const review: MappingReview = { ...draft, lineId, revision: revision + 1, updatedAt: new Date().toISOString() }
    next.reviews[lineId] = review; next.history.push(review)
    next.reportData = { ...data, raw_data: applyMappingReviews(data.raw_data, next.reviews, data.review_threshold) }
    return next
  })
  return { snapshotId, reviews: store.reviews }
}
