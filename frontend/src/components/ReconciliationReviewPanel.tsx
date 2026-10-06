'use client'

import { browserDataRequest } from '@/lib/browser-data'
import { BrowserFileLink } from '@/components/BrowserFileLink'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { reviewedResults, type ReconciliationRun, type ReviewDecision } from '@/lib/reconciliation-review'
const field = 'rounded border bg-white px-2 py-1 text-sm'
export function ReconciliationReviewPanel({ run, onRun, onRestore }: { run: ReconciliationRun | null; onRun: (run: ReconciliationRun) => void; onRestore: (run: ReconciliationRun) => void }) {
  const [runs, setRuns] = useState<Array<{ id: string; createdAt: string; sample: boolean; count: number; currency: string }>>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, ReviewDecision>>({})
  const [reviewer, setReviewer] = useState(''), [role, setRole] = useState<'finance' | 'manager'>('finance')
  async function request(url: string, init?: RequestInit) {
    const response = await browserDataRequest(url, init), data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Review request failed.')
    return data
  }
  useEffect(() => { void request('/api/reconciliation-reviews').then(data => setRuns(data.runs)).catch(error => setError(error.message)) }, [run?.id])
  async function restore(id: string) {
    setBusy(true); setError('')
    try { onRestore(await request(`/api/reconciliation-reviews?id=${id}`)); setDrafts({}) } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  function draftFor(index: number): ReviewDecision {
    const invoice = run!.invoices.find(invoice => invoice.documentIndex === index)!, saved = run!.reviews[String(index)]
    const result = reviewedResults(run!).find(result => result.original.documentIndex === index)!
    return drafts[String(index)] ?? { invoiceIndex: index, invoiceNumber: saved?.invoiceNumber ?? invoice.invoiceNumber, amount: saved?.amount ?? invoice.totalAmount,
      currency: run!.currency, documentType: saved?.documentType ?? (invoice.documentType === 'credit_note' ? 'credit_note' : 'invoice'),
      statementIndex: saved?.statementIndex ?? (result.statementRecord ? run!.statements.indexOf(result.statementRecord) : null), action: saved?.action ?? 'approve',
      reason: '', reviewer, role }
  }
  function update(index: number, patch: Partial<ReviewDecision>) { setDrafts(current => ({ ...current, [index]: { ...draftFor(index), ...patch } })) }
  async function save(index: number) {
    setBusy(true); setError('')
    try {
      onRun(await request('/api/reconciliation-reviews', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: run!.id, revision: run!.revision, decision: { ...draftFor(index), reviewer, role } }) }))
      setDrafts(current => { const next = { ...current }; delete next[index]; return next })
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <Card className="my-5"><CardHeader><CardTitle>Saved reconciliation and human review</CardTitle></CardHeader><CardContent className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><select aria-label="Saved reconciliation runs" className={`${field} max-w-full`} value={run?.id ?? ''} disabled={busy} onChange={event => void restore(event.target.value)}><option value="">Restore a saved run</option>{runs.map(item => <option key={item.id} value={item.id}>{item.sample ? '[MOCK] ' : ''}{item.createdAt} — {item.count} invoices ({item.currency})</option>)}</select>{run && <Button size="sm" variant="outline" disabled={busy} onClick={() => void restore(run.id)}>Reload saved decisions</Button>}</div>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {run && <>
      <p className="break-all text-xs text-muted-foreground">{run.sample ? 'MOCK fixture — not live customer data' : 'Archived extraction'} · Batch {run.id} · {run.createdAt} · Materiality threshold {run.materiality} {run.currency}. Amounts at or above this threshold require manager approval regardless of AI confidence.</p>
      <p className="rounded bg-amber-50 p-3 text-xs text-amber-900">This project currently uses demo authentication. Reviewer name and role below are self-declared audit fields, not verified identity or secure production role authorization.</p>
      {!run.sample && <div className="space-y-1">{run.files.map(file => <p className="break-all text-xs" key={file.index}>{file.name} · SHA-256 {file.sha256} · {file.archived ? <BrowserFileLink className="text-blue-700 underline" href={`/api/reconciliation-reviews?id=${run.id}&original=${file.index}`}>Download original</BrowserFileLink> : 'Original not archived — review blocked'}</p>)}</div>}
      <div className="flex flex-wrap gap-4"><label className="text-sm">Reviewer <input aria-label="Reconciliation reviewer" className={field} value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><label className="text-sm">Declared role <select aria-label="Reconciliation reviewer role" className={field} value={role} onChange={event => setRole(event.target.value as 'finance' | 'manager')}><option value="finance">Finance reviewer</option><option value="manager">Finance manager</option></select></label></div>
      <div className="space-y-3">{reviewedResults(run).map(result => {
        const index = result.original.documentIndex, draft = draftFor(index)
        return <details className="rounded border p-3" key={index}><summary className="cursor-pointer text-sm font-semibold">{result.original.fileName} — {result.status.replace(/_/g, ' ')}{result.difference !== null ? ` · Difference ${result.difference} ${run.currency}` : ''}</summary>
          <div className="mt-3 space-y-3"><p className="text-xs">Original extraction: {result.original.invoiceNumber || 'Missing ID'} · {result.original.totalAmount} {result.original.currency} · {result.original.documentType}. Original values remain unchanged.</p>
            <div className="grid gap-3 md:grid-cols-3"><label className="text-sm">Confirmed invoice number<input aria-label={`Confirmed invoice ${index}`} className={`${field} w-full`} value={draft.invoiceNumber} onChange={event => update(index, { invoiceNumber: event.target.value })} /></label><label className="text-sm">Confirmed face amount ({run.currency})<input aria-label={`Confirmed amount ${index}`} className={`${field} w-full`} type="number" step="any" value={draft.amount} onChange={event => update(index, { amount: Number(event.target.value) })} /></label><label className="text-sm">Document kind<select aria-label={`Confirmed document kind ${index}`} className={`${field} w-full`} value={draft.documentType} onChange={event => update(index, { documentType: event.target.value as ReviewDecision['documentType'] })}><option value="invoice">Invoice</option><option value="credit_note">Credit note</option></select></label></div>
            <label className="block text-sm">Statement candidate<select aria-label={`Statement candidate ${index}`} className={`${field} mt-1 w-full`} value={draft.statementIndex ?? ''} onChange={event => update(index, { statementIndex: event.target.value === '' ? null : Number(event.target.value) })}><option value="">No match / reject assignment</option>{run.statements.map((record, position) => <option key={position} value={position}>Row {record.lineIndex ?? position + 1}: {record.invoiceNumber} — {record.amount} {run.currency} — {record.description ?? ''}</option>)}</select></label>
            <label className="block text-sm">Reason / evidence checked<textarea aria-label={`Review reason ${index}`} className={`${field} mt-1 w-full`} value={draft.reason} onChange={event => update(index, { reason: event.target.value })} /></label>
            <div className="flex flex-wrap items-center gap-3"><select aria-label={`Review action ${index}`} className={field} value={draft.action} onChange={event => update(index, { action: event.target.value as ReviewDecision['action'] })}><option value="approve">Confirm fields and assignment</option><option value="reject">Reject assignment</option></select><Button size="sm" disabled={busy || !reviewer.trim() || !draft.reason.trim() || (!run.sample && run.files.some(file => !file.archived))} onClick={() => void save(index)}>Save review</Button><span className="text-xs">{drafts[String(index)] ? 'Unsaved changes' : result.review ? `Saved revision ${result.review.revision} by ${result.review.reviewer}` : 'No human decision'}</span></div>
            <p className="text-xs text-muted-foreground">A confirmed assignment with a nonzero difference remains an approved variance, not a matched invoice.</p>
            <details><summary className="cursor-pointer text-xs">Immutable extraction and review history</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ original: result.original, history: run.history.filter(item => item.after.invoiceIndex === index) }, null, 2)}</pre></details>
          </div></details>
      })}</div>
    </>}
  </CardContent></Card>
}
