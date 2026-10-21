'use client'

import { useMemo, useState } from 'react'
import { REPORT_DATA } from '@/lib/report-data-mock'
import { getFilteredRows, computeMetrics, type FilterState, requiresReview } from '@/lib/report-utils'
import { FilterPanel } from '@/components/report/FilterPanel'
import { WorkspacePanel } from '@/components/WorkspaceTabs'
import { ReportNavigation, ReportFilters, type ReportTab } from '@/components/report/ReportWorkspace'
import { ProfitOverview } from '@/components/report/ProfitOverview'
import { Button } from '@/components/ui/button'
import { MetricCards } from '@/components/report/MetricCards'
import { ChartsSection } from '@/components/report/ChartsSection'
import { DataTables } from '@/components/report/DataTables'
import { DataSourceSelect } from '@/components/DataSourceSelect'
import { QUICKBOOKS_DATA, QUICKBOOKS_REPORT_DATA } from '@/lib/quickbooks-report-data'
import { useReportSource } from '@/lib/report-source'
import type { ReportData } from '@/lib/report-data'
import { useMappingReviews } from '@/lib/use-mapping-reviews'
import { TraceLink } from '@/components/trace/TraceLink'
import { traceHref } from '@/lib/trace-navigation'
import { PayrollReports } from '@/components/payroll/PayrollReports'
import type { ReportSource } from '@/lib/report-source'
import type { DataSource } from '@/lib/link-data'

function defaultFilters(data: ReportData): FilterState {
  return {
    startDate: data.meta.report_from,
    endDate: data.meta.report_to,
    search: '',
    topN: 8,
    selectedTypes: new Set(),
    selectedAccounts: new Set(),
    onlyUnmapped: false,
    onlyLowConf: false,
  }
}

export default function ProfitLossPage() {
  const [source, setSource] = useReportSource()
  if (source === 'payroll') return <PayrollReports report="profit-loss" onSource={setSource} />
  return <AccountingProfitLoss source={source} setSource={setSource} />
}

function AccountingProfitLoss({ source, setSource }: { source: DataSource; setSource: (source: ReportSource) => void }) {
  const [tab, setTab] = useState<ReportTab>('overview')
  const reportData = source === 'quickbooks' ? QUICKBOOKS_REPORT_DATA : REPORT_DATA
  const review = useMappingReviews(source, reportData)
  const [filtersBySource, setFiltersBySource] = useState<Record<typeof source, FilterState>>(() => ({
    xero: defaultFilters(REPORT_DATA),
    quickbooks: defaultFilters(QUICKBOOKS_REPORT_DATA),
  }))
  const filters = filtersBySource[source]
  const setFilters = (nextFilters: FilterState) => {
    setFiltersBySource((current) => ({ ...current, [source]: nextFilters }))
  }
  const allTypes = useMemo(() => Array.from(new Set(reportData.raw_data.map((row) => row.Type))).sort(), [reportData])
  const allAccounts = useMemo(() => Array.from(new Set(reportData.raw_data.map((row) => row.AccountName))).sort(), [reportData])
  const filteredRows = useMemo(() => getFilteredRows(review.rows, filters, reportData.review_threshold), [review.rows, reportData.review_threshold, filters])
  const resetKey = JSON.stringify([source, filters.startDate, filters.endDate, filters.search, [...filters.selectedTypes], [...filters.selectedAccounts], filters.onlyUnmapped, filters.onlyLowConf])
  const reviewCount = filteredRows.filter(row => requiresReview(row, reportData.review_threshold) && row.ReviewStatus !== 'Approved').length
  const metrics = useMemo(() => computeMetrics(filteredRows), [filteredRows])

  function changeSource(nextSource: ReportSource) {
    setSource(nextSource)
  }

  const company = source === 'quickbooks' ? QUICKBOOKS_DATA.source.company : 'Demo Company (AU)'
  const currency = source === 'quickbooks' ? QUICKBOOKS_DATA.source.currency : 'AUD'

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Profit and Loss Report</h1>
          <p className="text-sm text-muted-foreground">
            {company} — {source === 'quickbooks' ? 'QuickBooks downloaded data' : 'Xero demo data'} — {filters.startDate} to {filters.endDate} ({currency})
          </p>
        </div>
        <DataSourceSelect value={source} onChange={changeSource} />
      </div>
      <div className="flex flex-col gap-5">
        {review.error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{review.error}</p>}
        <ReportNavigation id="pl-report" value={tab} onChange={setTab} reviewCount={reviewCount} />
        <ReportFilters summary={`${filters.startDate} → ${filters.endDate} · ${filteredRows.length} lines`}><FilterPanel filters={filters} allTypes={allTypes} allAccounts={allAccounts} onChange={setFilters} onReset={() => setFilters(defaultFilters(reportData))} /></ReportFilters>
<WorkspacePanel id="pl-report" value="overview" active={tab}>
          <ProfitOverview rows={filteredRows} allRows={review.rows} incomeCategories={reportData.income_categories} filters={filters} coverage={reportData.meta} threshold={reportData.review_threshold} currency={currency} />
          <div className="flex flex-wrap gap-3"><Button onClick={() => setTab('transactions')}>View transactions</Button><Button variant="outline" onClick={() => setTab('review')}>Review {reviewCount} flagged lines</Button></div>
          <TraceLink href={traceHref('profit-loss', source, filters)} />
        </WorkspacePanel>
        <WorkspacePanel id="pl-report" value="analysis" active={tab}>{tab === 'analysis' && <ChartsSection mode="financial" rows={filteredRows} topN={filters.topN} incomeCategories={reportData.income_categories} />}</WorkspacePanel>
        <DataTables active={tab} resetKey={resetKey} currency={currency} reviewSummary={<><MetricCards metrics={metrics} /><details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">Mapping quality & confidence charts</summary>{tab === 'review' && <ChartsSection mode="quality" rows={filteredRows} topN={filters.topN} incomeCategories={reportData.income_categories} />}</details></>} key={`tables-${source}`} rows={filteredRows} reviewThreshold={reportData.review_threshold} categories={reportData.allowed_categories} reviews={review.reviews} onSaveReview={review.save} reviewReady={review.ready} saving={review.saving} />
      </div>
    </main>
  )
}
