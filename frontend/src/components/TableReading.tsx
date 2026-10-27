'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** One scroll owner: nested shadcn tables must not intercept sticky headers. */
export function TableViewport({ children, resetKey, label }: { children: ReactNode; resetKey: string | number; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0 }, [resetKey])
  return <div ref={ref} role="region" aria-label={label} tabIndex={0} className="reading-table max-h-[60vh] overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-indigo-500">{children}</div>
}

export function ExpandableText({ text }: { text?: string | null }) {
  if (!text) return <>—</>
  if (text.length <= 90) return <span className="block min-w-40 max-w-72 whitespace-normal break-words">{text}</span>
  return <details className="min-w-48 max-w-80 whitespace-normal"><summary className="cursor-pointer py-2 text-indigo-700">{text.slice(0, 75)}… <span className="font-semibold">Read more</span></summary><p className="break-words py-2 leading-6">{text}</p></details>
}

export function CopyReference({ value }: { value: string }) {
  const [feedback, setFeedback] = useState({ value: '', message: '' })
  const result = feedback.value === value ? feedback.message : ''
  return <div className="flex min-w-36 max-w-72 items-start gap-2"><span className="min-w-0 flex-1 whitespace-normal break-all font-mono">{value || '—'}</span>
    {value && <div><Button size="icon-xs" variant="ghost" aria-label={`Copy reference ${value}`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setFeedback({ value, message: 'Copied' }) } catch { setFeedback({ value, message: 'Copy unavailable. Select the text to copy.' }) }
    }}>{result === 'Copied' ? <Check className="size-4" /> : <Copy className="size-4" />}</Button><span role="status" className={result === 'Copied' ? 'text-xs text-emerald-700' : 'block max-w-32 text-xs text-slate-600'}>{result}</span></div>}
  </div>
}
