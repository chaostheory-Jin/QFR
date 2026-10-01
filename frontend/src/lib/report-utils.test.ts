import { describe, it, expect } from 'vitest'
import {
  isIncomeRow,
  getFilteredRows,
  computeMetrics,
  buildCategoryChartData,
  buildMonthlyChartData,
  buildConfidenceHistogram,
} from './report-utils'
import type { RawRow } from './report-data'
import type { FilterState } from './report-utils'

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    Type: 'Bill',
    InvoiceNumber: 'INV-001',
    Date: '2025-03-15',
    Contact: 'Acme',
    AccountCode: '453',
    AccountName: 'Office Expenses',
    Description: 'Office supplies',
    Amount: 100,
    MappedCategory: 'Office Expenses',
    Confidence: 0.95,
    Reason: 'match',
    RuleID: null,
    OriginalMappedCategory: 'Office Expenses',
    NormalizationRule: null,
    ...overrides,
  }
}

const defaultFilters: FilterState = {
  startDate: '',
  endDate: '',
  search: '',
  topN: 8,
  selectedTypes: new Set(),
  selectedAccounts: new Set(),
  onlyUnmapped: false,
  onlyLowConf: false,
}

describe('isIncomeRow', () => {
  it('does not infer income from a provider-specific account ID', () => {
    expect(isIncomeRow(row({ AccountCode: '29', MappedCategory: 'Expenses > Equipment Rental' }), [])).toBe(false)
    expect(isIncomeRow(row({ AccountCode: '200' }), [])).toBe(false)
  })
  it('returns true when category is in income list', () => {
    expect(isIncomeRow(row({ AccountCode: '453', MappedCategory: 'Sales' }), ['Sales'])).toBe(true)
  })
  it('returns false otherwise', () => {
    expect(isIncomeRow(row({ AccountCode: '453', MappedCategory: 'Office Expenses' }), ['Sales'])).toBe(false)
  })
})

describe('getFilteredRows', () => {
  it('returns all rows with empty filters', () => {
    expect(getFilteredRows([row(), row()], defaultFilters)).toHaveLength(2)
  })
  it('filters by date range', () => {
    const rows = [row({ Date: '2025-01-15' }), row({ Date: '2025-06-01' })]
    expect(getFilteredRows(rows, { ...defaultFilters, startDate: '2025-01-01', endDate: '2025-03-31' })).toHaveLength(1)
  })
  it('filters by type', () => {
    const rows = [row({ Type: 'Bill' }), row({ Type: 'Invoice' })]
    expect(getFilteredRows(rows, { ...defaultFilters, selectedTypes: new Set(['Bill']) })).toHaveLength(1)
  })
  it('shows all rows when selectedTypes is empty', () => {
    const rows = [row({ Type: 'Bill' }), row({ Type: 'Invoice' })]
    expect(getFilteredRows(rows, { ...defaultFilters, selectedTypes: new Set() })).toHaveLength(2)
  })
  it('filters unmapped only', () => {
    const rows = [row(), row({ MappedCategory: 'Unmapped' })]
    const result = getFilteredRows(rows, { ...defaultFilters, onlyUnmapped: true })
    expect(result).toHaveLength(1)
    expect(result[0].MappedCategory).toBe('Unmapped')
  })
  it('filters low confidence only', () => {
    const rows = [row({ Confidence: 0.9 }), row({ Confidence: 0.5 })]
    const result = getFilteredRows(rows, { ...defaultFilters, onlyLowConf: true })
    expect(result).toHaveLength(1)
    expect(result[0].Confidence).toBe(0.5)
  })
  it('filters by search text', () => {
    const rows = [row({ Contact: 'Acme Corp' }), row({ Contact: 'Other Co' })]
    expect(getFilteredRows(rows, { ...defaultFilters, search: 'acme' })).toHaveLength(1)
  })
  it('returns all rows when selectedAccounts is empty', () => {
    const rows = [row({ AccountName: 'Office Expenses' }), row({ AccountName: 'Sales' })]
    expect(getFilteredRows(rows, { ...defaultFilters, selectedAccounts: new Set() })).toHaveLength(2)
  })
  it('filters by account name', () => {
    const rows = [row({ AccountName: 'Office Expenses' }), row({ AccountName: 'Sales' })]
    const result = getFilteredRows(rows, { ...defaultFilters, selectedAccounts: new Set(['Office Expenses']) })
    expect(result).toHaveLength(1)
    expect(result[0].AccountName).toBe('Office Expenses')
  })
  it('filters by multiple account names', () => {
    const rows = [
      row({ AccountName: 'Office Expenses' }),
      row({ AccountName: 'Sales' }),
      row({ AccountName: 'Consulting & Accounting' }),
    ]
    const result = getFilteredRows(rows, { ...defaultFilters, selectedAccounts: new Set(['Office Expenses', 'Sales']) })
    expect(result).toHaveLength(2)
  })
})

describe('computeMetrics', () => {
  it('computes correct metrics', () => {
    const rows = [
      row({ Amount: 100, MappedCategory: 'Sales', Confidence: 0.9 }),
      row({ Amount: 200, MappedCategory: 'Unmapped', Confidence: 0.5 }),
    ]
    const m = computeMetrics(rows)
    expect(m.totalLines).toBe(2)
    expect(m.totalAmount).toBeCloseTo(300)
    expect(m.mapped).toBe(1)
    expect(m.unmapped).toBe(1)
    expect(m.avgConfidence).toBeCloseTo(0.7)
  })
  it('handles empty rows', () => {
    const m = computeMetrics([])
    expect(m.totalLines).toBe(0)
    expect(m.avgConfidence).toBe(0)
  })
})

describe('buildCategoryChartData', () => {
  it('returns top N by absolute amount, sorted descending', () => {
    const rows = [
      row({ MappedCategory: 'A', Amount: 100 }),
      row({ MappedCategory: 'B', Amount: 300 }),
      row({ MappedCategory: 'C', Amount: 200 }),
    ]
    const result = buildCategoryChartData(rows, 2)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('B')
    expect(result[1].name).toBe('C')
  })
})

describe('buildMonthlyChartData', () => {
  it('groups by YYYY-MM and splits income vs expense', () => {
    const rows = [
      row({ Date: '2025-01-15', Amount: 500, AccountCode: '200', MappedCategory: 'Sales' }),
      row({ Date: '2025-01-20', Amount: 100, AccountCode: '453', MappedCategory: 'Office Expenses' }),
    ]
    const result = buildMonthlyChartData(rows, ['Sales'])
    expect(result).toHaveLength(1)
    expect(result[0].month).toBe('2025-01')
    expect(result[0].income).toBeCloseTo(500)
    expect(result[0].expense).toBeCloseTo(100)
  })
})

describe('buildConfidenceHistogram', () => {
  it('bins into 10 buckets of 0.1 width', () => {
    const rows = [row({ Confidence: 0.95 }), row({ Confidence: 0.99 }), row({ Confidence: 0.5 })]
    const result = buildConfidenceHistogram(rows)
    expect(result).toHaveLength(10)
    expect(result[9].count).toBe(2)
    expect(result[5].count).toBe(1)
  })
})
