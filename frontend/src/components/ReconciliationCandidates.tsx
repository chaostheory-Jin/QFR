'use client'

import type { StatementCandidate } from '@/lib/reconciliation-candidates'
import { statementIdentifiers } from '@/lib/reconciliation'

export function ReconciliationCandidates({ candidates, currency, selectedIndex, onSelect, action = 'Inspect', disabled = false }: {
  candidates: StatementCandidate[]; currency: string; selectedIndex: number | null
  onSelect: (statementIndex: number) => void; action?: string; disabled?: boolean
}) {
  const money = (amount: number) => new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount)
  return <div className="space-y-2">
    <p className="text-xs text-amber-900">Up to 5 suggestions from all statement lines. Ranking is not a confidence score or approval.</p>
    {!candidates.length && <p className="text-xs text-slate-500">No sufficiently related candidate. Inspect the original and use the full statement dropdown below; no result has been invented.</p>}
    {candidates.map((candidate, rank) => <button key={candidate.statementIndex} type="button" disabled={disabled}
      aria-label={`${action} candidate ${rank + 1}, statement row ${candidate.statementRecord.lineIndex ?? candidate.statementIndex + 1}`}
      aria-pressed={candidate.statementIndex === selectedIndex} onClick={() => onSelect(candidate.statementIndex)}
      className={`block w-full rounded-lg border p-3 text-left text-xs transition-colors disabled:opacity-50 ${candidate.statementIndex === selectedIndex ? 'border-amber-500 bg-amber-100 ring-1 ring-amber-400' : 'border-amber-200 bg-amber-50/50 hover:bg-amber-100'}`}>
      <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">#{rank + 1} · Row {candidate.statementRecord.lineIndex ?? candidate.statementIndex + 1}{candidate.statementRecord.page ? ` · Page ${candidate.statementRecord.page}` : ''}</span><span className="font-medium">{action} →</span></span>
      <span className="mt-1 block break-words font-mono font-semibold">{statementIdentifiers(candidate.statementRecord).join(' · ') || 'No reference'} · {money(candidate.statementRecord.amount)}</span>
      <span className="mt-1 block text-slate-600">{candidate.reason}</span>
      <span className="mt-1 block text-slate-600">{candidate.statementRecord.date || 'Date unavailable'} · {candidate.statementRecord.description || 'Statement line'} · Δ {candidate.amountDifference === null ? 'not comparable' : money(candidate.amountDifference)} · Review required</span>
    </button>)}
  </div>
}
