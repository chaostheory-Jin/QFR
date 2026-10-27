'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, Save, CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { saveDraftBatch } from '@/lib/save-drafts'

export type SavePhase = 'idle' | 'saving' | 'saved' | 'error'

export function useReviewDrafts<T>() {
  const [drafts, setDrafts] = useState<Record<string, T>>({})
  const [phase, setPhase] = useState<SavePhase>('idle')
  const [message, setMessage] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const lock = useRef(false)
  const count = Object.keys(drafts).length
  useEffect(() => {
    if (!count) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [count])
  function update(key: string, value: T) {
    if (lock.current) return
    setDrafts(current => ({ ...current, [key]: value }))
    setPhase('idle'); setMessage(''); setActiveKey(null)
  }
  async function save(entries: [string, T][], persist: (key: string, draft: T) => Promise<void>) {
    if (lock.current || !entries.length) return
    lock.current = true; setPhase('saving'); setMessage('Saving to this browser…')
    try {
      const result = await saveDraftBatch(entries, async (key, draft) => { setActiveKey(key); await persist(key, draft) }, (key, draft) => {
        setDrafts(current => {
          // Never remove a newer edit when an older save completes.
          if (current[key] !== draft) return current
          const next = { ...current }; delete next[key]; return next
        })
      })
      setPhase(result.error ? 'error' : 'saved')
      setMessage(result.error ? `${result.count} saved. ${result.error} Unsaved changes are kept; retry when ready.` : `${result.count} review${result.count === 1 ? '' : 's'} saved in this browser. No cloud backup.`)
    } finally { lock.current = false }
  }
  function discard(key?: string) {
    if (lock.current) return
    setDrafts(current => { if (!key) return {}; const next = { ...current }; delete next[key]; return next })
    setPhase('idle'); setMessage(''); setActiveKey(null)
  }
  return { drafts, update, save, discard, count, phase, message, activeKey, busy: phase === 'saving' }
}

export function SaveButton({ phase = 'idle', disabled, onClick, label = 'Save review' }: { phase?: SavePhase; disabled?: boolean; onClick: () => void; label?: string }) {
  const Icon = phase === 'saving' ? LoaderCircle : phase === 'saved' ? Check : phase === 'error' ? CircleAlert : Save
  return <Button type="button" size="sm" className="min-w-32" disabled={disabled || phase === 'saving'} aria-busy={phase === 'saving'} onClick={onClick}>
    <Icon className={`size-4 ${phase === 'saving' ? 'animate-spin' : ''}`} />{phase === 'saving' ? 'Saving…' : phase === 'saved' ? 'Saved' : phase === 'error' ? 'Retry save' : label}
  </Button>
}

export function DraftActionBar({ count, phase, message, onSave, disabledReason, onDiscard, scope = 'All edited rows, including other pages and hidden filters.' }: {
  count: number; phase: SavePhase; message: string; onSave: () => void; disabledReason?: string; onDiscard?: () => void; scope?: string
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  if (!count && phase === 'idle') return null
  return <section aria-label="Unsaved review actions" className="sticky bottom-0 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-white p-4 shadow-[0_-4px_16px_rgba(15,23,42,0.06)]">
    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{count ? `${count} unsaved review${count === 1 ? '' : 's'}` : phase === 'error' ? 'Save needs attention' : 'Changes saved'}</p>
      {count > 0 && <p className="mt-1 text-xs text-slate-500">{scope} Drafts are not saved until you confirm.</p>}
      <p role={phase === 'error' ? 'alert' : 'status'} className={`mt-1 text-xs ${phase === 'error' ? 'text-red-700' : phase === 'saved' ? 'text-emerald-700' : 'text-slate-600'}`}>{message || disabledReason || 'Review your decisions, then save.'}</p>
      {message && disabledReason && <p className="mt-1 text-xs text-amber-800">{disabledReason}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">{count > 0 && onDiscard && <>{confirmDiscard ? <><span className="text-xs text-amber-800">Discard these unsaved edits?</span><Button size="sm" variant="destructive" disabled={phase === 'saving'} onClick={() => { onDiscard(); setConfirmDiscard(false) }}>Discard edits</Button><Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>Keep editing</Button></> : <Button size="sm" variant="outline" disabled={phase === 'saving'} onClick={() => setConfirmDiscard(true)}>Discard…</Button>}</>}
    <SaveButton phase={phase === 'saved' && count > 0 ? 'idle' : phase} label={`Save ${count} edited review${count === 1 ? '' : 's'}`} disabled={!count || !!disabledReason} onClick={onSave} /></div>
  </section>
}
