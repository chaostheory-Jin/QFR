import { describe, it, expect } from 'vitest'
import { applyMappingReviews, validateReviewDraft, withLineIds, type MappingReview } from './mapping-reviews'
import { requiresReview, isIncomeRow, getFilteredRows, buildCategoryChartData } from './report-utils'
import { QUICKBOOKS_REPORT_DATA } from './quickbooks-report-data'

const source = QUICKBOOKS_REPORT_DATA.raw_data.find(row => row.AccountCode === '29')!
const review: MappingReview = { lineId: source.LineID!, status: 'Approved', category: 'Income > Services', note: 'Verified manually', updatedAt: '2026-09-30T01:00:00Z', revision: 1 }

describe('mapping review workflow', () => {
  it('never classifies the USD 112 equipment rental as income by account ID', () => {
    expect(source.Amount).toBe(112)
    expect(isIncomeRow(source, QUICKBOOKS_REPORT_DATA.income_categories)).toBe(false)
  })
  it('includes threshold equality and source ambiguity flags, even with high confidence', () => {
    expect(requiresReview({ ...source, ReviewRequired: false, Confidence: 0.7 }, 0.7)).toBe(true)
    expect(requiresReview({ ...source, ReviewRequired: true, Confidence: 0.99 }, 0.7)).toBe(true)
  })
  it('keeps stable identity when filters change or equal source rows occur', () => {
    const rows = withLineIds([{ ...source, LineID: undefined }, { ...source, LineID: undefined }])
    expect(rows[0].LineID).not.toBe(rows[1].LineID)
    const mapped = applyMappingReviews(rows, { [rows[1].LineID!]: { ...review, lineId: rows[1].LineID! } }, 0.7)
    expect(mapped[0].MappedCategory).toBe(source.MappedCategory)
    expect(mapped.slice(1)[0].LineID).toBe(rows[1].LineID)
    expect(mapped[1].MappedCategory).toBe(review.category)
  })
  it('feeds approved corrections into category totals while preserving proposal and AI confidence', () => {
    const [row] = applyMappingReviews([source], { [source.LineID!]: review }, 0.7)
    expect(row.ProposedCategory).toBe(source.MappedCategory)
    expect(row.Confidence).toBe(source.Confidence)
    expect(row.AutoAcceptedCategory).toBe(review.category)
    expect(buildCategoryChartData([row], 10)).toEqual([{ name: review.category, value: 112 }])
    expect(isIncomeRow(row, [review.category])).toBe(true)
  })
  it('returns rejected proposals to Unmapped, retaining amount and audit evidence', () => {
    const [row] = applyMappingReviews([source], { [source.LineID!]: { ...review, status: 'Rejected' } }, 0.7)
    expect(row.MappedCategory).toBe('Unmapped')
    expect(row.Amount).toBe(source.Amount)
    expect(row.AutoAcceptedCategory).toBe('')
    expect(row.ReviewReason).toBeTruthy()
  })
  it('does not apply an unsaved correction marked Needs changes', () => {
    const [row] = applyMappingReviews([source], { [source.LineID!]: { ...review, status: 'Needs changes' } }, 0.7)
    expect(row.MappedCategory).toBe(source.MappedCategory)
    expect(row.AutoAcceptedCategory).toBe('')
  })
  it('rejects invented categories, unknown decisions, and approving Unmapped', () => {
    expect(() => validateReviewDraft({ ...review, category: 'invented' }, ['Sales'])).toThrow()
    expect(() => validateReviewDraft({ ...review, category: 'Sales', status: 'maybe' }, ['Sales'])).toThrow()
    expect(() => validateReviewDraft({ ...review, category: 'Unmapped' }, ['Unmapped'])).toThrow()
  })
  it('refuses ambiguous imported IDs and keeps manual change requests in the review queue', () => {
    expect(() => withLineIds([source, source])).toThrow('unique')
    expect(requiresReview({ ...source, ReviewRequired: false, Confidence: 1, ReviewStatus: 'Needs changes' }, 0.7)).toBe(true)
  })
  it('uses the configured threshold and omits resolved approvals from the review filter', () => {
    const filters = { startDate: '', endDate: '', search: '', topN: 8, selectedTypes: new Set<string>(), selectedAccounts: new Set<string>(), onlyUnmapped: false, onlyLowConf: true }
    const rows = [{ ...source, Confidence: 0.8, ReviewRequired: false }, { ...source, Confidence: 0.9, ReviewRequired: false }]
    expect(getFilteredRows(rows, filters, 0.8)).toHaveLength(1)
    expect(getFilteredRows([{ ...rows[0], ReviewStatus: 'Approved' }], filters, 0.8)).toHaveLength(0)
  })
})
