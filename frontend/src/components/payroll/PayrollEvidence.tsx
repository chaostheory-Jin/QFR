'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { workspaceAction, workspaceLink } from '@/components/WorkspaceTabs'
import { Button } from '@/components/ui/button'
import { ACCOUNTS, bankCandidates, bankOwner, matchedBank, type JournalLine, type Payment, type PayrollAction, type PayrollState } from '@/lib/payroll-ledger'

export const payrollMoney = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((cents || 0) / 100)
export const payrollField = 'rounded-lg border bg-white px-3 py-2 text-sm'
function PayslipLink({ id, children, className }: { id: string; children: ReactNode; className: string }) {
  return <Link href={`/payroll#${id}`} className={className} onClick={event => {
    if (window.location.pathname === '/payroll') {
      event.preventDefault()
      // App Router's same-page pushState does not emit hashchange. Keep the
      // selected payslip and batch-allocation links in sync using native hash navigation.
      if (window.location.hash === `#${id}`) window.dispatchEvent(new HashChangeEvent('hashchange'))
      else window.location.hash = id
    }
  }}>{children}</Link>
}
export function JournalTable({ lines }: { lines: JournalLine[] }) {
  return <div className="max-h-96 overflow-auto rounded-lg border"><table className="w-full min-w-[780px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Date', 'Journal / evidence', 'Account', 'Debit', 'Credit', 'Payslip'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{lines.map(line => <tr className="border-t" key={line.id}><td className="p-3 whitespace-nowrap">{line.date}</td><td className="max-w-72 break-words p-3"><p>{line.description}</p><p className="mt-1 text-slate-500">{line.journalId}</p></td><td className="p-3">{ACCOUNTS[line.account]}</td><td className="p-3 tabular-nums">{payrollMoney(line.debit)}</td><td className="p-3 tabular-nums">{payrollMoney(line.credit)}</td><td className="p-3">{line.lineId ? <PayslipLink id={line.lineId} className={workspaceLink}>View payslip</PayslipLink> : 'Opening funding'}</td></tr>)}</tbody></table>{!lines.length && <p className="p-5 text-sm text-slate-500">No journal movements in this selection.</p>}</div>
}

