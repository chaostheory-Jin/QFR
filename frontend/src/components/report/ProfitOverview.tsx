import { profitTotals, precedingPeriod } from '@/lib/report-overview'
import { getFilteredRows, type FilterState } from '@/lib/report-utils'
import type { RawRow } from '@/lib/report-data'
import { Card, CardContent } from '@/components/ui/card'

export function ProfitOverview({ rows, allRows, incomeCategories, filters, coverage, threshold, currency }: {
  rows: RawRow[]; allRows: RawRow[]; incomeCategories: string[]; filters: FilterState;
  coverage: { report_from: string; report_to: string }; threshold: number; currency: string;
}) {
  const totals = profitTotals(rows, incomeCategories)
  const period = precedingPeriod(filters.startDate, filters.endDate)
  const covered = period && period.startDate >= coverage.report_from && filters.endDate <= coverage.report_to
  const prior = covered ? profitTotals(getFilteredRows(allRows, { ...filters, ...period }, threshold), incomeCategories) : null
  const money = (value: number) => value.toLocaleString('en-AU', { style: 'currency', currency })
  const tiles = [
    { title: 'Revenue', value: money(totals.income), change: prior ? money(totals.income - prior.income) : null },
    { title: 'Expenses', value: money(totals.expense), change: prior ? money(totals.expense - prior.expense) : null },
    { title: 'Net profit / (loss)', value: money(totals.profit), change: prior ? money(totals.profit - prior.profit) : null },
    { title: 'Net margin', value: totals.margin === null ? 'N/A' : `${totals.margin.toFixed(1)}%`, change: prior?.margin != null && totals.margin !== null ? `${(totals.margin - prior.margin).toFixed(1)} pp` : null },
  ]
  return <section aria-label="Financial results" className="space-y-4"><p className="text-sm text-slate-500">{filters.startDate} → {filters.endDate} · {currency} · Current filtered selection</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tiles.map(tile => <Card key={tile.title}><CardContent className="p-5"><p className="text-sm text-slate-500">{tile.title}</p><p className="mt-2 break-words text-2xl font-semibold tabular-nums">{tile.value}</p><p className="mt-3 text-xs text-slate-500">{tile.change !== null ? `Change: ${tile.change}` : 'Comparison unavailable'}</p></CardContent></Card>)}</div>
    <div className="rounded-xl border bg-white p-4 text-sm leading-6 text-slate-600"><p>Revenue − expenses = net result. Returns and reversals retain their signs. Saved review categories drive these figures; unsaved drafts do not.</p><p>{covered && period ? `Changes compare with ${period.startDate} to ${period.endDate}, using the same non-date filters.` : 'The preceding equal-length period is outside the available data, so no change is estimated.'}</p><p className="mt-2 text-xs">Filtered or unresolved records may not represent a complete company P&amp;L. Figures use the same income / expense classification as the existing report charts.</p></div>
  </section>
}
