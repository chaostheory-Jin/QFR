'use client'

import { useState, type ReactNode } from 'react'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { Button } from '@/components/ui/button'
import { pageWindow } from '@/lib/report-overview'

export type ReportTab = 'overview' | 'analysis' | 'transactions' | 'review'
export function ReportNavigation({ id, value, onChange, reviewCount }: { id: string; value: ReportTab; onChange: (value: ReportTab) => void; reviewCount?: number }) {
  return <div className="sticky top-0 z-20 bg-slate-50 py-2"><WorkspaceTabs id={id} label="Report workspace" value={value} onChange={onChange} items={[
    { id: 'overview', label: 'Overview' }, { id: 'analysis', label: 'Analysis' },
    { id: 'transactions', label: 'Transactions' }, { id: 'review', label: 'Review', count: reviewCount },
  ]} /></div>
}

export function ReportFilters({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="rounded-xl border bg-white"><summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium">Filters <span className="ml-2 text-xs font-normal text-slate-500">{summary}</span></summary><div className="border-t p-3">{children}</div></details>
}

export function useReportPagination<T>(rows: T[], resetKey: string, size = 25) {
  const [selection, setSelection] = useState({ key: resetKey, page: 0 })
  const window = pageWindow(rows.length, selection.key === resetKey ? selection.page : 0, size)
  return { ...window, total: rows.length, rows: rows.slice(window.start, window.end), onPage: (page: number) => setSelection({ key: resetKey, page }) }
}

export function ReportPagination({ page, pageCount, total, start, end, onPage, label }: { page: number; pageCount: number; total: number; start: number; end: number; onPage: (page: number) => void; label: string }) {
  return <nav aria-label={`${label} pagination`} className="flex flex-wrap items-center justify-between gap-3 py-3"><p role="status" className="text-sm text-slate-500">{total ? start + 1 : 0}–{end} of {total} · Page {page + 1} of {pageCount}</p><div className="flex gap-2"><Button variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="outline" disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>Next</Button></div></nav>
}
