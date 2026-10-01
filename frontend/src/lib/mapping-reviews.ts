import type { RawRow } from './report-data'
import { requiresReview } from './report-utils'

export const REVIEW_STATUSES = ['Pending', 'Approved', 'Needs changes', 'Rejected'] as const
export type ReviewStatus = typeof REVIEW_STATUSES[number]
export type MappingReview = {
  lineId: string
  status: ReviewStatus
  category: string
  note: string
  revision: number
  updatedAt: string
}
export type ReviewDraft = Pick<MappingReview, 'status' | 'category' | 'note'>
export type ReviewMap = Record<string, MappingReview>

// IDs are assigned on the complete source dataset, never on a filtered table.
// A separate snapshot hash isolates new imports and duplicate source lines.
export function withLineIds(rows: RawRow[]): RawRow[] {
  const ids = new Set<string>()
  return rows.map((row, index) => {
    const id = row.LineID ?? `line-${index + 1}`
    if (!id || ids.has(id)) throw new Error('Source lines must have unique, non-empty IDs.')
    ids.add(id)
    return { ...row, LineID: id }
  })
}

export function validateReviewDraft(value: unknown, categories: string[]): ReviewDraft {
  if (!value || typeof value !== 'object') throw new Error('Invalid review.')
  const draft = value as Partial<ReviewDraft>
  if (!REVIEW_STATUSES.includes(draft.status as ReviewStatus)) throw new Error('Invalid review status.')
  if (typeof draft.note !== 'string' || draft.note.length > 4000) throw new Error('Review note must be at most 4000 characters.')
  if (typeof draft.category !== 'string' || !categories.includes(draft.category)) throw new Error('Select a configured category.')
  if (draft.status === 'Approved' && draft.category === 'Unmapped') throw new Error('Choose a category before approving an unmapped line.')
  return { status: draft.status as ReviewStatus, category: draft.category, note: draft.note.trim() }
}

export function applyMappingReviews(rows: RawRow[], reviews: ReviewMap, threshold: number): RawRow[] {
  return withLineIds(rows).map(row => {
    const review = reviews[row.LineID!]
    const proposed = row.ProposedCategory ?? row.MappedCategory
    const required = requiresReview(row, threshold)
    const reason = row.ReviewReason || (required ? `Confidence at or below ${threshold}, unmapped category, or source review flag.` : '')
    const category = review?.status === 'Approved' ? review.category
      : review?.status === 'Rejected' ? 'Unmapped' : proposed
    const accepted = review?.status === 'Approved' || (!required && (!review || review.status === 'Pending'))
    return {
      ...row,
      ProposedCategory: proposed,
      MappedCategory: category,
      ReviewRequired: required,
      ReviewReason: reason,
      AutoAcceptedCategory: accepted ? category : '',
      ReviewStatus: review?.status ?? 'Pending',
      ReviewerNote: review?.note ?? '',
      ReviewedAt: review?.updatedAt,
    }
  })
}
