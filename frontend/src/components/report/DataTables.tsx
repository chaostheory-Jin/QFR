'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ExportControls, type ExportMode } from '@/components/ExportControls'
import { exportRowsToExcel, type ExportRow } from '@/lib/excel-export'
import type { RawRow } from '@/lib/report-data'
import { WorkspacePanel } from '@/components/WorkspaceTabs'
import { ReportPagination, useReportPagination, type ReportTab } from './ReportWorkspace'
import type { ReactNode } from 'react'
import { requiresReview } from '@/lib/report-utils'
import type { ReviewDraft, ReviewMap, ReviewStatus } from '@/lib/mapping-reviews'

function fmt(v: number) {
  return v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Props = {
  active: ReportTab
  resetKey: string
  reviewSummary?: ReactNode
  currency?: string
  rows: RawRow[]
  reviewThreshold: number
  categories: string[]
  reviews: ReviewMap
  onSaveReview: (lineId: string, review: ReviewDraft) => Promise<void>
  reviewReady: boolean
  saving: boolean
}

export function DataTables({ rows, reviewThreshold, categories, reviews, onSaveReview, reviewReady, saving, active, resetKey, reviewSummary, currency = 'AUD' }: Props) {
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  const [showAll, setShowAll] = useState(false)
  const [exportMode, setExportMode] = useState<ExportMode>('summary')
  const rowsWithKeys = useMemo(() => rows.map(row => ({ row, key: row.LineID! })), [rows])
  const reviewRows = rowsWithKeys
    .filter(({ row, key }) => showAll || requiresReview(row, reviewThreshold) || Boolean(reviews[key]))
    .sort((a, b) => a.row.Confidence - b.row.Confidence)

  const transactionsPage = useReportPagination(rows, resetKey)
  const reviewPage = useReportPagination(reviewRows, resetKey + showAll)

  function reviewFor(key: string): ReviewDraft {
    const row = rowsWithKeys.find(item => item.key === key)?.row
    return drafts[key] ?? reviews[key] ?? { status: 'Pending', category: row?.ProposedCategory ?? row?.MappedCategory ?? 'Unmapped', note: '' }
  }

  function updateReview(key: string, patch: Partial<ReviewDraft>) {
    const base = reviewFor(key)
    setDrafts((current) => ({
      ...current,
      [key]: { ...base, ...patch },
    }))
  }

  async function saveReview(key: string) {
    try {
      await onSaveReview(key, reviewFor(key))
      setDrafts(current => {
        const next = { ...current }
        delete next[key]
        return next
      })
    } catch { /* The page displays the server error; keep the unsaved draft. */ }
  }

  function buildSummaryExport(): ExportRow[] {
    const grouped = new Map<string, {
      category: string
      lines: number
      amount: number
      budget: number
      confidenceTotal: number
      lowConfidence: number
      approved: number
      needsChanges: number
      rejected: number
    }>()

    rowsWithKeys.forEach(({ row, key }) => {
      const category = row.MappedCategory || 'Unmapped'
      const item = grouped.get(category) ?? {
        category,
        lines: 0,
        amount: 0,
        budget: 0,
        confidenceTotal: 0,
        lowConfidence: 0,
        approved: 0,
        needsChanges: 0,
        rejected: 0,
      }
      const review = reviews[key] ?? { status: 'Pending' }
      item.lines += 1
      item.amount += row.Amount
      item.budget += row.Budget ?? 0
      item.confidenceTotal += row.Confidence
      if (requiresReview(row, reviewThreshold) && review.status !== 'Approved') item.lowConfidence += 1
      if (review.status === 'Approved') item.approved += 1
      if (review.status === 'Needs changes') item.needsChanges += 1
      if (review.status === 'Rejected') item.rejected += 1
      grouped.set(category, item)
    })

    return Array.from(grouped.values())
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .map((item) => ({
        Category: item.category,
        Lines: item.lines,
        Amount: item.amount,
        Budget: item.budget || null,
        'Average Confidence': item.lines ? item.confidenceTotal / item.lines : 0,
        'Review Required Lines': item.lowConfidence,
        Approved: item.approved,
        'Needs Changes': item.needsChanges,
        Rejected: item.rejected,
      }))
  }

  function buildLineExport(): ExportRow[] {
    return rowsWithKeys.map(({ row, key }) => {
      const review = reviews[key]
      return {
        'Line ID': key,
        Type: row.Type,
        Invoice: String(row.InvoiceNumber),
        Date: row.Date,
        Contact: row.Contact,
        'Account Code': row.AccountCode,
        Account: row.AccountName,
        Description: row.Description,
        Category: row.MappedCategory,
        'Original AI Category': row.ProposedCategory,
        'Review Required': row.ReviewRequired,
        'Review Reason': row.ReviewReason,
        'Accepted Category': row.AutoAcceptedCategory,
        Amount: row.Amount,
        Budget: row.Budget,
        Confidence: row.Confidence,
        Reason: row.Reason,
        'Review Status': review?.status ?? 'Pending',
        'Reviewer Note': review?.note ?? '',
        'Reviewed At': review?.updatedAt,
        'Review Revision': review?.revision,
      }
    })
  }

  function handleExport() {
    const isSummary = exportMode === 'summary'
    exportRowsToExcel(
      isSummary ? buildSummaryExport() : buildLineExport(),
      isSummary ? 'profit-loss-summary.xlsx' : 'profit-loss-by-line.xlsx',
      isSummary ? 'P&L Summary' : 'P&L By Line',
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <WorkspacePanel id="pl-report" value="transactions" active={active}><Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Profit &amp; Loss Detail</CardTitle>
            <CardDescription>Saved review categories drive this report. Unsaved drafts do not affect totals. Exports include all filtered rows, not just this page.</CardDescription>
          </div>
          <ExportControls mode={exportMode} onModeChange={setExportMode} onExport={handleExport} disabled={!reviewReady || saving} />
        </CardHeader>
        <CardContent>
          <ReportPagination {...transactionsPage} label="Transactions" />
          {!rows.length && <p className="py-4 text-sm text-slate-500">No transactions match these filters.</p>}
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead><TableHead>Invoice</TableHead><TableHead>Date</TableHead>
                  <TableHead>Contact</TableHead><TableHead>Account</TableHead><TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Budget</TableHead><TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactionsPage.rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.Type}</TableCell>
                    <TableCell className="max-w-[100px] truncate">{String(r.InvoiceNumber)}</TableCell>
                    <TableCell>{r.Date}</TableCell>
                    <TableCell>{r.Contact}</TableCell>
                    <TableCell>{r.AccountName}</TableCell>
                    <TableCell>{r.MappedCategory}</TableCell>
                    <TableCell className="text-right">{currency} {fmt(r.Amount)}</TableCell>
                    <TableCell className="text-right">{r.Budget !== undefined ? `${currency} ${fmt(r.Budget)}` : '—'}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{r.Reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card></WorkspacePanel>

      <WorkspacePanel id="pl-report" value="review" active={active}>{reviewSummary}<Card>
        <CardHeader>
          <CardTitle>Human-in-the-loop Review</CardTitle>
          <CardDescription>
            Source-flagged, unmapped or confidence ≤ {reviewThreshold.toFixed(2)} lines. Save a decision to update the report and its browser-stored audit history.
          </CardDescription>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />Review all lines</label>
        </CardHeader>
        <CardContent>
          <ReportPagination {...reviewPage} label="Review" />
          <div className="max-h-[60vh] overflow-auto">
            {reviewRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items below threshold.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Contact</TableHead>
                    <TableHead>Account</TableHead><TableHead>AI proposal / Review reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Reviewer Note</TableHead>
                    <TableHead>Reviewed Category</TableHead>
                    <TableHead>Save</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewPage.rows.map(({ row: r, key }) => {
                    const review = reviewFor(key)
                    return (
                    <TableRow key={key}>
                      <TableCell>{r.Type}</TableCell>
                      <TableCell>{r.Date}</TableCell>
                      <TableCell>{r.Contact}</TableCell>
                      <TableCell>{r.AccountName}</TableCell>
                      <TableCell>{r.ProposedCategory ?? r.MappedCategory}<p className="mt-1 max-w-64 text-xs text-muted-foreground">{r.ReviewReason}</p></TableCell>
                      <TableCell className="text-right">{currency} {fmt(r.Amount)}</TableCell>
                      <TableCell className="text-right">{r.Confidence.toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex min-w-40 flex-wrap gap-1">
                          {(['Pending', 'Approved', 'Needs changes', 'Rejected'] as ReviewStatus[]).map((status) => (
                            <Button
                              key={status}
                              type="button"
                              size="xs"
                              variant={review.status === status ? 'default' : 'outline'}
                              onClick={() => updateReview(key, { status })}
                              className={review.status === status ? 'bg-blue-700 text-white hover:bg-blue-600' : undefined}
                            >
                              {status}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <input
                          aria-label={`Review note for ${key}`}
                          value={review.note}
                          onChange={(event) => updateReview(key, { note: event.target.value })}
                          placeholder="Add note..."
                          className="h-8 min-w-48 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        />
                      </TableCell>
                      <TableCell>
                        <select aria-label={`Reviewed category for ${r.InvoiceNumber}`} value={review.category} onChange={event => updateReview(key, { category: event.target.value })} className="max-w-72 rounded border p-2 text-sm">
                          {categories.map(category => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </TableCell>
                      <TableCell>
                        <Button type="button" size="xs" disabled={!reviewReady || saving} onClick={() => void saveReview(key)}>Save review</Button>
                        <p className="mt-1 text-xs text-muted-foreground">{drafts[key] ? 'Unsaved changes' : reviews[key] ? `Saved · revision ${reviews[key].revision}` : 'Not reviewed'}</p>
                      </TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card></WorkspacePanel>
    </div>
  )
}
