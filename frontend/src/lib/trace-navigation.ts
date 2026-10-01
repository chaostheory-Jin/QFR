import type { FilterState } from './report-utils'
import type { BSFilterState } from './balance-sheet-filter'

export type TraceReport = 'profit-loss' | 'balance-sheet'
export type TraceSource = 'xero' | 'quickbooks'
export function traceHref(report: TraceReport, source: TraceSource, filters?: FilterState | BSFilterState) {
  const query = new URLSearchParams({ report, source })
  if (filters) {
    query.set('from', filters.startDate); query.set('to', filters.endDate); query.set('search', filters.search)
    for (const account of filters.selectedAccounts) query.append('account', account)
    if ('selectedTypes' in filters) {
      for (const type of filters.selectedTypes) query.append('type', type)
      query.set('unmapped', String(filters.onlyUnmapped)); query.set('review', String(filters.onlyLowConf))
    } else {
      query.set('assets', String(filters.showAssets)); query.set('liabilities', String(filters.showLiabilities)); query.set('equity', String(filters.showEquity))
    }
  }
  return `/report-trace?${query}`
}
export function traceFilters(query: URLSearchParams, defaults: { startDate: string; endDate: string }): FilterState & BSFilterState {
  const date = (key: string, fallback: string) => {
    const value = query.get(key) ?? '', parsed = new Date(`${value}T00:00:00Z`)
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : fallback
  }
  return {
    startDate: date('from', defaults.startDate), endDate: date('to', defaults.endDate), search: query.get('search') ?? '',
    selectedAccounts: new Set(query.getAll('account')), selectedTypes: new Set(query.getAll('type')),
    onlyUnmapped: query.get('unmapped') === 'true', onlyLowConf: query.get('review') === 'true', topN: 8,
    showAssets: query.get('assets') !== 'false', showLiabilities: query.get('liabilities') !== 'false', showEquity: query.get('equity') !== 'false',
  }
}
