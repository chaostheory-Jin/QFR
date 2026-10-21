'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ExportControls, type ExportMode } from '@/components/ExportControls'
import { exportRowsToExcel, type ExportRow } from '@/lib/excel-export'
import type { BalanceSheetData } from '@/lib/balance-sheet-mock'
import { flattenBalanceLines, balanceNeedsReview, type BalanceLine } from '@/lib/balance-sheet-review'
import type { ReviewDraft, ReviewMap, ReviewStatus } from '@/lib/mapping-reviews'
import { WorkspacePanel } from '@/components/WorkspaceTabs'
import { ReportPagination, useReportPagination, type ReportTab } from '@/components/report/ReportWorkspace'

export function BalanceTable({ data, allData = data, reviewThreshold = 0.7, reviews, onSaveReview, reviewReady, saving, active, resetKey, movements }: {
  data: BalanceSheetData; allData?: BalanceSheetData; reviewThreshold?: number; reviews: ReviewMap;
  onSaveReview: (lineId: string, draft: ReviewDraft) => Promise<void>; reviewReady: boolean; saving: boolean;
  active: ReportTab; resetKey: string; movements: ReactNode;
}) {
  const [reviewState, setReviewState] = useState<Record<string, ReviewDraft>>({})
  const [exportMode, setExportMode] = useState<ExportMode>('summary')
  const [showAll, setShowAll] = useState(false)
  const [detail, setDetail] = useState<'balances' | 'movements'>('balances')
  const flattenedRows = useMemo(() => flattenBalanceLines(data), [data])
  const allRows = useMemo(() => flattenBalanceLines(allData), [allData])
  const reviewRows = flattenedRows.filter(row => showAll || balanceNeedsReview(row, reviews))
    .sort((a, b) => (a.confidence ?? 1) - (b.confidence ?? 1))
  const balancesPage = useReportPagination(flattenedRows, resetKey)
  const reviewsPage = useReportPagination(reviewRows, resetKey + showAll)
  const money = (value: number) => value.toLocaleString('en-AU', { style: 'currency', currency: data.currency ?? 'AUD' })

  function reviewFor(row: BalanceLine): ReviewDraft {
    return reviewState[row.key] ?? reviews[row.key] ?? { status: 'Pending', note: '', category: row.account }
  }
  function updateReview(row: BalanceLine, patch: Partial<ReviewDraft>) {
    setReviewState(current => ({ ...current, [row.key]: { ...reviewFor(row), ...patch } }))
  }
  async function saveAllReviews() {
    for (const [lineId, draft] of Object.entries(reviewState)) {
      const row = allRows.find(line => line.key === lineId)
      if (!row) continue
      try {
        await onSaveReview(lineId, { ...draft, category: row.account })
        setReviewState(current => { const next = { ...current }; delete next[lineId]; return next })
      } catch { break }
    }
  }
  function lineToExport(row: BalanceLine): ExportRow {
    const review = reviews[row.key] ?? { status: 'Pending', note: '' }
    return {
      'Line ID': row.key,
      Section: row.section,
      Group: row.group,
      Type: row.kind,
      Account: row.account,
      [data.asAt]: row.current,
      [data.priorPeriod]: row.prior,
      Change: row.current - row.prior,
      Confidence: row.confidence,
      Reason: row.reason,
      'Review Required': row.confidence !== null && row.confidence <= reviewThreshold,
      'Review Reason': row.confidence !== null && row.confidence <= reviewThreshold ? row.reason : '',
      'Review Status': review.status,
      'Reviewer Note': review.note,
      'Reviewed At': reviews[row.key]?.updatedAt,
      'Review Revision': reviews[row.key]?.revision,
    }
  }

  function handleExport() {
    const summaryRows = flattenedRows
      .filter((row) => row.kind === 'Total')
      .map(lineToExport)
    const lineRows = flattenedRows.map(lineToExport)
    const isSummary = exportMode === 'summary'
    exportRowsToExcel(
      isSummary ? summaryRows : lineRows,
      isSummary ? 'balance-sheet-summary.xlsx' : 'balance-sheet-by-line.xlsx',
      isSummary ? 'Balance Sheet Summary' : 'Balance Sheet By Line',
    )
  }


  return <>
    <WorkspacePanel id="bs-report" value="transactions" active={active}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Button variant={detail === 'balances' ? 'secondary' : 'outline'} aria-pressed={detail === 'balances'} onClick={() => setDetail('balances')}>Account balances</Button><Button variant={detail === 'movements' ? 'secondary' : 'outline'} aria-pressed={detail === 'movements'} onClick={() => setDetail('movements')}>Source movements</Button></div><ExportControls mode={exportMode} onModeChange={setExportMode} onExport={handleExport} disabled={!reviewReady || saving} /></div>
      <div hidden={detail !== 'balances'} className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Balance Sheet Detail</h2><p className="mt-2 text-xs leading-5 text-slate-500">Current and comparison balances retain the existing report basis. Exports include every filtered balance, subtotal and total, not just this page. Review decisions are audit-only and do not change ledger amounts.</p>
        <ReportPagination {...balancesPage} label="Account balances" />
        <div className="max-h-[60vh] overflow-auto"><table className="w-full min-w-[750px] text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="p-3">Account / section</th><th>Type</th><th className="text-right">{data.priorPeriod}</th><th className="text-right">Change</th><th className="text-right">{data.asAt}</th></tr></thead><tbody>{balancesPage.rows.map(row => <tr key={row.key} className={row.kind === 'Line' ? 'border-b' : 'border-b bg-slate-50 font-semibold'}><td className="p-3">{row.account}<p className="text-xs font-normal text-slate-500">{row.section} · {row.group}</p></td><td>{row.kind}</td><td className="text-right tabular-nums">{money(row.prior)}</td><td className="text-right tabular-nums">{money(row.current - row.prior)}</td><td className="text-right tabular-nums">{money(row.current)}</td></tr>)}</tbody></table></div>
      </div>
      <div hidden={detail !== 'movements'}>{movements}</div>
    </WorkspacePanel>
    <WorkspacePanel id="bs-report" value="review" active={active}>
      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Balance-sheet review</h2><p className="mt-2 max-w-2xl text-sm text-slate-500">Unconfirmed account balances, including low-confidence lines (≤ {reviewThreshold.toFixed(2)}). Save decisions to browser audit history; amounts remain unchanged.</p></div><Button disabled={!reviewReady || saving || !Object.keys(reviewState).length} onClick={() => void saveAllReviews()}>Save reviews ({Object.keys(reviewState).length})</Button></div>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />Show all balances, including approved and calculated totals</label>
        <ReportPagination {...reviewsPage} label="Balance review" />
        <div className="max-h-[60vh] overflow-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="p-3">Account</th><th className="text-right">{data.asAt}</th><th className="p-3">Confidence / evidence</th><th>Decision</th><th>Reviewer note</th></tr></thead><tbody>{reviewsPage.rows.map(row => {
          const draft = reviewFor(row)
          return <tr key={row.key} className="border-b"><td className="p-3">{row.account}<p className="text-xs text-slate-500">{row.section} · {row.kind}</p></td><td className="text-right tabular-nums">{money(row.current)}</td><td className="max-w-72 p-3 text-xs"><p className={row.confidence !== null && row.confidence <= reviewThreshold ? 'font-semibold text-amber-700' : ''}>{row.confidence === null ? 'Calculated total' : row.confidence.toFixed(2)}</p>{row.reason}</td><td className="p-2"><select aria-label={`Decision for ${row.account}`} value={draft.status} onChange={event => updateReview(row, { status: event.target.value as ReviewStatus })} className="min-h-11 rounded-lg border bg-white px-2">{(['Pending', 'Approved', 'Needs changes', 'Rejected'] as const).map(status => <option key={status}>{status}</option>)}</select><p className="mt-1 text-xs text-slate-500">{reviewState[row.key] ? 'Unsaved changes' : reviews[row.key] ? `Saved · revision ${reviews[row.key].revision}` : 'Not reviewed'}</p></td><td><input aria-label={`Review note for ${row.account}`} value={draft.note} onChange={event => updateReview(row, { note: event.target.value })} className="min-h-11 w-64 rounded-lg border px-3" placeholder="Add evidence note…" /></td></tr>
        })}</tbody></table></div>
        {!reviewRows.length && <p className="py-4 text-sm text-slate-500">No unconfirmed balances in this selection. Enable Show all to see saved decisions.</p>}
      </section>
    </WorkspacePanel>
  </>
}
