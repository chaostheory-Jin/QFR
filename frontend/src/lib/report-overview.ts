import type { RawRow } from './report-data'
import { isIncomeRow } from './report-utils'

export function profitTotals(rows: RawRow[], incomeCategories: string[]) {
  let income = 0, expense = 0
  for (const row of rows) {
    if (isIncomeRow(row, incomeCategories)) income += row.Amount
    else expense += row.Amount
  }
  return { income, expense, profit: income - expense, margin: income > 0 ? (income - expense) / income * 100 : null }
}

// Equal-length preceding period, calculated in UTC to avoid DST drift.
export function precedingPeriod(from: string, to: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  if (!valid(from) || !valid(to) || from > to) return null
  const start = Date.parse(from), end = Date.parse(to), day = 86400000
  return { startDate: new Date(start - (end - start + day)).toISOString().slice(0, 10), endDate: new Date(start - day).toISOString().slice(0, 10) }
}

export function pageWindow(total: number, requested: number, size = 25) {
  const pageCount = Math.max(1, Math.ceil(total / size))
  const page = Math.max(0, Math.min(requested, pageCount - 1))
  return { page, pageCount, start: page * size, end: Math.min(total, (page + 1) * size) }
}