export function PayrollBankReview({ state, payment, reviewer, busy, act }: {
  state: PayrollState; payment: Payment; reviewer: string; busy: boolean; act: (action: PayrollAction) => Promise<boolean>
}) {
  const candidates = bankCandidates(state, payment), match = matchedBank(state, payment)
  const [selected, setSelected] = useState(match ?? candidates[0]?.bank.id ?? '')
  const [note, setNote] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = scroll.current
    const target = container?.querySelector('[aria-selected="true"]') as HTMLElement | null
    if (container && target) container.scrollTo({ top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 2 + target.clientHeight / 2, behavior: 'smooth' })
  }, [selected])
  const bank = state.banks.find(b => b.id === selected), owner = selected ? bankOwner(state, selected, payment.id) : undefined
  const difference = bank ? bank.amount - payment.amount : null
  return <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/30 p-4" aria-label={`Bank review ${payment.id}`}>
    <div className="flex flex-wrap justify-between gap-2"><h3 className="break-all text-sm font-semibold">{payment.id}</h3><span className="text-sm">{payment.status} · {payrollMoney(payment.amount)} · {match ? 'Bank matched' : 'Needs bank review'}</span></div>
    <p className="text-xs text-slate-600">{payment.date} · {payment.allocations.length > 1 ? 'Batch payment: match the full total, not one employee’s net pay.' : 'Match this payment, which may be one part of a payslip.'} All amounts below are positive cash outflows.</p>
    <div className="flex flex-wrap gap-2">{payment.allocations.map(a => <PayslipLink key={a.lineId} id={a.lineId} className={workspaceLink}>{a.lineId} · {payrollMoney(a.amount)}</PayslipLink>)}</div>
    {payment.status === 'Failed' ? <p className="text-sm text-rose-700">Failed simulation — no cash or liability movement was posted. Review the payslip before retrying.</p> : <>
      <p className="text-xs text-slate-600">Up to 5 candidates from all employee-payment bank lines. Same amount alone never auto-confirms a payment. This mock statement subset does not include tax/super remittance evidence.</p>
      <div className="grid gap-2 md:grid-cols-2">{candidates.map(({ bank, reason, difference }, index) => <button key={bank.id} type="button" aria-label={`Inspect bank candidate ${index + 1} for ${payment.id}`} aria-pressed={selected === bank.id} onClick={() => setSelected(bank.id)} className={`min-h-20 rounded-xl border-2 p-4 text-left text-sm transition hover:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-500 ${selected === bank.id ? 'border-amber-500 bg-amber-100' : 'bg-white'}`}><span className="block font-semibold">#{index + 1} · {bank.date} · {payrollMoney(bank.amount)}</span><span className="mt-1 block break-all">{bank.reference}</span><span className="mt-1 block">{reason} · Difference {payrollMoney(difference)}</span>{bankOwner(state, bank.id, payment.id) && <span className="mt-1 block text-rose-700">Already assigned to another payment</span>}</button>)}</div>
      <label className="block text-xs">Bank statement line (all {state.banks.length} rows)<select aria-label={`Bank line ${payment.id}`} className={`${payrollField} mt-1 w-full`} value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a bank line</option>{state.banks.map(b => <option key={b.id} value={b.id}>{b.date} · {b.reference} · {payrollMoney(b.amount)}</option>)}</select></label>
      <div ref={scroll} className="max-h-56 overflow-auto rounded border bg-white"><table className="w-full min-w-[580px] text-left text-xs"><thead className="sticky top-0 bg-slate-900 text-white"><tr><th className="p-2">Date</th><th className="p-2">Bank reference</th><th className="p-2">Outflow</th></tr></thead><tbody>{state.banks.map(b => <tr key={b.id} aria-selected={selected === b.id} className={`border-t ${selected === b.id ? 'bg-amber-100 ring-2 ring-inset ring-amber-500' : ''}`}><td className="p-2 whitespace-nowrap">{b.date}</td><td className="max-w-80 break-all p-2">{b.reference}</td><td className="p-2 whitespace-nowrap">{payrollMoney(b.amount)}</td></tr>)}</tbody></table></div>
      <p className="text-sm">Payment total {payrollMoney(payment.amount)} · Bank {bank ? payrollMoney(bank.amount) : '—'} · Difference {difference === null ? '—' : payrollMoney(difference)}{owner && <span className="block text-rose-700">Already assigned: {owner}</span>}</p>
      <label className="block text-xs">Evidence checked<textarea aria-label={`Bank review note ${payment.id}`} maxLength={2000} className={`${payrollField} mt-1 w-full`} value={note} onChange={e => setNote(e.target.value)} placeholder="Confirm reference, date, bank evidence and employee/batch allocation" /></label>
      <div className="flex flex-wrap gap-2"><Button className={workspaceAction} disabled={busy || !reviewer.trim() || !note.trim() || difference !== 0 || !!owner} onClick={() => void act({ type: 'bank', paymentId: payment.id, bankId: selected, decision: 'confirm', note, reviewer })}>Confirm bank match</Button><Button className={workspaceAction} variant="outline" disabled={busy || !reviewer.trim() || !note.trim()} onClick={() => void act({ type: 'bank', paymentId: payment.id, bankId: selected || null, decision: 'reject', note, reviewer })}>Keep unmatched / reject</Button></div>
      {state.bankReviews[payment.id] && <p className="text-xs text-slate-600">Saved: {state.bankReviews[payment.id].action} · {state.bankReviews[payment.id].reviewer} · {state.bankReviews[payment.id].note}</p>}
      <p className="text-xs text-slate-500">Selecting a candidate does not approve it. Bank review never changes the payslip, payment amount or ledger.</p>
    </>}
  </section>
}
