'use client'

import { browserDataRequest } from '@/lib/browser-data'
import { BrowserFileLink } from '@/components/BrowserFileLink'

import { useEffect, useRef, useState } from 'react'
import { workspaceAction } from '@/components/WorkspaceTabs'
import { DraftActionBar, SaveButton, useReviewDrafts } from '@/components/ReviewSave'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { reviewedResults, type ReconciliationRun, type ReviewDecision } from '@/lib/reconciliation-review'
import { ReconciliationCandidates } from './ReconciliationCandidates'
import type { StatementCandidate } from '@/lib/reconciliation-candidates'
const field = 'min-h-11 rounded-lg border bg-white px-3 py-2 text-sm'
export function ReconciliationReviewPanel({ run, onRun, onRestore, candidatesByInvoice, onInspectCandidate, focusInvoice, active = true }: {
  focusInvoice?: { documentIndex: number; revision: number } | null; active?: boolean
  run: ReconciliationRun | null; onRun: (run: ReconciliationRun) => void; onRestore: (run: ReconciliationRun) => void
  candidatesByInvoice: Record<number, StatementCandidate[]>; onInspectCandidate: (documentIndex: number, statementIndex: number) => void
}) {
  const reviewList = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active || !focusInvoice) return
    const target = reviewList.current?.querySelector<HTMLDetailsElement>(`[data-review-invoice="${focusInvoice.documentIndex}"]`)
    if (!target) return
    target.open = true
    const frame = requestAnimationFrame(() => {
      target.querySelector('summary')?.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [active, focusInvoice, run?.id])
  const [runs, setRuns] = useState<Array<{ id: string; createdAt: string; sample: boolean; count: number; currency: string }>>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const editor = useReviewDrafts<ReviewDecision>()
  const { drafts } = editor
  const locked = busy || editor.busy
  const [reviewer, setReviewer] = useState(''), [role, setRole] = useState<'finance' | 'manager'>('finance')
  async function request(url: string, init?: RequestInit) {
    const response = await browserDataRequest(url, init), data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Review request failed.')
    return data
  }
  useEffect(() => { void request('/api/reconciliation-reviews').then(data => setRuns(data.runs)).catch(error => setError(error.message)) }, [run?.id])
  async function restore(id: string) {
    if (editor.count || locked) return
    setBusy(true); setError('')
    try { onRestore(await request(`/api/reconciliation-reviews?id=${id}`)) } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  function draftFor(index: number): ReviewDecision {
    const invoice = run!.invoices.find(invoice => invoice.documentIndex === index)!, saved = run!.reviews[String(index)]
    const result = reviewedResults(run!).find(result => result.original.documentIndex === index)!
    return drafts[String(index)] ?? { invoiceIndex: index, invoiceNumber: saved?.invoiceNumber ?? invoice.invoiceNumber, amount: saved?.amount ?? invoice.totalAmount,
      currency: run!.currency, documentType: saved?.documentType ?? (invoice.documentType === 'credit_note' ? 'credit_note' : 'invoice'),
      statementIndex: saved?.statementIndex ?? (result.statementRecord ? run!.statements.indexOf(result.statementRecord) : null), action: saved?.action ?? 'approve',
      reason: '', reviewer, role }
  }
  function update(index: number, patch: Partial<ReviewDecision>) { editor.update(String(index), { ...draftFor(index), ...patch }) }
  function blockedReason(decisions: ReviewDecision[]) {
    if (!run) return 'Load a reconciliation run first.'
    if (!reviewer.trim()) return 'Enter a reviewer name before saving.'
    if (!run.sample && run.files.some(file => !file.archived)) return 'Original files must be archived before review.'
    if (decisions.some(draft => !draft.reason.trim())) return 'Add an evidence reason to every edited review.'
    return undefined
  }
  async function save(entries: [string, ReviewDecision][]) {
    if (locked || blockedReason(entries.map(([, draft]) => draft)) || !run) return
    setError('')
    let currentRun = run
    await editor.save(entries, async (_key, draft) => {
      currentRun = await request('/api/reconciliation-reviews', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentRun.id, revision: currentRun.revision, decision: { ...draft, reviewer, role } }) })
      // Carry the revision forward; never bypass the existing approval validator.
      onRun(currentRun)
    })
  }
  return <Card className="my-5"><CardHeader><CardTitle>Saved reconciliation and human review</CardTitle></CardHeader><CardContent className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><select aria-label="Saved reconciliation runs" className={`${field} max-w-full`} value={run?.id ?? ''} disabled={locked || editor.count > 0} onChange={event => event.target.value && void restore(event.target.value)}><option value="">Restore a saved run</option>{runs.map(item => <option key={item.id} value={item.id}>{item.sample ? '[MOCK] ' : ''}{item.createdAt} — {item.count} invoices ({item.currency})</option>)}</select>{run && <Button className={workspaceAction} variant="outline" disabled={locked || editor.count > 0} onClick={() => void restore(run.id)}>Reload saved decisions</Button>}</div>
    {editor.count > 0 && <p className="text-xs text-amber-800">Save or discard edited reviews before switching or reloading a run. Drafts remain available across workspace tabs.</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {run && <>
      <p className="break-all text-xs text-muted-foreground">{run.sample ? 'MOCK fixture — not live customer data' : 'Archived extraction'} · Batch {run.id} · {run.createdAt} · Materiality threshold {run.materiality} {run.currency}. Amounts at or above this threshold require manager approval regardless of AI confidence.</p>
      <p className="rounded bg-amber-50 p-3 text-xs text-amber-900">This project currently uses demo authentication. Reviewer name and role below are self-declared audit fields, not verified identity or secure production role authorization.</p>
      {!run.sample && <div className="space-y-1">{run.files.map(file => <p className="break-all text-xs" key={file.index}>{file.name} · SHA-256 {file.sha256} · {file.archived ? <BrowserFileLink className="text-blue-700 underline" href={`/api/reconciliation-reviews?id=${run.id}&original=${file.index}`}>Download original</BrowserFileLink> : 'Original not archived — review blocked'}</p>)}</div>}
      <fieldset disabled={locked} className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-4"><label className="text-sm">Reviewer <input aria-label="Reconciliation reviewer" className={field} value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><label className="text-sm">Declared role <select aria-label="Reconciliation reviewer role" className={field} value={role} onChange={event => setRole(event.target.value as 'finance' | 'manager')}><option value="finance">Finance reviewer</option><option value="manager">Finance manager</option></select></label></div>
      <div ref={reviewList} className="space-y-3">{reviewedResults(run).map(result => {
        const index = result.original.documentIndex, draft = draftFor(index)
        return <details data-review-invoice={index} className={`scroll-mt-24 rounded border p-3 ${focusInvoice?.documentIndex === index ? 'border-indigo-400 ring-1 ring-indigo-200' : ''}`} key={index}><summary className="min-h-12 cursor-pointer rounded-lg bg-slate-50 p-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-50">{result.original.fileName} — {result.status.replace(/_/g, ' ')}{result.difference !== null ? ` · Difference ${result.difference} ${run.currency}` : ''}</summary>
          <div className="mt-3 space-y-3"><p className="text-xs">Original extraction: {result.original.invoiceNumber || 'Missing ID'} · {result.original.totalAmount} {result.original.currency} · {result.original.documentType}. Original values remain unchanged.</p>
            <ReconciliationCandidates candidates={candidatesByInvoice[index] ?? []} currency={run.currency} selectedIndex={draft.statementIndex} disabled={locked}
              action="Use for review" onSelect={statementIndex => { update(index, { statementIndex }); onInspectCandidate(index, statementIndex) }} />
            <p className="text-xs text-amber-900">Choosing a candidate only prepares an unsaved assignment. Confirm the invoice fields and add a reason before saving; it never replaces the extracted ID or amount.</p>
            <div className="grid gap-3 md:grid-cols-3"><label className="text-sm">Confirmed invoice number<input aria-label={`Confirmed invoice ${index}`} className={`${field} w-full`} value={draft.invoiceNumber} onChange={event => update(index, { invoiceNumber: event.target.value })} /></label><label className="text-sm">Confirmed face amount ({run.currency})<input aria-label={`Confirmed amount ${index}`} className={`${field} w-full`} type="number" step="any" value={draft.amount} onChange={event => update(index, { amount: Number(event.target.value) })} /></label><label className="text-sm">Document kind<select aria-label={`Confirmed document kind ${index}`} className={`${field} w-full`} value={draft.documentType} onChange={event => update(index, { documentType: event.target.value as ReviewDecision['documentType'] })}><option value="invoice">Invoice</option><option value="credit_note">Credit note</option></select></label></div>
            <label className="block text-sm">Statement candidate (all lines)<select aria-label={`Statement candidate ${index}`} className={`${field} mt-1 w-full`} value={draft.statementIndex ?? ''} onChange={event => {
              const statementIndex = event.target.value === '' ? null : Number(event.target.value)
              update(index, { statementIndex }); if (statementIndex !== null) onInspectCandidate(index, statementIndex)
            }}><option value="">No match / reject assignment</option>{run.statements.map((record, position) => <option key={position} value={position}>Row {record.lineIndex ?? position + 1}: {record.invoiceNumber} — {record.amount} {run.currency} — {record.description ?? ''}</option>)}</select></label>
            <label className="block text-sm">Reason / evidence checked<textarea aria-label={`Review reason ${index}`} className={`${field} mt-1 w-full`} value={draft.reason} onChange={event => update(index, { reason: event.target.value })} /></label>
            <div className="flex flex-wrap items-center gap-3"><select aria-label={`Review action ${index}`} className={field} value={draft.action} onChange={event => update(index, { action: event.target.value as ReviewDecision['action'] })}><option value="approve">Confirm fields and assignment</option><option value="reject">Reject assignment</option></select><SaveButton phase={editor.activeKey === String(index) ? editor.phase : 'idle'} disabled={locked || !!blockedReason([draft])} onClick={() => void save([[String(index), draft]])} /><span className="text-xs">{drafts[String(index)] ? 'Unsaved changes' : result.review ? `Saved revision ${result.review.revision} by ${result.review.reviewer}` : 'No human decision'}</span></div>
            {blockedReason([draft]) && <p className="text-xs text-amber-800">{blockedReason([draft])}</p>}
            <p className="text-xs text-muted-foreground">A confirmed assignment with a nonzero difference remains an approved variance, not a matched invoice.</p>
            <details><summary className="cursor-pointer text-xs">Immutable extraction and review history</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ original: result.original, history: run.history.filter(item => item.after.invoiceIndex === index) }, null, 2)}</pre></details>
          </div></details>
      })}</div>
      </fieldset>
      <DraftActionBar onDiscard={() => editor.discard()} count={editor.count} phase={editor.phase} message={editor.message} disabledReason={blockedReason(Object.values(drafts))} scope="Only edited invoices in this run. Original extractions and approval rules remain unchanged." onSave={() => void save(Object.entries(drafts))} />
    </>}
  </CardContent></Card>
}
