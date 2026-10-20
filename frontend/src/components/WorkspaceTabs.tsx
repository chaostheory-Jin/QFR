'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const workspaceAction = 'min-h-11 h-auto gap-2 rounded-xl px-5 py-3 text-sm font-semibold whitespace-normal shadow-sm'
export const workspaceLink = 'inline-flex min-h-11 max-w-full items-center justify-between gap-3 break-words rounded-xl border border-indigo-200 bg-white px-4 py-3 text-sm font-semibold text-indigo-700 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'

export function WorkspaceTabs<T extends string>({ id, label, value, onChange, items }: {
  id: string; label: string; value: T; onChange: (value: T) => void
  items: ReadonlyArray<{ id: T; label: string; count?: number; disabled?: boolean }>
}) {
  return <div>
    <label className="block rounded-xl border border-indigo-200 bg-indigo-50 p-2 sm:hidden">
      <span className="mb-1 block px-2 text-xs font-semibold text-indigo-700">Switch section</span>
      <select aria-label={`${label} section`} value={value} onChange={event => onChange(event.target.value as T)} className="min-h-12 w-full rounded-lg border border-indigo-200 bg-white px-3 text-sm font-semibold text-indigo-900 focus-visible:ring-2 focus-visible:ring-indigo-500">
        {items.map(item => <option key={item.id} value={item.id} disabled={item.disabled}>{item.label}{item.count !== undefined ? ` (${item.count})` : ''}</option>)}
      </select>
    </label>
    <div role="tablist" aria-label={label} className="hidden gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100 p-2 sm:flex">
    {items.map(item => <button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`}
      aria-selected={value === item.id} aria-controls={`${id}-panel-${item.id}`} tabIndex={value === item.id ? 0 : -1}
      disabled={item.disabled} onClick={() => onChange(item.id)}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const enabled = items.filter(option => !option.disabled)
        const index = enabled.findIndex(option => option.id === item.id)
        const target = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1)! : enabled[(index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
        onChange(target.id)
        document.getElementById(`${id}-tab-${target.id}`)?.focus()
      }}
      className={cn('flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40',
        value === item.id ? 'bg-indigo-700 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-indigo-700')}>
      {item.label}{item.count !== undefined && <span className={cn('rounded-md px-2 py-0.5 text-xs tabular-nums', value === item.id ? 'bg-white/20 text-white' : 'bg-white text-slate-600')}>{item.count}</span>}
    </button>)}
    </div>
  </div>
}

// Keep inactive panels mounted so unsaved review fields survive navigation.
export function WorkspacePanel({ id, value, active, children }: { id: string; value: string; active: string; children: ReactNode }) {
  return <section role="tabpanel" id={`${id}-panel-${value}`} aria-labelledby={`${id}-tab-${value}`}
    hidden={value !== active} tabIndex={0} className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{children}</section>
}
