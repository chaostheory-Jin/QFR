import { describe, expect, it } from 'vitest'
import { profitTotals, precedingPeriod, pageWindow } from './report-overview'
import { QUICKBOOKS_REPORT_DATA } from './quickbooks-report-data'
import { buildMonthlyChartData } from './report-utils'
import { applyMappingReviews } from './mapping-reviews'
import { balanceNeedsReview, flattenBalanceLines } from './balance-sheet-review'
import { BALANCE_SHEET_DATA } from './balance-sheet-mock'

describe('financial overview and pagination', () => {
  it('agrees with the existing income and expense chart across the complete source', () => {
    const rows = QUICKBOOKS_REPORT_DATA.raw_data
    const totals = profitTotals(rows, QUICKBOOKS_REPORT_DATA.income_categories)
    const months = buildMonthlyChartData(rows, QUICKBOOKS_REPORT_DATA.income_categories)
    expect(totals.income).toBeCloseTo(months.reduce((n, m) => n + m.income, 0), 8)
    expect(totals.expense).toBeCloseTo(months.reduce((n, m) => n + m.expense, 0), 8)
    expect(totals.profit).toBeCloseTo(totals.income - totals.expense, 8)
  })
  it('retains reversals and uses accepted review classifications', () => {
    const base = QUICKBOOKS_REPORT_DATA.raw_data[0]
    const rows = [{ ...base, LineID: 'income', Amount: 100, MappedCategory: 'Sales' }, { ...base, LineID: 'refund', Amount: -20, MappedCategory: 'Sales' }, { ...base, LineID: 'expense', Amount: 30, MappedCategory: 'Cost' }]
    expect(profitTotals(rows, ['Sales'])).toEqual({ income: 80, expense: 30, profit: 50, margin: 62.5 })
    const reviewed = applyMappingReviews(rows, { expense: { lineId: 'expense', status: 'Approved', category: 'Sales', note: 'Corrected category', revision: 1, updatedAt: '2026-10-21' } }, .7)
    expect(profitTotals(reviewed, ['Sales']).income).toBe(110)
  })
  it('does not divide by zero or negative revenue', () => {
    expect(profitTotals([], []).margin).toBeNull()
    expect(profitTotals([{ ...QUICKBOOKS_REPORT_DATA.raw_data[0], Amount: -10, MappedCategory: 'Sales' }], ['Sales']).margin).toBeNull()
  })
  it('calculates preceding periods across leap days and year boundaries', () => {
    expect(precedingPeriod('2024-03-01', '2024-03-02')).toEqual({ startDate: '2024-02-28', endDate: '2024-02-29' })
    expect(precedingPeriod('2026-01-01', '2026-01-01')).toEqual({ startDate: '2025-12-31', endDate: '2025-12-31' })
    expect(precedingPeriod('2026-02-30', '2026-03-02')).toBeNull()
    expect(precedingPeriod('2026-03-02', '2026-03-01')).toBeNull()
  })
  it('makes every row reachable beyond the old 200-row cap without duplication', () => {
    const rows = Array.from({ length: 251 }, (_, i) => i)
    const visited: number[] = []
    for (let page = 0; page < 11; page++) {
      const window = pageWindow(rows.length, page)
      visited.push(...rows.slice(window.start, window.end))
    }
    expect(visited).toEqual(rows)
    expect(pageWindow(0, 8)).toMatchObject({ page: 0, pageCount: 1, start: 0, end: 0 })
    expect(pageWindow(26, 8)).toMatchObject({ page: 1, pageCount: 2, start: 25, end: 26 })
  })
  it('shows unconfirmed leaf balances without treating totals as extra transactions', () => {
    const lines = flattenBalanceLines(BALANCE_SHEET_DATA)
    const row = lines.find(line => line.kind === 'Line')!
    expect(balanceNeedsReview(row, {})).toBe(true)
    expect(balanceNeedsReview(row, { [row.key]: { lineId: row.key, status: 'Approved', category: row.account, note: '', revision: 1, updatedAt: '2026-10-21' } })).toBe(false)
    expect(lines.filter(line => line.kind === 'Total').some(line => balanceNeedsReview(line, {}))).toBe(false)
  })
})
