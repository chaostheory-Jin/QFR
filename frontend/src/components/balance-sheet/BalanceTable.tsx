'use client'

import { Fragment, createContext, useContext } from 'react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ExportControls, type ExportMode } from '@/components/ExportControls'
import { exportRowsToExcel, type ExportRow } from '@/lib/excel-export'
import { cn } from '@/lib/utils'
import type { BalanceSheetData, BSLineItem } from '@/lib/balance-sheet-mock'
import { flattenBalanceLines, type BalanceLine } from '@/lib/balance-sheet-review'
import type { ReviewDraft, ReviewMap } from '@/lib/mapping-reviews'

const CurrencyContext = createContext('AUD')

function fmtAUD(value: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

function AmountCell({ value, className }: { value: number; className?: string }) {
  const currency = useContext(CurrencyContext)
  return (
    <td className={cn(
      'px-4 py-2 text-right tabular-nums',
      value < 0 ? 'text-red-600' : value > 0 ? 'text-green-600' : 'text-muted-foreground',
      className,
    )}>
      {fmtAUD(value, currency)}
    </td>
  )
}

function ChangeCell({ current, prior }: { current: number; prior: number }) {
  const currency = useContext(CurrencyContext)
  const change = current - prior
  return (
    <td className={cn(
      'px-4 py-2 text-right tabular-nums',
      change < 0 ? 'text-red-600' : change > 0 ? 'text-green-600' : 'text-muted-foreground',
    )}>
      {fmtAUD(change, currency)}
    </td>
  )
}

type ReviewStatus = 'Pending' | 'Approved' | 'Needs changes' | 'Rejected'
type ReviewState = Record<string, { status: ReviewStatus; note: string }>

function ReviewCell({
  rowId,
  review,
  onUpdate,
}: {
  rowId: string
  review: { status: ReviewStatus; note: string }
  onUpdate: (rowId: string, patch: Partial<{ status: ReviewStatus; note: string }>) => void
}) {
  return (
    <td className="min-w-72 px-4 py-2">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {(['Pending', 'Approved', 'Needs changes', 'Rejected'] as ReviewStatus[]).map((status) => (
            <Button
              key={status}
              type="button"
              size="xs"
              variant={review.status === status ? 'default' : 'outline'}
              onClick={() => onUpdate(rowId, { status })}
              className={review.status === status ? 'bg-blue-700 text-white hover:bg-blue-600' : undefined}
            >
              {status}
            </Button>
          ))}
        </div>
        <input
          value={review.note}
          onChange={(event) => onUpdate(rowId, { note: event.target.value })}
          placeholder="Reviewer note..."
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
    </td>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr className="bg-slate-100">
      <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
        {title}
      </td>
    </tr>
  )
}

function SubsectionHeader({ title }: { title: string }) {
  return (
    <tr>
      <td colSpan={5} className="px-6 py-1.5 text-xs font-medium text-muted-foreground">
        {title}
      </td>
    </tr>
  )
}

function LineItemRow({
  item,
  rowId,
  review,
  onUpdateReview,
}: {
  item: BSLineItem
  rowId: string
  review: { status: ReviewStatus; note: string }
  onUpdateReview: (rowId: string, patch: Partial<{ status: ReviewStatus; note: string }>) => void
}) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2 pl-10 text-sm">{item.name}</td>
      <AmountCell value={item.current} className="text-sm" />
      <AmountCell value={item.prior} className="text-sm" />
      <ChangeCell current={item.current} prior={item.prior} />
      <ReviewCell rowId={rowId} review={review} onUpdate={onUpdateReview} />
    </tr>
  )
}

function SummaryRow({
  item,
  rowId,
  review,
  onUpdateReview,
}: {
  item: BSLineItem
  rowId: string
  review: { status: ReviewStatus; note: string }
  onUpdateReview: (rowId: string, patch: Partial<{ status: ReviewStatus; note: string }>) => void
}) {
  return (
    <tr className="border-t">
      <td className="px-4 py-2 pl-6 text-sm font-medium">{item.name}</td>
      <AmountCell value={item.current} className="text-sm font-medium" />
      <AmountCell value={item.prior} className="text-sm font-medium" />
      <ChangeCell current={item.current} prior={item.prior} />
      <ReviewCell rowId={rowId} review={review} onUpdate={onUpdateReview} />
    </tr>
  )
}

function TotalRow({
  item,
  rowId,
  review,
  onUpdateReview,
  className,
}: {
  item: BSLineItem
  rowId: string
  review: { status: ReviewStatus; note: string }
  onUpdateReview: (rowId: string, patch: Partial<{ status: ReviewStatus; note: string }>) => void
  className?: string
}) {
  return (
    <tr className={cn('border-t-2 border-slate-300', className)}>
      <td className="px-4 py-2.5 text-sm font-bold">{item.name}</td>
      <AmountCell value={item.current} className="text-sm font-bold" />
      <AmountCell value={item.prior} className="text-sm font-bold" />
      <ChangeCell current={item.current} prior={item.prior} />
      <ReviewCell rowId={rowId} review={review} onUpdate={onUpdateReview} />
    </tr>
  )
}

