'use client'

import { useEffect, useState } from 'react'
import { FileText, Upload, Download, Paperclip, CalendarDays, Building2, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SupportingDocument, TraceEntry } from '@/lib/trace-data'
import type { TraceReport, TraceSource } from '@/lib/trace-navigation'

export function DocumentPanel({ entry, source, report, currency }: { entry: TraceEntry; source: TraceSource; report: TraceReport; currency: string }) {
  const [documents, setDocuments] = useState<SupportingDocument[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null), [note, setNote] = useState(''), [adding, setAdding] = useState(false)
  const query = new URLSearchParams({ source, report, record: entry.id }).toString()
  const endpoint = `/api/trace-documents?${query}`
  const active = documents.find(document => document.id === activeId) ?? documents[0]
  const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency })
  useEffect(() => {
    const controller = new AbortController()
    fetch(endpoint, { signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load documents.')
      setDocuments(data.documents); setLoading(false)
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false) } })
    return () => controller.abort()
  }, [endpoint])
  async function upload() {
    if (!file) return
    setSaving(true); setError('')
    try {
      const form = new FormData(); form.append('file', file); form.append('note', note)
      const response = await fetch(endpoint, { method: 'POST', body: form }), data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to save document.')
      setDocuments(data.documents); setActiveId(data.documents.at(-1)?.id ?? ''); setAdding(false); setFile(null); setNote('')
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  return <section aria-label="Document details" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><FileText size={18} className="text-indigo-600" /> Document details</h2><span className="text-xs text-slate-500">{documents.length} attached</span></div>
    <div className="space-y-5 p-5">
      <div className="rounded-xl bg-slate-50 p-5">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium uppercase tracking-wider text-slate-500">{entry.type || 'Transaction'}</span><span className="rounded-full bg-white px-2 py-1 text-xs text-slate-500">Accounting record</span></div>
        <h3 className="mt-3 break-words text-xl font-semibold tracking-tight">{entry.reference ? `Reference ${entry.reference}` : 'Account movement'}</h3>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600"><span className="flex items-center gap-1.5"><Building2 size={14} /> {entry.contact || 'Contact not provided'}</span><span className="flex items-center gap-1.5"><CalendarDays size={14} />{entry.date}</span></div>
        <div className="mt-5 border-t border-slate-200 pt-4"><p className="text-xs text-slate-500">This transaction’s contribution · {currency}</p><p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{money.format(entry.amount)}</p></div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{entry.description || 'No description supplied.'}</p>
        <dl className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm"><div><dt className="text-xs text-slate-500">Account</dt><dd className="mt-0.5 break-words">{entry.account}</dd></div><div><dt className="text-xs text-slate-500">Report category</dt><dd className="mt-0.5 break-words">{entry.category}</dd></div></dl>
      </div>
      {loading ? <p className="text-sm text-slate-500" role="status">Loading supporting documents…</p> : active ? <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-500">Supporting document<select aria-label="Supporting document" className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900" value={active.id} onChange={event => setActiveId(event.target.value)}>{documents.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
        <div className="overflow-hidden rounded-xl border bg-slate-50">
          {active.mime === 'application/pdf' ? <iframe title={`Preview of ${active.name}`} src={`${endpoint}&file=${active.id}&preview=1`} className="h-[480px] w-full bg-white" />
            // Native image requests preserve the user's authenticated session.
            // eslint-disable-next-line @next/next/no-img-element
            : <img alt={`Supporting document: ${active.name}`} src={`${endpoint}&file=${active.id}&preview=1`} className="max-h-[560px] w-full object-contain" />}
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-indigo-700"><a className="inline-flex items-center gap-1" target="_blank" rel="noreferrer" href={`${endpoint}&file=${active.id}&preview=1`}>Open full size <ArrowUpRight size={14} /></a><a className="inline-flex items-center gap-1" href={`${endpoint}&file=${active.id}`}><Download size={14} /> Download original</a></div>
        <p className="text-xs text-slate-500">Added manually on {new Date(active.addedAt).toLocaleDateString('en-AU')}. Attachment does not approve the transaction.</p>
        {active.note && <p className="rounded-lg bg-amber-50 p-3 text-sm text-slate-700">{active.note}</p>}
      </div> : <div className="rounded-xl border border-dashed border-slate-300 px-5 py-7 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-500"><Paperclip size={21} /></span>
        <h4 className="mt-3 text-sm font-medium">{entry.reference ? 'Original document not attached' : 'No invoice reference supplied'}</h4>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-500">{entry.reference ? 'The reference above comes from the accounting record. Add the original invoice or receipt to view it here.' : 'This source provides a date and amount only. You can add a supporting document after checking the original record.'}</p>
      </div>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {adding ? <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
        <p className="text-sm font-medium">Add a document to this transaction</p>
        <input aria-label="Attach original document" type="file" accept=".pdf,.png,.jpg,.jpeg" className="w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2" onChange={event => setFile(event.target.files?.[0] ?? null)} />
        <textarea aria-label="Document note" placeholder="Optional note, e.g. supplier invoice for this payment" maxLength={1000} rows={2} className="w-full rounded-lg border bg-white px-3 py-2 text-sm" value={note} onChange={event => setNote(event.target.value)} />
        <p className="text-xs text-slate-500">PDF, PNG or JPEG · up to 3 MB. Saved with this transaction.</p>
        <div className="flex gap-2"><Button disabled={!file || saving} onClick={() => void upload()}>{saving ? 'Saving…' : 'Save document'}</Button><Button variant="ghost" disabled={saving} onClick={() => setAdding(false)}>Cancel</Button></div>
      </div> : <Button variant="outline" className="w-full" onClick={() => setAdding(true)}><Upload size={15} /> Add supporting document</Button>}
      <details className="border-t pt-3 text-xs text-slate-500"><summary className="cursor-pointer">Source information</summary><dl className="mt-3 space-y-2"><div><dt>Source</dt><dd className="text-slate-700">{source === 'quickbooks' ? 'QuickBooks downloaded records' : 'Xero demo records'}</dd></div><div><dt>Record reference</dt><dd className="break-all text-slate-700">{entry.id}</dd></div><div><dt>Amount basis</dt><dd className="text-slate-700">One accounting line. Invoice gross total and tax may differ.</dd></div></dl></details>
    </div>
  </section>
}
