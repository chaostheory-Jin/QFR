'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, ChevronRight, Search, FileText, Layers3, ReceiptText, Check, CircleHelp } from 'lucide-react'
import { DataSourceSelect } from '@/components/DataSourceSelect'
import { Button } from '@/components/ui/button'
import { REPORT_DATA } from '@/lib/report-data-mock'
import { QUICKBOOKS_DATA, QUICKBOOKS_REPORT_DATA, buildQuickBooksBalanceSheet } from '@/lib/quickbooks-report-data'
import { useReportSource } from '@/lib/report-source'
import { useMappingReviews } from '@/lib/use-mapping-reviews'
import { getFilteredRows } from '@/lib/report-utils'
import { filterBalanceSheet } from '@/lib/balance-sheet-filter'
import { buildBalanceSheet, periodForDate } from '@/lib/balance-sheet-periods'
import { traceFilters, traceHref, type TraceReport, type TraceSource } from '@/lib/trace-navigation'
import { profitTraceGroups, balanceTraceGroups, traceLabel, type TraceGroup } from '@/lib/trace-model'
import type { TraceEntry } from '@/lib/trace-data'
import { DocumentPanel } from './DocumentPanel'

type SceneProps = { source: TraceSource; query: string }
export function TraceExplorer() {
  const searchParams = useSearchParams(), router = useRouter()
  const [storedSource, setSource] = useReportSource()
  const source = searchParams.get('source') === 'xero' ? 'xero' : searchParams.get('source') === 'quickbooks' ? 'quickbooks' : storedSource
  const report = searchParams.get('report') === 'balance-sheet' ? 'balance-sheet' : 'profit-loss'
  return <div className="min-h-full bg-[#f6f7fb] px-4 py-6 lg:px-7">
    <div className="mx-auto max-w-[1600px]">
      <Link href={`/${report}`} onClick={() => setSource(source)} className="mb-5 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-700"><ArrowLeft size={15} /> Back to {report === 'profit-loss' ? 'Profit & Loss' : 'Balance Sheet'}</Link>
      <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Report explorer</p><h1 className="text-3xl font-semibold tracking-tight text-slate-900">Explore your report</h1><p className="mt-2 text-sm text-slate-500">Follow an amount from your report to its transactions and supporting documents.</p></div><DataSourceSelect value={source} onChange={next => { setSource(next); router.push(traceHref(report, next)) }} /></div>
      <nav aria-label="Report to explore" className="my-6 flex w-fit gap-1 rounded-xl border border-slate-200 bg-white p-1">{(['profit-loss', 'balance-sheet'] as const).map(item => <Link key={item} href={traceHref(item, source)} className={`rounded-lg px-5 py-2 text-sm font-medium transition ${report === item ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>{item === 'profit-loss' ? 'Profit & Loss' : 'Balance Sheet'}</Link>)}</nav>
      {report === 'profit-loss' ? <ProfitScene key={`pl-${source}`} source={source} query={searchParams.toString()} /> : <BalanceScene key={`bs-${source}`} source={source} query={searchParams.toString()} />}
    </div>
  </div>
}

function ProfitScene({ source, query }: SceneProps) {
  const reportData = source === 'quickbooks' ? QUICKBOOKS_REPORT_DATA : REPORT_DATA
  const review = useMappingReviews(source, reportData)
  const filters = useMemo(() => traceFilters(new URLSearchParams(query), { startDate: reportData.meta.report_from, endDate: reportData.meta.report_to }), [query, reportData])
  const rows = useMemo(() => getFilteredRows(review.rows, filters, reportData.review_threshold), [review.rows, filters, reportData.review_threshold])
  const groups = useMemo(() => profitTraceGroups(rows), [rows])
  if (review.error) return <p role="alert" className="rounded-xl border border-red-200 bg-white p-5 text-red-700">Unable to load the saved report classifications. {review.error} Refresh to try again.</p>
  if (!review.ready) return <p role="status" className="rounded-xl bg-white p-8 text-slate-500">Loading your report and saved classifications…</p>
  return <ExplorerWorkspace report="profit-loss" source={source} query={query} groups={groups} company={source === 'quickbooks' ? QUICKBOOKS_DATA.source.company : 'Demo Company (AU)'} currency={source === 'quickbooks' ? QUICKBOOKS_DATA.source.currency : 'AUD'} period={`${filters.startDate} to ${filters.endDate}`} />
}

function BalanceScene({ source, query }: SceneProps) {
  const filters = useMemo(() => traceFilters(new URLSearchParams(query), source === 'quickbooks' ? { startDate: QUICKBOOKS_DATA.balanceSheet.reportFrom, endDate: QUICKBOOKS_DATA.balanceSheet.reportTo } : { startDate: '2025-01-01', endDate: '2025-12-31' }), [query, source])
  const data = useMemo(() => filterBalanceSheet(source === 'quickbooks' ? buildQuickBooksBalanceSheet(filters.startDate, filters.endDate) : buildBalanceSheet(periodForDate(filters.endDate), '31 Dec 2024'), filters), [source, filters])
  const groups = useMemo(() => balanceTraceGroups(data, source, filters.endDate), [data, source, filters.endDate])
  return <ExplorerWorkspace report="balance-sheet" source={source} query={query} groups={groups} company={data.company} currency={data.currency ?? 'AUD'} period={`As at ${filters.endDate}`} />
}

function ExplorerWorkspace({ report, source, query, groups, company, currency, period }: { report: TraceReport; source: TraceSource; query: string; groups: TraceGroup[]; company: string; currency: string; period: string }) {
  const router = useRouter(), params = new URLSearchParams(query)
  const group = groups.find(group => group.id === params.get('group')) ?? groups[0]
  const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value)
  const largest = Math.max(1, ...groups.map(group => Math.abs(group.amount)))
  function chooseGroup(id: string) { const next = new URLSearchParams(query); next.set('group', id); next.delete('record'); router.replace(`/report-trace?${next}`, { scroll: false }) }
  const filtered = Boolean(params.get('search') || params.has('account') || params.has('type') || params.get('review') === 'true' || params.get('unmapped') === 'true' || ['assets', 'liabilities', 'equity'].some(key => params.get(key) === 'false'))
  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-sm"><p className="text-slate-600">{company} <span className="mx-2 text-slate-300">/</span> {period} <span className="mx-2 text-slate-300">/</span> {currency}</p><Link href={traceHref(report, source)} className="text-xs text-indigo-700">{filtered ? 'Report filters applied · Reset' : 'Reset to full report'}</Link></div>
    <div className="mb-6 grid gap-3 sm:grid-cols-3">{[
      { title: 'Choose an amount', body: report === 'profit-loss' ? `${groups.length} report categories` : `${groups.length} balance-sheet accounts`, icon: Layers3 },
      { title: 'Find the transaction', body: 'See what makes up that amount', icon: ReceiptText },
      { title: 'View the document', body: 'Invoice, receipt or supporting file', icon: FileText },
    ].map(({ title, body, icon: Icon }, index) => <div key={title} className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><Icon size={18} /></span><div className="min-w-0"><p className="text-sm font-medium text-slate-800"><span className="mr-1 text-slate-400">{index + 1}.</span> {title}</p><p className="mt-0.5 text-xs text-slate-500">{body}</p></div>{index < 2 && <ChevronRight className="ml-auto shrink-0 text-slate-300" size={17} />}</div>)}</div>
    {source === 'xero' && report === 'balance-sheet' && <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">These Xero balances are demo figures. Their underlying transactions and invoices are not included.</p>}
    {!group ? <div className="rounded-2xl border bg-white p-12 text-center"><Search size={30} className="mx-auto text-slate-300" /><h2 className="mt-3 font-medium">No report items match these filters</h2><Link className="mt-3 inline-block text-sm text-indigo-600" href={traceHref(report, source)}>Show full report</Link></div> : <div className="grid items-start gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <section aria-label="Report amounts" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-4 py-4"><h2 className="font-semibold">{report === 'profit-loss' ? 'Report categories' : 'Accounts'}</h2><p className="mt-1 text-xs text-slate-500">Select an amount to explore</p></div><div className="max-h-60 overflow-y-auto p-2 xl:max-h-[760px]">{groups.map(item => <button key={item.id} aria-pressed={item.id === group.id} onClick={() => chooseGroup(item.id)} className={`mb-1 w-full rounded-xl px-3 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-indigo-500 ${item.id === group.id ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : 'hover:bg-slate-50'}`}>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{report === 'balance-sheet' ? item.section : item.label.split(' > ')[0]}</p>
        <p className="flex items-start justify-between gap-2 text-sm font-medium text-slate-700"><span>{traceLabel(item.label)}</span>{item.id === group.id && <ChevronRight size={16} className="mt-0.5 shrink-0 text-indigo-600" />}</p><p className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900">{money(item.amount)}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.amount < 0 ? 'bg-amber-400' : 'bg-indigo-400'}`} style={{ width: `${Math.abs(item.amount) / largest * 100}%` }} /></div>
      </button>)}</div></section>
      <div className="min-w-0 space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-slate-500">{report === 'profit-loss' ? group.label.split(' > ').slice(0, -1).join(' / ') || 'Selected category' : group.section}</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{traceLabel(group.label)}</h2></div><div className="text-right"><p className="text-2xl font-semibold tabular-nums tracking-tight">{money(group.amount)}</p><p className="mt-1 text-xs text-slate-500">{report === 'profit-loss' ? 'Category total · current report filters' : 'Closing balance'} · {currency}</p></div></div>
          {report === 'balance-sheet' && group.opening !== undefined ? <><div className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-xl bg-slate-50 p-4"><Amount label={`Opening · ${QUICKBOOKS_DATA.balanceSheet.openingDate}`} value={money(group.opening)} /><span className="text-slate-400">+</span><Amount label={`${group.entries.length} movements`} value={money(group.entries.reduce((sum, row) => sum + row.amount, 0))} /><ArrowRight size={16} className="text-slate-400" /><Amount label="Rebuilt balance" value={money(group.calculated ?? 0)} /></div><p className={`mt-3 flex items-center gap-1.5 text-xs ${Math.abs((group.calculated ?? 0) - group.amount) < 0.005 ? 'text-emerald-700' : 'text-amber-700'}`}>{Math.abs((group.calculated ?? 0) - group.amount) < 0.005 ? <><Check size={14} /> Opening balance and movements agree with this report amount.</> : <><CircleHelp size={14} /> Available records differ from this report by {money(group.amount - (group.calculated ?? 0))}.</>}</p></> : report === 'profit-loss' && <p className="mt-3 text-sm text-slate-500">Made up of {group.entries.length} accounting lines. Select one below to see its reference and documents.</p>}
        </div>
        <TransactionBrowser key={`${report}-${source}-${group.id}`} group={group} report={report} source={source} currency={currency} query={query} />
      </div>
    </div>}
  </>
}
function Amount({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold tabular-nums sm:text-base">{value}</p></div> }

function TransactionBrowser({ group, source, report, currency, query }: { group: TraceGroup; source: TraceSource; report: TraceReport; currency: string; query: string }) {
  const router = useRouter(), [search, setSearch] = useState(''), [limit, setLimit] = useState(40)
  const params = new URLSearchParams(query)
  const entries = group.entries.filter(entry => [entry.contact, entry.reference, entry.description, entry.date, entry.account, String(entry.amount)].join(' ').toLowerCase().includes(search.toLowerCase()))
  const selected = entries.find(entry => entry.id === params.get('record')) ?? entries[0]
  function select(entry: TraceEntry) { const next = new URLSearchParams(query); next.set('group', group.id); next.set('record', entry.id); router.replace(`/report-trace?${next}`, { scroll: false }) }
  const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value)
  return <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
    <section aria-label="Transactions" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Transactions</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{group.entries.length}</span></div><label className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><Search size={16} className="shrink-0 text-slate-400" /><input aria-label="Search transactions" value={search} onChange={event => { setSearch(event.target.value); setLimit(40) }} placeholder="Search name, invoice, date or amount" className="w-full min-w-0 bg-transparent text-sm outline-none" /></label></div>
      <div className="max-h-[660px] overflow-y-auto p-2">{entries.slice(0, limit).map(entry => <button key={entry.id} onClick={() => select(entry)} aria-pressed={selected?.id === entry.id} className={`mb-1 flex w-full items-start gap-3 rounded-xl p-3 text-left transition focus-visible:outline-2 focus-visible:outline-indigo-500 ${selected?.id === entry.id ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : 'hover:bg-slate-50'}`}><span className={`mt-1 rounded-lg p-2 ${selected?.id === entry.id ? 'bg-white text-indigo-600' : 'bg-slate-50 text-slate-400'}`}><ReceiptText size={16} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="truncate text-sm font-medium text-slate-800">{entry.contact || entry.account}</p><p className="text-sm font-semibold tabular-nums text-slate-900">{money(entry.amount)}</p></div><p className="mt-1 truncate text-xs text-slate-500">{entry.description || entry.type}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500"><span>{entry.date}</span><span className="font-medium text-indigo-600">{entry.reference ? `${entry.type} · ${entry.reference}` : 'No invoice reference'}</span></div></div></button>)}
        {!entries.length && <div className="px-4 py-10 text-center text-sm text-slate-500"><FileText size={28} className="mx-auto mb-3 text-slate-300" />{group.entries.length ? 'No transactions match your search.' : group.opening !== undefined ? 'There are no movements in this account. The closing balance comes from the opening snapshot.' : 'Transaction records are not available for this demo balance.'}</div>}
        {entries.length > limit && <Button className="mt-2 w-full" variant="ghost" onClick={() => setLimit(limit + 40)}>Show more transactions ({entries.length - limit} remaining)</Button>}
      </div>
      {entries.length > 0 && <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{entries.length} of {group.entries.length} lines · search results {money(entries.reduce((sum, entry) => sum + entry.amount, 0))}</div>}
    </section>
    {selected ? <DocumentPanel key={`${source}-${report}-${selected.id}`} entry={selected} source={source} report={report} currency={currency} /> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 p-10 text-center"><FileText size={32} className="mx-auto text-slate-300" /><p className="mt-3 text-sm text-slate-500">Choose a transaction to view its document details.</p></div>}
  </div>
}
