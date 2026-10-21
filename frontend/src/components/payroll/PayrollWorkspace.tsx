'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowLeft, Download, SlidersHorizontal, FileText, Landmark } from 'lucide-react'
import { WorkspaceTabs, WorkspacePanel, workspaceAction, workspaceLink } from '@/components/WorkspaceTabs'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ExportControls, type ExportMode } from '@/components/ExportControls'
import { exportRowsToExcel } from '@/lib/excel-export'
import { PAYROLL_LINES, payrollMonthly, payrollTotals } from '@/lib/payroll-mock'
import { PAYROLL_COMPANY, linePayments, paidAmount, paymentStatus, payrollJournal, reconciliationStatus, type PayrollAction } from '@/lib/payroll-ledger'
import { usePayroll } from '@/lib/use-payroll'
import { setStoredDataSource } from '@/lib/report-source'
import { JournalTable, PayrollBankReview, payrollField as field, payrollMoney as money } from './PayrollEvidence'

export function PayrollWorkspace() {
  const { state, busy, error, reload, act } = usePayroll()
  const [from, setFrom] = useState('2026-01-01'), [to, setTo] = useState('2026-09-30')
  const [search, setSearch] = useState(''), [department, setDepartment] = useState(''), [status, setStatus] = useState(''), [lowOnly, setLowOnly] = useState(false)
  const [mode, setMode] = useState<ExportMode>('byLine')
  const [selectedId, setSelectedId] = useState('MOCK-2026-08-EMP-006')
  const [reviewer, setReviewer] = useState(''), [note, setNote] = useState(''), [decision, setDecision] = useState<'Approved' | 'Needs changes'>('Approved')
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<'overview' | 'payslips' | 'review' | 'payments' | 'ledger'>('overview')
  const [showPayslip, setShowPayslip] = useState(false)
  const [payslipSection, setPayslipSection] = useState<'amounts' | 'actions'>('actions')
  const [overview, setOverview] = useState<'chart' | 'runs'>('chart')
  const [pagination, setPagination] = useState({ key: '', page: 0 })
  const detail = useRef<HTMLDivElement>(null)
  const ready = state !== null
  useEffect(() => {
    if (ready && window.location.hash) requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [ready, selectedId])
  useEffect(() => {
    const selectHash = () => {
      const id = window.location.hash.slice(1)
      if (PAYROLL_LINES.some(row => row.id === id)) { setSelectedId(id); setNote(''); setTab('payslips'); setShowPayslip(true); requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
    }
    selectHash(); window.addEventListener('hashchange', selectHash)
    return () => window.removeEventListener('hashchange', selectHash)
  }, [])
  const invalid = !from || !to || from > to
  const rows = useMemo(() => PAYROLL_LINES.filter(row => !invalid && row.date >= from && row.date <= to && (!department || row.department === department)
    && `${row.employee} ${row.employeeId} ${row.run}`.toLowerCase().includes(search.toLowerCase()) && (!lowOnly || row.confidence <= 0.7)
    && (!status || (state && (status === 'Draft' ? !state.posted.includes(row.id) : status === 'Posted' ? state.posted.includes(row.id) : status === 'Needs review' ? row.reason && state.reviews[row.id]?.status !== 'Approved' : status === 'Needs bank review' ? reconciliationStatus(state, row) === status : paymentStatus(state, row) === status)))), [from, to, department, search, lowOnly, status, state, invalid])
  const selected = PAYROLL_LINES.find(row => row.id === selectedId)!
  const totals = payrollTotals(rows), monthly = payrollMonthly(rows)
  const journal = useMemo(() => state ? payrollJournal(state) : [], [state])
  const payments = state ? linePayments(state, selected.id) : []
  const postedRows = rows.filter(row => state?.posted.includes(row.id))
  const exceptions = rows.filter(row => row.reason || state?.reviews[row.id]?.status === 'Needs changes')
  function inspect(id: string) { setTab('payslips'); setShowPayslip(true); setSelectedId(id); setNote(''); setMessage(''); window.history.replaceState(null, '', `/payroll#${id}`); requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
  async function save(action: PayrollAction) { const ok = await act(action); if (ok) setMessage(action.type === 'post' ? 'Posted to the demo ledger. P&L and Balance Sheet now reflect this payslip.' : action.type === 'pay' ? 'Mock settlement and bank evidence created. No real money was transferred.' : 'Review saved in this browser.'); return ok }
  const filterKey = [from, to, search, department, status, lowOnly].join('|')
  const pageCount = Math.max(1, Math.ceil(rows.length / 8))
  const page = pagination.key === filterKey ? Math.min(pagination.page, pageCount - 1) : 0
  const visibleRows = rows.slice(page * 8, page * 8 + 8)
  function navigate(next: typeof tab) { setTab(next); requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
  function exportPayroll() {
    if (!state) return
    const common = { Source: 'Payroll Demo', Company: PAYROLL_COMPANY, Currency: 'AUD', From: from, To: to }
    exportRowsToExcel(mode === 'byLine' ? rows.map(row => ({ ...common, Payslip: row.id, Employee: row.employee, PayRun: row.run, Date: row.date,
      Gross: row.gross / 100, Withholding: row.withholding / 100, Deductions: row.deductions / 100, Net: row.net / 100, Super: row.superannuation / 100,
      EmployerCost: row.employerCost / 100, Review: state.reviews[row.id]?.status ?? 'Pending', Posting: state.posted.includes(row.id) ? 'Posted' : 'Draft',
      Payment: paymentStatus(state, row), Paid: paidAmount(state, row.id) / 100, Outstanding: (row.net - paidAmount(state, row.id)) / 100,
      BankReview: reconciliationStatus(state, row), Confidence: row.confidence, Reason: row.reason,
    })) : monthly.map(month => { const included = postedRows.filter(row => row.date.startsWith(month.month)); return { ...common, Month: month.month, GrossIncludingDraft: month.gross / 100,
      PostedEmployerCost: payrollTotals(included).employerCost / 100, Paid: rows.filter(row => row.date.startsWith(month.month)).reduce((n, row) => n + paidAmount(state, row.id), 0) / 100 } }), `payroll-demo-${from}-${to}-${mode}.xlsx`, 'Payroll Demo')
  }
  function exportAudit() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ source: 'Payroll Demo — fictional', units: 'integer AUD cents', state, journal, payslips: PAYROLL_LINES }, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'payroll-demo-audit.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">People & pay · Finance workspace</p><h1 className="mt-1 text-3xl font-bold">Payroll</h1><p className="mt-1 text-sm text-slate-500">{PAYROLL_COMPANY} · January–September 2026 · AUD</p></div>
      <div className="flex flex-wrap items-center gap-2 [&_button]:min-h-11 [&_button]:px-4 [&_select]:min-h-11"><ExportControls mode={mode} onModeChange={setMode} onExport={exportPayroll} disabled={!state || !rows.length} /><Button className={workspaceAction} variant="outline" disabled={!state} onClick={exportAudit}><Download className="size-4" />Export audit</Button></div>
    </header>
    <details className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm"><summary className="cursor-pointer font-medium text-indigo-900">Demo workspace · 12 employees · 108 payslips · Browser-only storage</summary><p className="mt-2 text-slate-600">Fictional data only. No real payments or employee portal. Withholding and super are illustrative, not statutory calculations. Changes stay in this browser; export important records.</p></details>
    <nav aria-label="Payroll financial reports" className="grid gap-3 sm:grid-cols-3">
      <Link href="/profit-loss" onClick={() => setStoredDataSource('payroll')} className={workspaceLink}><span>Payroll P&L</span><ArrowRight className="size-5 shrink-0" /></Link>
      <Link href="/balance-sheet" onClick={() => setStoredDataSource('payroll')} className={workspaceLink}><span>Balance Sheet</span><ArrowRight className="size-5 shrink-0" /></Link>
      <Link href="/report-trace?source=payroll&report=balance-sheet" className={workspaceLink}><span>Report Explorer</span><ArrowRight className="size-5 shrink-0" /></Link>
    </nav>
    <div ref={detail} className="sticky top-0 z-20 scroll-mt-2 bg-background py-2">
      <WorkspaceTabs id="payroll" label="Payroll workspace" value={tab} onChange={navigate} items={[
        { id: 'overview', label: 'Overview' }, { id: 'payslips', label: 'Payslips', count: rows.length },
        { id: 'review', label: 'Review queue', count: exceptions.length }, { id: 'payments', label: 'Payments & bank' }, { id: 'ledger', label: 'Journals & audit' },
      ]} />
    </div>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error} <Button className={workspaceAction} variant="outline" onClick={() => void reload()}>Reload</Button></p>}
    {message && <p role="status" className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {!state ? <p role="status">Loading browser payroll and previous review decisions…</p> : <>
      {(['overview', 'review'].includes(tab) || (tab === 'payslips' && !showPayslip)) && <details className="rounded-xl border bg-white"><summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold"><span className="flex items-center gap-2"><SlidersHorizontal className="size-4" />Filters · {rows.length} payslips</span><span className="text-xs font-normal text-slate-500">{from} → {to} · Expand / collapse</span></summary>      <Card><CardContent className="space-y-3 pt-5"><div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5"><label className="text-xs">Pay date from<input aria-label="Payroll from" type="date" className={`${field} mt-1 w-full`} value={from} onChange={e => setFrom(e.target.value)} /></label><label className="text-xs">Pay date to<input aria-label="Payroll to" type="date" className={`${field} mt-1 w-full`} value={to} onChange={e => setTo(e.target.value)} /></label><label className="text-xs">Employee / pay run<input aria-label="Search payroll" className={`${field} mt-1 w-full`} value={search} onChange={e => setSearch(e.target.value)} /></label><label className="text-xs">Department<select aria-label="Payroll department" className={`${field} mt-1 w-full`} value={department} onChange={e => setDepartment(e.target.value)}><option value="">All departments</option>{[...new Set(PAYROLL_LINES.map(row => row.department))].map(name => <option key={name}>{name}</option>)}</select></label><label className="text-xs">Workflow filter<select aria-label="Payroll workflow filter" className={`${field} mt-1 w-full`} value={status} onChange={e => setStatus(e.target.value)}><option value="">All states</option>{['Draft', 'Posted', 'Unpaid', 'Part paid', 'Paid', 'Failed', 'Needs review', 'Needs bank review'].map(s => <option key={s}>{s}</option>)}</select></label></div><div className="flex flex-wrap justify-between gap-3"><label className="text-sm"><input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} /> Low confidence only (≤70%)</label><Button variant="ghost" onClick={() => { setFrom('2026-01-01'); setTo('2026-09-30'); setSearch(''); setDepartment(''); setStatus(''); setLowOnly(false) }}>Reset filters</Button></div>{invalid && <p role="alert" className="text-red-700">Choose a valid date range.</p>}</CardContent></Card>
</details>}
      <WorkspacePanel id="payroll" value="overview" active={tab}>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[['Gross incl. drafts', money(totals.gross)], ['Posted employer cost', money(payrollTotals(postedRows).employerCost)], ['Settled employee payments', money(rows.reduce((n, row) => n + paidAmount(state, row.id), 0))], ['Posted net outstanding', money(postedRows.reduce((n, row) => n + row.net - paidAmount(state, row.id), 0))]].map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 break-words text-base font-semibold tracking-tight tabular-nums xl:text-2xl">{value}</p><p className="mt-2 text-xs text-slate-400">Current selection · {rows.length} payslips</p></CardContent></Card>)}</div>

        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><Button className={workspaceAction} variant={overview === 'chart' ? 'secondary' : 'outline'} aria-pressed={overview === 'chart'} onClick={() => setOverview('chart')}>Monthly chart</Button><Button className={workspaceAction} variant={overview === 'runs' ? 'secondary' : 'outline'} aria-pressed={overview === 'runs'} onClick={() => setOverview('runs')}>Pay-run summary</Button></div><Button className={workspaceAction} onClick={() => { setShowPayslip(false); navigate('payslips') }}>Browse payslips<ArrowRight className="size-4" /></Button></div>
        {overview === 'chart' ? <>      {monthly.length > 0 && <Card><CardHeader><CardTitle>Monthly payroll</CardTitle></CardHeader><CardContent><div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthly.map(m => ({ month: m.month, 'Gross incl. drafts': m.gross / 100, 'Posted employer cost': payrollTotals(postedRows.filter(r => r.date.startsWith(m.month))).employerCost / 100 }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={v => `$${Number(v) / 1000}k`} /><Tooltip formatter={v => money(Number(v) * 100)} /><Legend /><Bar dataKey="Gross incl. drafts" fill="#a5b4fc" /><Bar dataKey="Posted employer cost" fill="#4f46e5" /></BarChart></ResponsiveContainer></div></CardContent></Card>}
</> : <>      <Card><CardHeader><CardTitle>Pay-run summary</CardTitle></CardHeader><CardContent><div className="overflow-auto"><table className="w-full min-w-[720px] text-right text-sm"><thead><tr>{['Month', 'Gross incl. drafts', 'Net incl. drafts', 'Employer cost incl. drafts', 'Posted cost'].map(s => <th key={s} className="p-2 font-medium text-slate-500">{s}</th>)}</tr></thead><tbody>{monthly.map(m => <tr key={m.month} className="border-t"><td className="p-2">{m.month}</td>{[m.gross, m.net, m.employerCost, payrollTotals(postedRows.filter(r => r.date.startsWith(m.month))).employerCost].map((n, i) => <td key={i} className="p-2">{money(n)}</td>)}</tr>)}</tbody></table></div></CardContent></Card>
</>}
      </WorkspacePanel>
      <WorkspacePanel id="payroll" value="payslips" active={tab}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{showPayslip ? 'Payslip review' : 'Employee payslips'}</h2><Button className={workspaceAction} variant="outline" onClick={() => { setShowPayslip(!showPayslip); navigate('payslips') }}>{showPayslip ? <><ArrowLeft className="size-4" />Back to register</> : <>Resume selected payslip<ArrowRight className="size-4" /></>}</Button></div>
        <div hidden={showPayslip} className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3"><p className="text-sm text-slate-600" aria-live="polite">{rows.length ? page * 8 + 1 : 0}–{Math.min((page + 1) * 8, rows.length)} of {rows.length} payslips · Page {page + 1} of {pageCount}</p><div className="flex gap-2"><Button className={workspaceAction} variant="outline" disabled={page === 0} onClick={() => setPagination({ key: filterKey, page: page - 1 })}>Previous</Button><Button className={workspaceAction} variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPagination({ key: filterKey, page: page + 1 })}>Next</Button></div></div>      <Card><CardHeader><CardTitle>Payroll by line · {rows.length} payslips</CardTitle></CardHeader><CardContent><p className="mb-3 text-xs text-slate-500">Review, posting, payment and bank reconciliation are independent. Historical Jan–Aug postings are seeded fixtures; September starts unposted.</p><div className="max-h-96 overflow-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Date / employee', 'Gross / net', 'Review', 'Posting', 'Payment', 'Bank reconciliation', 'Payslip'].map(s => <th key={s} className="p-3">{s}</th>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={row.id} className={`border-t ${row.id === selectedId ? 'bg-indigo-50' : ''}`}><td className="p-3">{row.date}<p className="mt-1 font-medium">{row.employee} · {row.employeeId}</p></td><td className="p-3">{money(row.gross)}<p>{money(row.net)}</p></td><td className="p-3">{state.reviews[row.id]?.status ?? 'Pending'}{row.reason && <p className="text-amber-700">Low confidence {Math.round(row.confidence * 100)}%</p>}</td><td className="p-3">{state.posted.includes(row.id) ? 'Posted' : 'Draft'}</td><td className="p-3">{paymentStatus(state, row)}</td><td className="p-3">{reconciliationStatus(state, row)}</td><td className="p-3"><button aria-label={`View payslip ${row.id}`} onClick={() => inspect(row.id)} className="inline-flex min-h-11 items-center rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-indigo-800 focus-visible:ring-2 focus-visible:ring-indigo-500">View & review</button></td></tr>)}</tbody></table></div>{!rows.length && <p className="p-4 text-sm">No matching payslips.</p>}</CardContent></Card>
</div>
        <div hidden={!showPayslip} className="space-y-3"><p className="text-sm font-medium text-slate-600">{selected.employee} · Pay date {selected.date}</p><div className="flex flex-wrap gap-2 xl:hidden"><Button className={workspaceAction} variant={payslipSection === 'actions' ? 'secondary' : 'outline'} aria-pressed={payslipSection === 'actions'} onClick={() => setPayslipSection('actions')}>Review actions</Button><Button className={workspaceAction} variant={payslipSection === 'amounts' ? 'secondary' : 'outline'} aria-pressed={payslipSection === 'amounts'} onClick={() => setPayslipSection('amounts')}>Pay breakdown</Button></div><section aria-label="Selected payslip evidence" className="grid items-start gap-4 xl:grid-cols-2">        <Card className={payslipSection === 'amounts' ? '' : 'hidden xl:flex'}><CardHeader><CardTitle>Mock payslip · {selected.employee}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="break-all text-sm text-slate-500">{selected.id} · {selected.department} · {selected.employment} · Pay date {selected.date}</p>{!rows.some(row => row.id === selected.id) && <p className="text-xs text-amber-800">This linked payslip is outside the current table filters; its evidence is shown without changing those filters.</p>}
          <div className="grid gap-2 md:grid-cols-2">{[['Base pay', selected.base], ['Overtime', selected.overtime], ['Allowance', selected.allowance], ['Bonus', selected.bonus], ['Gross', selected.gross], ['Withholding', selected.withholding], ['Other deductions', selected.deductions], ['Net', selected.net], ['Employer super', selected.superannuation], ['Employer cost', selected.employerCost]].map(([label, value]) => <div key={label} className="flex justify-between border-b p-2 text-sm"><span>{label}</span><span className="font-semibold">{money(Number(value))}</span></div>)}</div>
          <p className="rounded bg-slate-50 p-3 text-sm">Gross − withholding − deductions = net. Employer cost = gross + super; employer super is not deducted from net. These are fixture calculations, not statutory rates.</p>
          <p className="text-sm">Review: {state.reviews[selected.id]?.status ?? 'Pending'} · {state.posted.includes(selected.id) ? 'Posted' : 'Draft'} · {paymentStatus(state, selected)} · {reconciliationStatus(state, selected)}</p>
          {selected.reason && <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">{selected.reason}</p>}
        </CardContent></Card><Card className={payslipSection === 'actions' ? '' : 'hidden xl:flex'}><CardHeader><CardTitle>Review & posting actions</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-slate-500">Add your reviewer name and evidence note. Save an approval before posting; post before simulating payment.</p>
          <div className="grid gap-3 md:grid-cols-2"><label className="text-xs">Reviewer (demo, self-declared)<input aria-label="Payroll reviewer" maxLength={100} className={`${field} mt-1 w-full`} value={reviewer} onChange={e => setReviewer(e.target.value)} /></label><label className="text-xs">Decision<select aria-label="Payroll review decision" className={`${field} mt-1 w-full`} value={decision} onChange={e => setDecision(e.target.value as typeof decision)}><option>Approved</option><option>Needs changes</option></select></label></div>
          <label className="block text-xs">Evidence / action note<textarea aria-label="Payroll evidence note" className={`${field} mt-1 w-full`} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
          <div className="grid gap-3"><Button className={workspaceAction} disabled={busy || !reviewer.trim() || !note.trim()} onClick={() => void save({ type: 'review', lineId: selected.id, status: decision, reviewer, note })}>Save review</Button><Button className={workspaceAction} variant="outline" disabled={busy || !reviewer.trim() || !note.trim() || state.reviews[selected.id]?.status !== 'Approved' || state.posted.includes(selected.id)} onClick={() => void save({ type: 'post', lineId: selected.id, reviewer, note })}>Post to demo ledger</Button><Button className={workspaceAction} variant="outline" disabled={busy || !reviewer.trim() || !note.trim() || state.reviews[selected.id]?.status !== 'Approved' || !state.posted.includes(selected.id) || paidAmount(state, selected.id) >= selected.net} onClick={() => void save({ type: 'pay', lineId: selected.id, reviewer, note })}>Simulate remaining payment</Button></div>
          <p className="text-xs text-slate-500">Actions use this payslip’s demo pay date ({selected.date}); the audit timestamp records when you click. Changing review status does not reverse historical postings. No bank connection or real transfer occurs.</p>
          <Button className={workspaceAction} variant="outline" onClick={() => navigate('payments')}><Landmark className="size-4" />View payments & bank evidence<ArrowRight className="size-4" /></Button>
          {state.reviews[selected.id] && <p className="text-xs text-slate-600">Saved review: {state.reviews[selected.id].reviewer} · {state.reviews[selected.id].note}</p>}
        </CardContent></Card>
</section></div>
      </WorkspacePanel>
      <WorkspacePanel id="payroll" value="review" active={tab}>      <Card><CardHeader><CardTitle>Low confidence / manual review</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-xs text-slate-500">All exceptions in the current filters, including reviewed items. Fixture confidence is not an AI probability.</p>{exceptions.map(row => <button key={row.id} onClick={() => inspect(row.id)} className="block min-h-16 w-full rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-left text-sm transition hover:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500"><span className="font-semibold">{row.employee} · {row.date} · {state.reviews[row.id]?.status ?? 'Pending'}</span><span className="block text-xs">{row.reason || state.reviews[row.id]?.note} → Open payslip & review</span></button>)}{!exceptions.length && <p className="text-sm text-slate-500">No exceptions in these filters.</p>}</CardContent></Card>
</WorkspacePanel>
      <WorkspacePanel id="payroll" value="payments" active={tab}>
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4"><label className="min-w-0 flex-1 text-sm font-medium">Selected payslip<select aria-label="Selected payslip" className={`${field} mt-2 w-full`} value={selectedId} onChange={e => { setSelectedId(e.target.value); setNote(''); setMessage('') }}>{PAYROLL_LINES.map(row => <option value={row.id} key={row.id}>{row.date} · {row.employee} · {row.employeeId}</option>)}</select></label><Button className={workspaceAction} variant="outline" onClick={() => inspect(selected.id)}><FileText className="size-4" />Open payslip</Button></div>
        <label className="block rounded-xl border bg-white p-4 text-sm font-medium">Bank reviewer (demo, self-declared)<input aria-label="Bank reviewer" className={`${field} mt-2 w-full`} maxLength={100} value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="Enter your name before confirming a bank match" /></label>
        <div className="max-h-[70vh] overflow-auto rounded-xl">        <Card><CardHeader><CardTitle>Employee payment ↔ bank evidence</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm">Payslip net {money(selected.net)} · Settled {money(paidAmount(state, selected.id))} · Outstanding {money(selected.net - paidAmount(state, selected.id))}</p>{!payments.length && <p className="text-sm text-slate-500">No payment exists. Approve, post, then simulate a payment to complete the demo.</p>}{payments.map(p => <PayrollBankReview key={p.id} state={state} payment={p} reviewer={reviewer} busy={busy} act={save} />)}</CardContent></Card>
</div>
      </WorkspacePanel>
      <WorkspacePanel id="payroll" value="ledger" active={tab}><div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4"><label className="min-w-0 flex-1 text-sm font-medium">Selected payslip<select aria-label="Selected payslip" className={`${field} mt-2 w-full`} value={selectedId} onChange={e => { setSelectedId(e.target.value); setNote(''); setMessage('') }}>{PAYROLL_LINES.map(row => <option value={row.id} key={row.id}>{row.date} · {row.employee} · {row.employeeId}</option>)}</select></label><Button className={workspaceAction} variant="outline" onClick={() => inspect(selected.id)}><FileText className="size-4" />Open payslip</Button></div>        <Card><CardHeader><CardTitle>Linked journal entries</CardTitle></CardHeader><CardContent><JournalTable lines={journal.filter(line => line.lineId === selected.id)} /></CardContent></Card>
      <details className="rounded-lg border bg-white p-4 text-sm"><summary className="cursor-pointer font-semibold">Browser audit history · revision {state.revision}</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(state.history, null, 2)}</pre></details>
</WorkspacePanel>
    </>}
  </main>
}
