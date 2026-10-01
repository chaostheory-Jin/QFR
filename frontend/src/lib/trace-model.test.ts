import { describe, expect, it } from 'vitest'
import { traceHref, traceFilters } from './trace-navigation'
import { profitTraceGroups, balanceTraceGroups } from './trace-model'
import { originalTraceRecord } from './trace-data'
import { QUICKBOOKS_DATA, QUICKBOOKS_REPORT_DATA, buildQuickBooksBalanceSheet } from './quickbooks-report-data'
import { getFilteredRows, type FilterState } from './report-utils'
import { withLineIds } from './mapping-reviews'
import { filterBalanceSheet, defaultBSFilters } from './balance-sheet-filter'

describe('report explorer financial scope', () => {
  it('carries every P&L filter to the separate page, including names with punctuation', () => {
    const filters: FilterState = { startDate: '2026-03-01', endDate: '2026-07-31', search: 'design & garden', topN: 8, selectedAccounts: new Set(['Expenses > Legal & Professional Fees']), selectedTypes: new Set(['Invoice', 'Sales Receipt']), onlyLowConf: true, onlyUnmapped: true }
    const restored = traceFilters(new URL(traceHref('profit-loss', 'quickbooks', filters), 'http://localhost').searchParams, filters)
    expect(restored).toMatchObject(filters)
  })
  it('preserves hidden balance-sheet sections and account filters', () => {
    const filters = { ...defaultBSFilters(), showLiabilities: false, showEquity: false, selectedAccounts: new Set(['Checking']) }
    expect(traceFilters(new URL(traceHref('balance-sheet', 'quickbooks', filters), 'http://localhost').searchParams, filters)).toMatchObject(filters)
  })
  it('handles invalid dates without crashing the explorer', () => {
    const defaults = { startDate: '2026-01-01', endDate: '2026-08-25' }
    expect(traceFilters(new URLSearchParams('from=2026-99-99&to=2026-02-30'), defaults)).toMatchObject(defaults)
  })
  it('category amounts equal the exact filtered rows and retain original line IDs', () => {
    const rows = withLineIds(QUICKBOOKS_REPORT_DATA.raw_data)
    const filtered = getFilteredRows(rows, { startDate: '2026-06-01', endDate: '2026-06-30', search: '', topN: 8, selectedAccounts: new Set(), selectedTypes: new Set(['Invoice']), onlyLowConf: false, onlyUnmapped: false })
    const groups = profitTraceGroups(filtered)
    expect(groups.reduce((sum, group) => sum + group.amount, 0)).toBeCloseTo(filtered.reduce((sum, row) => sum + row.Amount, 0), 8)
    expect(groups.flatMap(group => group.entries.map(entry => entry.id)).sort()).toEqual(filtered.map(row => row.LineID).sort())
    expect(groups.flatMap(group => group.entries).every(entry => entry.type === 'Invoice' && entry.date.startsWith('2026-06'))).toBe(true)
  })
  it('retains saved classification changes in the category and document view', () => {
    const row = { ...withLineIds(QUICKBOOKS_REPORT_DATA.raw_data)[0], MappedCategory: 'Reviewed category', ReviewStatus: 'Approved' as const }
    const groups = profitTraceGroups([row])
    expect(groups[0]).toMatchObject({ id: 'Reviewed category', amount: row.Amount })
    expect(groups[0].entries[0]).toMatchObject({ category: 'Reviewed category', reviewStatus: 'Approved' })
  })
  it('balances opening plus signed movements at two cutoffs without inventing invoice references', () => {
    for (const end of ['2026-06-30', QUICKBOOKS_DATA.balanceSheet.reportTo]) {
      const data = filterBalanceSheet(buildQuickBooksBalanceSheet(QUICKBOOKS_DATA.balanceSheet.reportFrom, end), { ...defaultBSFilters(), endDate: end })
      for (const group of balanceTraceGroups(data, 'quickbooks', end)) {
        expect(group.opening! + group.entries.reduce((sum, row) => sum + row.amount, 0), group.label).toBeCloseTo(group.amount, 6)
        expect(group.entries.every(row => row.date <= end && row.reference === '')).toBe(true)
        for (const entry of group.entries) expect(originalTraceRecord('quickbooks', 'balance-sheet', entry.id).record).toMatchObject({ date: entry.date, amount: entry.amount })
      }
    }
  })
  it('rejects fabricated transaction and source identities', () => {
    expect(() => originalTraceRecord('quickbooks', 'profit-loss', '../outside')).toThrow('Unknown')
    expect(() => originalTraceRecord('xero', 'balance-sheet', 'movement-0')).toThrow('no transaction')
    expect(() => originalTraceRecord('quickbooks', 'balance-sheet', 'movement-000')).toThrow('no transaction')
  })
})
