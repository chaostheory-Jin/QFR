'use client'
import { useMemo, useState } from 'react'
import { filterBalanceSheet, defaultBSFilters, type BSFilterState } from '@/lib/balance-sheet-filter'
import { BalanceSheetFilterPanel } from '@/components/balance-sheet/BalanceSheetFilterPanel'
import { WorkspacePanel } from '@/components/WorkspaceTabs'
import { ReportNavigation, ReportFilters, type ReportTab } from '@/components/report/ReportWorkspace'
import { Button } from '@/components/ui/button'
import { BalanceMovements } from '@/components/balance-sheet/BalanceMovements'
import { flattenBalanceLines, balanceNeedsReview } from '@/lib/balance-sheet-review'
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
import { PayrollReports } from '@/components/payroll/PayrollReports'
import type { ReportSource } from '@/lib/report-source'
import type { DataSource } from '@/lib/link-data'
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
  if (source === 'payroll') return <PayrollReports report="balance-sheet" onSource={setSource} />
  return <AccountingBalanceSheet source={source} setSource={setSource} />
}

function AccountingBalanceSheet({ source, setSource }: { source: DataSource; setSource: (source: ReportSource) => void }) {
  const [tab, setTab] = useState<ReportTab>('overview')
  const [analysis, setAnalysis] = useState<'figures' | 'ratios' | 'aging'>('figures')
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
  const resetKey = JSON.stringify([source, filters.startDate, filters.endDate, filters.search, [...filters.selectedAccounts], filters.showAssets, filters.showLiabilities, filters.showEquity])
  const reviewCount = flattenBalanceLines(data).filter(row => balanceNeedsReview(row, review.reviews)).length
  const quickBooksCashPeriods = useMemo(() => buildQuickBooksCashPeriods(), [])

  function changeSource(nextSource: ReportSource) {
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
        <ReportNavigation id="bs-report" value={tab} onChange={setTab} reviewCount={reviewCount} />
        <ReportFilters summary={`${filters.startDate} → ${filters.endDate} · Current account selection`}><BalanceSheetFilterPanel
        filters={filters}
        data={baseData}
        onChange={setFilters}
        onReset={() => setFilters(filtersForSource(source))}
      /></ReportFilters>
        <WorkspacePanel id="bs-report" value="overview" active={tab}>
        <SummaryCards data={data} />
        <p className="rounded-xl border bg-white p-4 text-sm text-slate-600">Current filtered balances · {data.currency ?? 'AUD'}. Changes compare {data.priorPeriod} with {data.asAt}. {source === 'quickbooks' ? 'Comparison is the opening before the selected start date.' : 'Xero demo comparison uses its fixed 31 Dec 2024 snapshot, not a calculated opening for each selected date.'}</p>
        <div className="flex flex-wrap gap-3"><Button onClick={() => setTab('transactions')}>View balances & movements</Button><Button variant="outline" onClick={() => setTab('review')}>Review {reviewCount} unconfirmed balances</Button></div>
        <TraceLink href={traceHref('balance-sheet', source, filters)} />
        </WorkspacePanel>
        <WorkspacePanel id="bs-report" value="analysis" active={tab}>
        <div className="flex flex-wrap gap-2">{(['figures', 'ratios', 'aging'] as const).map(item => <Button key={item} variant={analysis === item ? 'secondary' : 'outline'} aria-pressed={analysis === item} onClick={() => setAnalysis(item)}>{item === 'figures' ? 'Balance composition' : item === 'ratios' ? 'Financial ratios' : 'Cash & aging'}</Button>)}</div>
        {tab === 'analysis' && analysis === 'figures' && <BalanceSheetFigures data={data} />}
        {tab === 'analysis' && analysis === 'ratios' && <FinancialAnalysisTables data={data} />}
        {tab === 'analysis' && analysis === 'aging' && <><p className="text-xs text-slate-500">Cash and aging use the source-level period/snapshot; account search and section filters do not narrow these panels.</p><CashPosition
          startDate={filters.startDate}
          endDate={filters.endDate}
          periods={source === 'quickbooks' ? quickBooksCashPeriods : undefined}
          currency={baseData.currency}
          isIllustrative={source === 'xero'}
        />
        <AgingAnalysis
          startDate={filters.startDate}
          endDate={filters.endDate}
          buckets={source === 'quickbooks' ? QUICKBOOKS_AGING : undefined}
          currency={baseData.currency}
        /></>}
        </WorkspacePanel>
        {review.error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{review.error}</p>}
        <BalanceTable active={tab} resetKey={resetKey} allData={baseData} movements={<BalanceMovements data={data} source={source} from={filters.startDate} to={filters.endDate} />} key={`${source}-${filters.startDate}-${filters.endDate}`} data={data} reviews={review.reviews} onSaveReview={review.save} reviewReady={review.ready} saving={review.saving} />
      </div>
    </main>
  )
}
