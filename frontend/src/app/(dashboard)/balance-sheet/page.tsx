'use client'
import { useMemo, useState } from 'react'
import { filterBalanceSheet, defaultBSFilters, type BSFilterState } from '@/lib/balance-sheet-filter'
import { BalanceSheetFilterPanel } from '@/components/balance-sheet/BalanceSheetFilterPanel'
import { SummaryCards } from '@/components/balance-sheet/SummaryCards'
import { BalanceTable } from '@/components/balance-sheet/BalanceTable'
import { FinancialAnalysisTables } from '@/components/balance-sheet/FinancialAnalysisTables'
import { BalanceSheetFigures } from '@/components/balance-sheet/BalanceSheetFigures'
import { CashPosition } from '@/components/balance-sheet/CashPosition'
import { AgingAnalysis } from '@/components/balance-sheet/AgingAnalysis'
import { periodForDate, buildBalanceSheet } from '@/lib/balance-sheet-periods'
import { DataSourceSelect } from '@/components/DataSourceSelect'
import { useReportSource } from '@/lib/report-source'
import { balanceReviewReport } from '@/lib/balance-sheet-review'
import { useMappingReviews } from '@/lib/use-mapping-reviews'
import { TraceLink } from '@/components/trace/TraceLink'
import { traceHref } from '@/lib/trace-navigation'
import {
  buildQuickBooksBalanceSheet,
  buildQuickBooksCashPeriods,
  QUICKBOOKS_AGING,
  QUICKBOOKS_DATA,
} from '@/lib/quickbooks-report-data'

function filtersForSource(source: 'xero' | 'quickbooks'): BSFilterState {
  if (source === 'xero') return defaultBSFilters()
  return {
    ...defaultBSFilters(),
    startDate: QUICKBOOKS_DATA.balanceSheet.reportFrom,
    endDate: QUICKBOOKS_DATA.balanceSheet.reportTo,
  }
}

export default function BalanceSheetPage() {
  const [source, setSource] = useReportSource()
  const [filtersBySource, setFiltersBySource] = useState<Record<typeof source, BSFilterState>>(() => ({
    xero: filtersForSource('xero'),
    quickbooks: filtersForSource('quickbooks'),
  }))
  const filters = filtersBySource[source]
  const setFilters = (nextFilters: BSFilterState) => {
    setFiltersBySource((current) => ({ ...current, [source]: nextFilters }))
  }
  const period = useMemo(() => periodForDate(filters.endDate), [filters.endDate])
  const baseData = useMemo(
    () => source === 'quickbooks'
      ? buildQuickBooksBalanceSheet(filters.startDate, filters.endDate)
      : buildBalanceSheet(period, '31 Dec 2024'),
    [source, filters.startDate, filters.endDate, period],
  )
  const data = useMemo(() => filterBalanceSheet(baseData, filters), [baseData, filters])
  const reviewData = useMemo(() => balanceReviewReport(baseData, filters.startDate, filters.endDate), [baseData, filters.startDate, filters.endDate])
  const review = useMappingReviews(source, reviewData, { reportKind: 'balance-sheet', startDate: filters.startDate, endDate: filters.endDate })
  const quickBooksCashPeriods = useMemo(() => buildQuickBooksCashPeriods(), [])

  function changeSource(nextSource: typeof source) {
    setSource(nextSource)
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Balance Sheet</h1>
          <p className="text-sm text-muted-foreground">
            {baseData.company} — As at {baseData.asAt} — {source === 'quickbooks' ? 'QuickBooks downloaded data' : 'Xero demo data'} ({baseData.currency ?? 'AUD'})
          </p>
        </div>
        <DataSourceSelect value={source} onChange={changeSource} />
      </div>
      <div className="flex flex-col gap-5">
        <BalanceSheetFilterPanel
        filters={filters}
        data={baseData}
        onChange={setFilters}
        onReset={() => setFilters(filtersForSource(source))}
      />
        <CashPosition
          startDate={filters.startDate}
          endDate={filters.endDate}
          periods={source === 'quickbooks' ? quickBooksCashPeriods : undefined}
          currency={baseData.currency}
          isIllustrative={source === 'xero'}
        />
        <SummaryCards data={data} />
        <TraceLink href={traceHref('balance-sheet', source, filters)} />
        <BalanceSheetFigures data={data} />
        <FinancialAnalysisTables data={data} />
        <AgingAnalysis
          startDate={filters.startDate}
          endDate={filters.endDate}
          buckets={source === 'quickbooks' ? QUICKBOOKS_AGING : undefined}
          currency={baseData.currency}
        />
        {review.error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{review.error}</p>}
        <BalanceTable key={`${source}-${filters.startDate}-${filters.endDate}`} data={data} reviews={review.reviews} onSaveReview={review.save} reviewReady={review.ready} saving={review.saving} />
      </div>
    </main>
  )
}
