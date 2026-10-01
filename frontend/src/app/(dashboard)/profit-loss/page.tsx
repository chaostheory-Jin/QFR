'use client'

import { useMemo, useState } from 'react'
import { REPORT_DATA } from '@/lib/report-data-mock'
import { getFilteredRows, computeMetrics, type FilterState } from '@/lib/report-utils'
import { FilterPanel } from '@/components/report/FilterPanel'
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
  const metrics = useMemo(() => computeMetrics(filteredRows), [filteredRows])

  function changeSource(nextSource: typeof source) {
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
            {company} — {source === 'quickbooks' ? 'QuickBooks downloaded data' : 'Xero demo data'} — {reportData.meta.report_from} to {reportData.meta.report_to} ({currency})
          </p>
        </div>
        <DataSourceSelect value={source} onChange={changeSource} />
      </div>
      <div className="flex flex-col gap-5">
        {review.error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{review.error}</p>}
        <FilterPanel filters={filters} allTypes={allTypes} allAccounts={allAccounts} onChange={setFilters} onReset={() => setFilters(defaultFilters(reportData))} />
        <MetricCards metrics={metrics} />
        <TraceLink href={traceHref('profit-loss', source, filters)} />
        <ChartsSection rows={filteredRows} topN={filters.topN} incomeCategories={reportData.income_categories} />
        <DataTables key={`tables-${source}`} rows={filteredRows} reviewThreshold={reportData.review_threshold} categories={reportData.allowed_categories} reviews={review.reviews} onSaveReview={review.save} reviewReady={review.ready} saving={review.saving} />
      </div>
    </main>
  )
}
