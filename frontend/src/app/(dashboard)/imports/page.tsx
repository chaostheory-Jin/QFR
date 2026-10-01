'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IMPORT_FIELDS, suggestColumns, type ColumnMap, type ImportMetadata } from '@/lib/data-intake'
import type { ImportBatch } from '@/lib/import-store'

const inputClass = 'rounded border bg-white px-3 py-2 text-sm'
async function payload(response: Response) {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed.')
  return data
}
export default function ImportsPage() {
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [batches, setBatches] = useState<Array<{ id: string; fileName: string; status: string; metadata: ImportMetadata }>>([])
  const [metadata, setMetadata] = useState<ImportMetadata>({ source: 'File upload', company: '', currency: 'AUD', kind: 'ledger', sample: false })
  const [file, setFile] = useState<File | null>(null)
  const [mapping, setMapping] = useState<ColumnMap>({})
  const [sheet, setSheet] = useState('')
  const [options, setOptions] = useState<ImportBatch['options']>({ dateFormat: 'ISO', duplicates: 'block' })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dirty, setDirty] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  function apply(next: ImportBatch) {
    setBatch(next); setMapping(next.mapping); setSheet(next.sheet); setOptions(next.options); setDirty(false)
    window.history.replaceState(null, '', `/imports#${next.id}`)
  }
  async function refreshList() { setBatches((await payload(await fetch('/api/imports'))).batches) }
  async function load(id: string) {
    setBusy(true); setError('')
    try { apply(await payload(await fetch(`/api/imports?id=${id}`))) } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/imports', { signal: controller.signal }).then(payload).then(data => setBatches(data.batches)).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    const id = window.location.hash.slice(1)
    if (id) void fetch(`/api/imports?id=${id}`, { signal: controller.signal }).then(payload).then(apply).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [])
  async function upload(sample = false, invalid = false) {
    setBusy(true); setError('')
    try {
      const source = sample ? new File([`Date,Amount,Currency,Account,Description,LineID,Category,Role\n2026-01-01,1000,AUD,Sales,Mock service sale,mock-1,Sales,income\n2026-01-02,120,AUD,Rent,Mock rent expense,mock-2,Rent,expense\n${invalid ? '2026-01-02,120,AUD,Rent,Mock rent expense,mock-2,Rent,expense\n2026-02-30,invalid,AUD,Office,Mock invalid row,mock-3,Unmapped,expense\n' : ''}`], invalid ? 'mock-invalid.csv' : 'mock-valid.csv', { type: 'text/csv' }) : file
      if (!source) throw new Error('Choose a file first.')
      const form = new FormData(); form.append('file', source)
      form.append('metadata', JSON.stringify(sample ? { source: 'Mock fixture', company: 'Mock Company — not customer data', currency: 'AUD', kind: 'ledger', sample: true } : metadata))
      apply(await payload(await fetch('/api/imports', { method: 'POST', body: form }))); await refreshList()
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  async function validate(commit: boolean) {
    if (!batch) return
    setBusy(true); setError('')
    try {
      apply(await payload(await fetch('/api/imports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: batch.id, revision: batch.revision, sheet, mapping, options, commit }) })))
      await refreshList()
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  const table = batch?.tables.find(table => table.sheet === sheet)
  const records = batch?.validation?.records ?? []
  const totals = new Map<string, number>()
  records.forEach(record => totals.set(record.category, (totals.get(record.category) ?? 0) + record.amount))
  const inspected = selectedCategory === null ? records : records.filter(record => record.category === selectedCategory)
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
    <div><h1 className="text-2xl font-bold">File import and data checks</h1><p className="mt-1 text-sm text-muted-foreground">Original files are preserved. Each batch is isolated from Xero, QuickBooks and other document kinds; no automatic merging or double counting.</p></div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <Card><CardHeader><CardTitle>Upload CSV or Excel</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">Company / entity<input aria-label="Import company" className={`${inputClass} mt-1 w-full`} value={metadata.company} onChange={event => setMetadata({ ...metadata, company: event.target.value })} /></label>
        <label className="text-sm">Source system<input aria-label="Import source" className={`${inputClass} mt-1 w-full`} value={metadata.source} onChange={event => setMetadata({ ...metadata, source: event.target.value })} /></label>
        <label className="text-sm">Currency<input aria-label="Import currency" className={`${inputClass} mt-1 w-full`} maxLength={3} value={metadata.currency} onChange={event => setMetadata({ ...metadata, currency: event.target.value.toUpperCase() })} /></label>
        <label className="text-sm">Document kind<select aria-label="Document kind" className={`${inputClass} mt-1 w-full`} value={metadata.kind} onChange={event => setMetadata({ ...metadata, kind: event.target.value as ImportMetadata['kind'] })}><option value="ledger">Ledger</option><option value="invoice">Invoice detail</option><option value="bank">Bank transactions</option></select></label>
      </div>
      <div className="flex flex-wrap items-center gap-3"><input aria-label="Source spreadsheet" type="file" accept=".csv,.xlsx,.xls" onChange={event => setFile(event.target.files?.[0] ?? null)} /><Button disabled={busy || !file} onClick={() => void upload()}>Upload and preview</Button><Button variant="outline" disabled={busy} onClick={() => void upload(true)}>Load valid mock sample</Button><Button variant="outline" disabled={busy} onClick={() => void upload(true, true)}>Load mock error sample</Button></div>
      <p className="text-xs text-muted-foreground">Maximum 3 MB. First row must contain unique headers. No AI API is called during import.</p>
      <label className="block text-sm">Saved batches <select aria-label="Saved import batches" className={`${inputClass} ml-2 max-w-full`} value={batch?.id ?? ''} disabled={busy} onChange={event => void load(event.target.value)}><option value="">Choose a batch</option>{batches.map(item => <option key={item.id} value={item.id}>{item.metadata.sample ? '[MOCK] ' : ''}{item.metadata.company} — {item.fileName} — {item.status}</option>)}</select></label>
    </CardContent></Card>
    {batch && <>
      <Card><CardHeader><CardTitle>{batch.metadata.sample ? 'MOCK · ' : ''}{batch.fileName} — {batch.status}</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="break-all text-xs text-muted-foreground">Batch {batch.id} · Original SHA-256 {batch.sha256} · {batch.metadata.company} · {batch.metadata.source} · {batch.metadata.currency} · {batch.metadata.kind}</p>
        <a className="text-sm text-blue-700 underline" href={`/api/imports?id=${batch.id}&original=1`}>Download unchanged original</a>
        {batch.status === 'draft' && <>
          <div className="flex flex-wrap gap-4">
            <label className="text-sm">Worksheet <select aria-label="Worksheet" className={inputClass} value={sheet} onChange={event => { setSheet(event.target.value); setMapping(suggestColumns(batch.tables.find(table => table.sheet === event.target.value)!.headers)); setDirty(true) }} disabled={busy}>{batch.tables.map(table => <option key={table.sheet}>{table.sheet}</option>)}</select></label>
            <label className="text-sm">Date convention <select aria-label="Date convention" className={inputClass} value={options.dateFormat} onChange={event => { setOptions({ ...options, dateFormat: event.target.value as ImportBatch['options']['dateFormat'] }); setDirty(true) }}><option>ISO</option><option>DMY</option><option>MDY</option></select></label>
            <label className="text-sm">Duplicate rows <select aria-label="Duplicate policy" className={inputClass} value={options.duplicates} onChange={event => { setOptions({ ...options, duplicates: event.target.value as ImportBatch['options']['duplicates'] }); setDirty(true) }}><option value="block">Block for review</option><option value="exclude">Exclude identical repeats; retain source</option><option value="keep">Keep suspected repeats without source IDs</option></select></label>
          </div>
          <div className="grid gap-3 md:grid-cols-4">{IMPORT_FIELDS.map(field => <label key={field} className="text-sm">{field}{['date', 'amount', 'account', 'description'].includes(field) ? ' *' : ''}<select aria-label={`Map ${field}`} value={mapping[field] ?? ''} className={`${inputClass} mt-1 w-full`} onChange={event => { setMapping({ ...mapping, [field]: event.target.value }); setDirty(true) }}><option value="">{field === 'currency' ? `Use batch ${batch.metadata.currency}` : 'Not mapped'}</option>{table?.headers.map(header => <option key={header}>{header}</option>)}</select></label>)}</div>
          <div className="flex gap-3"><Button variant="outline" disabled={busy} onClick={() => void validate(false)}>Validate mapping</Button><Button disabled={busy || dirty || !batch.validation || batch.validation.issues.some(issue => issue.severity === 'error')} onClick={() => void validate(true)}>Commit validated batch</Button></div>
          {dirty && <p className="text-sm text-amber-800">Mapping changed. Validate again before committing.</p>}
        </>}
        {batch.validation && <div><p className="text-sm">{records.length} prepared records; {batch.validation.issues.filter(issue => issue.severity === 'error').length} errors; {batch.validation.issues.filter(issue => issue.severity === 'warning').length} warnings; {batch.validation.excludedRows.length} explicitly excluded duplicate rows.</p><div className="mt-2 max-h-64 overflow-auto">{batch.validation.issues.map((issue, index) => <p className={`py-1 text-sm ${issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'}`} key={index}>Row {issue.row} · {issue.field} · {issue.message}</p>)}</div></div>}
        <div className="max-h-72 overflow-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr><th>Source row</th>{table?.headers.map(header => <th className="px-3 py-2" key={header}>{header}</th>)}</tr></thead><tbody>{table?.rows.slice(0, 100).map(row => <tr key={row.rowNumber} className="border-t"><td>{row.rowNumber}</td>{table.headers.map(header => <td className="max-w-64 truncate px-3 py-2" key={header}>{String(row.cells[header] ?? '')}</td>)}</tr>)}</tbody></table></div>
      </CardContent></Card>
      {batch.status === 'committed' && <Card><CardHeader><CardTitle>Imported batch report</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm">{batch.period?.from} to {batch.period?.to} · {batch.metadata.currency}. Category sums preserve source signs. This is an isolated batch summary, not a consolidated P&amp;L or balance sheet.</p>
        <div className="flex flex-wrap gap-3">{Array.from(totals).map(([category, amount]) => <Button key={category} variant="outline" onClick={() => setSelectedCategory(category)}>{category}: {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {batch.metadata.currency}</Button>)}<Button variant="ghost" onClick={() => setSelectedCategory(null)}>All source lines</Button></div>
        <p className="text-sm font-medium">{selectedCategory ?? 'All lines'}: {inspected.reduce((sum, record) => sum + record.amount, 0).toLocaleString()} {batch.metadata.currency} from {inspected.length} records</p>
        <div className="max-h-96 overflow-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr>{['Date', 'Account', 'Description', 'Amount', 'Source record', 'Original row'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{inspected.map(record => <tr className="border-t" key={record.id}><td className="p-2">{record.date}</td><td className="p-2">{record.account}</td><td className="p-2">{record.description}</td><td className="p-2">{record.amount} {record.currency}</td><td className="p-2">{record.sourceRecordId || record.id}</td><td className="p-2"><details><summary className="cursor-pointer text-blue-700">{record.sourceFile} / {record.sourceSheet} / row {record.sourceRow}</summary><pre className="max-w-md whitespace-pre-wrap">{JSON.stringify(table?.rows.find(row => row.rowNumber === record.sourceRow)?.cells, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
      </CardContent></Card>}
    </>}
    <Link className="text-sm text-blue-700 underline" href="/link-data">Back to data connections</Link>
  </main>
}
