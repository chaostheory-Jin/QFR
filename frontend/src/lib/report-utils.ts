import type { RawRow } from './report-data'

export type FilterState = {
  startDate: string
  endDate: string
  search: string
  topN: number
  selectedTypes: Set<string>
  selectedAccounts: Set<string>
  onlyUnmapped: boolean
  onlyLowConf: boolean
}

export type Metrics = {
  totalLines: number
  totalAmount: number
  mapped: number
  unmapped: number
  avgConfidence: number
}

export function isIncomeRow(row: RawRow, incomeCategories: string[]): boolean {
  if (row.ReviewStatus === 'Approved') return incomeCategories.includes(row.MappedCategory)
  if (incomeCategories.includes(row.MappedCategory)) return true
  if (row.MappedCategory !== 'Unmapped') return false
  return row.LineRole === 'income' || row.LineRole === 'other_income'
}

export function requiresReview(row: RawRow, threshold: number): boolean {
  return row.ReviewRequired === true || row.Confidence <= threshold || row.MappedCategory === 'Unmapped'
    || row.ReviewStatus === 'Needs changes' || row.ReviewStatus === 'Rejected'
}

export function getFilteredRows(rows: RawRow[], filters: FilterState, reviewThreshold = 0.7): RawRow[] {
  return rows.filter((row) => {
    if (filters.startDate && filters.endDate) {
      if (row.Date < filters.startDate || row.Date > filters.endDate) return false
    }
    if (filters.selectedTypes.size > 0 && !filters.selectedTypes.has(row.Type)) return false
    if (filters.selectedAccounts.size > 0 && !filters.selectedAccounts.has(row.AccountName)) return false
    if (filters.onlyUnmapped && row.MappedCategory !== 'Unmapped') return false
    if (filters.onlyLowConf && (!requiresReview(row, reviewThreshold) || row.ReviewStatus === 'Approved')) return false
    if (filters.search) {
      const hay = [row.Contact, row.Description, row.MappedCategory, row.AccountCode, row.AccountName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(filters.search.toLowerCase())) return false
    }
    return true
  })
}

export function computeMetrics(rows: RawRow[]): Metrics {
  if (rows.length === 0) return { totalLines: 0, totalAmount: 0, mapped: 0, unmapped: 0, avgConfidence: 0 }
  const totalAmount = rows.reduce((sum, r) => sum + r.Amount, 0)
  const mapped = rows.filter((r) => r.MappedCategory !== 'Unmapped').length
  const avgConfidence = rows.reduce((sum, r) => sum + r.Confidence, 0) / rows.length
  return { totalLines: rows.length, totalAmount, mapped, unmapped: rows.length - mapped, avgConfidence }
}

export function buildCategoryChartData(rows: RawRow[], topN: number): { name: string; value: number }[] {
  const totals = new Map<string, number>()
  rows.forEach((r) => {
    const cat = r.MappedCategory || 'Unmapped'
    totals.set(cat, (totals.get(cat) ?? 0) + r.Amount)
  })
  return Array.from(totals.entries())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, topN)
    .map(([name, value]) => ({ name, value }))
}

export function buildMonthlyChartData(
  rows: RawRow[],
  incomeCategories: string[],
): { month: string; income: number; expense: number }[] {
  const map = new Map<string, { income: number; expense: number }>()
  rows.forEach((r) => {
    const month = r.Date.slice(0, 7)
    if (!map.has(month)) map.set(month, { income: 0, expense: 0 })
    const entry = map.get(month)!
    if (isIncomeRow(r, incomeCategories)) {
      entry.income += r.Amount
    } else {
      entry.expense += r.Amount
    }
  })
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { income, expense }]) => ({ month, income, expense }))
}

export function buildSalesByContactChartData(
  rows: RawRow[],
  incomeCategories: string[],
): { name: string; actual: number }[] {
  const map = new Map<string, number>()
  rows
    .filter((r) => isIncomeRow(r, incomeCategories))
    .forEach((r) => {
      map.set(r.Contact, (map.get(r.Contact) ?? 0) + r.Amount)
    })
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, actual]) => ({ name, actual }))
}

export function buildSalesMonthlyTrend(
  rows: RawRow[],
  incomeCategories: string[],
): { month: string; actual: number; budget: number }[] {
  const map = new Map<string, { actual: number; budget: number }>()
  rows
    .filter((r) => isIncomeRow(r, incomeCategories) && r.Budget !== undefined)
    .forEach((r) => {
      const month = r.Date.slice(0, 7)
      const entry = map.get(month) ?? { actual: 0, budget: 0 }
      entry.actual += r.Amount
      entry.budget += r.Budget!
      map.set(month, entry)
    })
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { actual, budget }]) => ({ month, actual, budget }))
}

export function buildConfidenceHistogram(rows: RawRow[]): { bin: string; count: number }[] {
  const buckets = new Array(10).fill(0) as number[]
  rows.forEach((r) => {
    buckets[Math.min(Math.floor(r.Confidence * 10), 9)]++
  })
  return buckets.map((count, i) => ({
    bin: `${(i * 0.1).toFixed(1)}–${((i + 1) * 0.1).toFixed(1)}`,
    count,
  }))
}