export function BalanceTable({ data, reviewThreshold = 0.7, reviews, onSaveReview, reviewReady, saving }: {
  data: BalanceSheetData; reviewThreshold?: number; reviews: ReviewMap;
  onSaveReview: (lineId: string, draft: ReviewDraft) => Promise<void>; reviewReady: boolean; saving: boolean;
}) {
  const [reviewState, setReviewState] = useState<ReviewState>({})
  const [exportMode, setExportMode] = useState<ExportMode>('summary')
  const flattenedRows = useMemo(() => flattenBalanceLines(data), [data])
  const lowConfidenceRows = flattenedRows
    .filter((row) => row.kind === 'Line' && row.confidence !== null && row.confidence <= reviewThreshold)
    .sort((left, right) => (left.confidence ?? 1) - (right.confidence ?? 1))

  function updateReview(rowId: string, patch: Partial<ReviewState[string]>) {
    const base = reviewFor(rowId)
    setReviewState((current) => ({
      ...current,
      [rowId]: {
        ...base,
        ...patch,
      },
    }))
  }

  function reviewFor(rowId: string): ReviewState[string] {
    return reviewState[rowId] ?? reviews[rowId] ?? { status: 'Pending', note: '' }
  }

  async function saveAllReviews() {
    for (const [lineId, draft] of Object.entries(reviewState)) {
      const row = flattenedRows.find(line => line.key === lineId)
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

  return (
    <CurrencyContext.Provider value={data.currency ?? 'AUD'}>
    <div className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-col gap-2 border-b bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Balance Sheet Detail</h2>
          <p className="text-xs text-muted-foreground">Save decisions before exporting. Balance reviews are audit-only and do not change ledger amounts.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={!reviewReady || saving || !Object.keys(reviewState).length} onClick={() => void saveAllReviews()}>Save reviews ({Object.keys(reviewState).length})</Button>
          <ExportControls mode={exportMode} onModeChange={setExportMode} onExport={handleExport} disabled={!reviewReady || saving} />
        </div>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b bg-slate-50">
            <th className="w-1/2 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Account
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {data.asAt}
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {data.priorPeriod}
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Change
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Human Review
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {/* ASSETS */}
          <SectionHeader title="Assets" />
          {data.assets.subsections.map((sub) => (
            <Fragment key={sub.title}>
              <SubsectionHeader title={sub.title} />
              {sub.items.map((item) => {
                const id = `assets|${sub.title}|line|${item.name}`
                return <LineItemRow key={item.name} item={item} rowId={id} review={reviewFor(id)} onUpdateReview={updateReview} />
              })}
              <SummaryRow item={sub.total} rowId={`assets|${sub.title}|subtotal|${sub.total.name}`} review={reviewFor(`assets|${sub.title}|subtotal|${sub.total.name}`)} onUpdateReview={updateReview} />
            </Fragment>
          ))}
          <TotalRow item={data.assets.total} rowId={`assets|total|${data.assets.total.name}`} review={reviewFor(`assets|total|${data.assets.total.name}`)} onUpdateReview={updateReview} />

          {/* LIABILITIES */}
          <SectionHeader title="Liabilities" />
          {data.liabilities.subsections.map((sub) => (
            <Fragment key={sub.title}>
              <SubsectionHeader title={sub.title} />
              {sub.items.map((item) => {
                const id = `liabilities|${sub.title}|line|${item.name}`
                return <LineItemRow key={item.name} item={item} rowId={id} review={reviewFor(id)} onUpdateReview={updateReview} />
              })}
              <SummaryRow item={sub.total} rowId={`liabilities|${sub.title}|subtotal|${sub.total.name}`} review={reviewFor(`liabilities|${sub.title}|subtotal|${sub.total.name}`)} onUpdateReview={updateReview} />
            </Fragment>
          ))}
          <TotalRow item={data.liabilities.total} rowId={`liabilities|total|${data.liabilities.total.name}`} review={reviewFor(`liabilities|total|${data.liabilities.total.name}`)} onUpdateReview={updateReview} />

          {/* NET ASSETS */}
          <TotalRow item={data.netAssets} rowId={`net-assets|${data.netAssets.name}`} review={reviewFor(`net-assets|${data.netAssets.name}`)} onUpdateReview={updateReview} className="border-t-2 border-slate-400 bg-slate-50" />

          {/* EQUITY */}
          <SectionHeader title="Equity" />
          {data.equity.items.map((item) => {
            const id = `equity|line|${item.name}`
            return <LineItemRow key={item.name} item={item} rowId={id} review={reviewFor(id)} onUpdateReview={updateReview} />
          })}
          <TotalRow item={data.equity.total} rowId={`equity|total|${data.equity.total.name}`} review={reviewFor(`equity|total|${data.equity.total.name}`)} onUpdateReview={updateReview} />
        </tbody>
        </table>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Human-in-the-loop Review (Low Confidence)</CardTitle>
          <CardDescription>
            Balance-sheet lines at or below confidence {reviewThreshold.toFixed(2)}. Save reviews to persist decisions and include them in exports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-auto">
            {lowConfidenceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items below threshold.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Section</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">{data.asAt}</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Reviewer Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowConfidenceRows.map((row) => {
                    const review = reviewFor(row.key)
                    return (
                      <TableRow key={row.key}>
                        <TableCell>{row.section}</TableCell>
                        <TableCell>{row.account}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtAUD(row.current, data.currency)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.confidence?.toFixed(2)}</TableCell>
                        <TableCell className="max-w-64 text-xs text-muted-foreground">{row.reason}</TableCell>
                        <TableCell>
                          <div className="flex min-w-40 flex-wrap gap-1">
                            {(['Approved', 'Needs changes', 'Rejected'] as ReviewStatus[]).map((status) => (
                              <Button
                                key={status}
                                type="button"
                                size="xs"
                                variant={review.status === status ? 'default' : 'outline'}
                                onClick={() => updateReview(row.key, { status })}
                                className={review.status === status ? 'bg-blue-700 text-white hover:bg-blue-600' : undefined}
                              >
                                {status}
                              </Button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <input
                            value={review.note}
                            onChange={(event) => updateReview(row.key, { note: event.target.value })}
                            placeholder="Add note..."
                            className="h-8 min-w-48 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
    </CurrencyContext.Provider>
  )
}
