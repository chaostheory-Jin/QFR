'use client'

import { Button } from '@/components/ui/button'
import { EXCEPTION_TYPES, type ExceptionEntry, type ExceptionFilter } from '@/lib/reconciliation-exceptions'

export function ReconciliationExceptionFilters({ entries, value, onChange }: { entries: ExceptionEntry[]; value: ExceptionFilter; onChange: (filter: ExceptionFilter) => void }) {
  const pending = entries.filter(entry => entry.pending).length
  const other = entries.filter(entry => entry.kinds.includes('other')).length
  return <section aria-label="Reconciliation exception queues" className="mb-4 space-y-3 rounded-xl border bg-white p-4">
    <div><h2 className="font-semibold">Review queues</h2><p className="mt-1 text-xs text-slate-600">Counts are pending invoices, not statement lines. Categories may overlap. Suggestions are not confirmed matches; saved approvals and rejections leave these queues.</p></div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{EXCEPTION_TYPES.map(type => {
      const count = entries.filter(entry => entry.kinds.includes(type.id)).length
      return <Button key={type.id} variant={value === type.id ? 'secondary' : 'outline'} aria-pressed={value === type.id} aria-controls="reconciliation-result-list" className="h-auto min-h-28 items-start justify-start p-3 text-left whitespace-normal" onClick={() => onChange(type.id)}>
        <span className="block w-full"><span className="flex items-center justify-between gap-2"><span>{type.label}</span><span className="text-xl font-bold tabular-nums">{count}</span></span><span className="mt-2 block text-xs font-normal leading-5 text-slate-600">{type.description}</span></span>
      </Button>
    })}</div>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={value === 'pending' ? 'secondary' : 'outline'} aria-pressed={value === 'pending'} aria-controls="reconciliation-result-list" onClick={() => onChange('pending')}>All pending · {pending}</Button><Button size="sm" variant={value === 'all' ? 'secondary' : 'outline'} aria-pressed={value === 'all'} aria-controls="reconciliation-result-list" onClick={() => onChange('all')}>All results · {entries.length}</Button>{(other > 0 || value === 'other') && <Button size="sm" variant={value === 'other' ? 'secondary' : 'outline'} aria-pressed={value === 'other'} aria-controls="reconciliation-result-list" onClick={() => onChange('other')}>Other review · {other}</Button>}</div>
  </section>
}
