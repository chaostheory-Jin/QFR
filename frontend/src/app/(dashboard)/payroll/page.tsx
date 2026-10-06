'use client'

import { useEffect, useMemo, useState } from 'react'
import { Users, Wallet, ShieldCheck, AlertTriangle } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExportControls, type ExportMode } from '@/components/ExportControls'
import { exportRowsToExcel } from '@/lib/excel-export'
import { PAYROLL_LINES, PAYROLL_SOURCE, filterPayroll, payrollMonthly, payrollTotals, type PayrollFilters, type PayrollLine } from '@/lib/payroll-mock'
import { loadPayrollReviews, savePayrollReview, type PayrollReviews, type PayrollReview } from '@/lib/payroll-reviews'

const defaults: PayrollFilters = { from: '2026-01-01', to: '2026-09-30', department: '', status: '', search: '', lowOnly: false }
const field = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm'
const money = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100)

function PayrollReviewForm({ row, review, disabled, onSave }: { row: PayrollLine; review?: PayrollReview; disabled: boolean; onSave: (id: string, status: PayrollReview['status'], note: string) => Promise<void> }) {
  const [note, setNote] = useState(review?.note ?? ''), [status, setStatus] = useState<PayrollReview['status']>(review?.status ?? 'Approved')
  return <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
    <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{row.employee} · {row.date}</p><span className="text-sm">{Math.round(row.confidence * 100)}% · {review?.status ?? 'Pending review'}</span></div>
    <p className="mt-1 text-sm text-slate-600">{row.reason}</p><p className="mt-1 text-xs text-slate-500">{row.id} · Gross {money(row.gross)} · Net {money(row.net)}</p>
    <div className="mt-3 grid items-end gap-3 md:grid-cols-[160px_1fr_auto]">
      <label className="text-xs">Decision<select aria-label={`Review status ${row.id}`} className={field} value={status} onChange={event => setStatus(event.target.value as PayrollReview['status'])}><option>Approved</option><option>Needs changes</option></select></label>
      <label className="text-xs">Evidence / reviewer note<input aria-label={`Review note ${row.id}`} className={field} value={note} maxLength={2000} placeholder="Explain what was checked" onChange={event => setNote(event.target.value)} /></label>
      <Button disabled={disabled || !note.trim()} onClick={() => void onSave(row.id, status, note)}>Save review</Button>
    </div>
    {review && <p className="mt-2 text-xs text-slate-500">Saved locally · Revision {review.revision} · {new Date(review.updatedAt).toLocaleString()}</p>}
  </div>
}

export default function PayrollPage() {
  const [filters, setFilters] = useState<PayrollFilters>(defaults), [mode, setMode] = useState<ExportMode>('byLine')
  const [store, setStore] = useState<PayrollReviews>({ reviews: {}, history: [] })
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void loadPayrollReviews().then(value => { if (active) { setStore(value); setReady(true) } }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [])
  const rows = useMemo(() => filterPayroll(PAYROLL_LINES, filters), [filters])
  const totals = payrollTotals(rows), months = payrollMonthly(rows)
  const selected = rows.find(row => row.id === selectedId)
  const exceptions = rows.filter(row => row.confidence <= 0.7)
  const pending = exceptions.filter(row => store.reviews[row.id]?.status !== 'Approved').length
  const invalidPeriod = filters.from > filters.to || !filters.from || !filters.to
  function update<K extends keyof PayrollFilters>(key: K, value: PayrollFilters[K]) { setFilters(current => ({ ...current, [key]: value })) }
  async function save(id: string, status: PayrollReview['status'], note: string) {
    setSaving(true); setError('')
    try { setStore(await savePayrollReview(id, status, note, store.reviews[id]?.revision ?? 0)) }
    catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  function exportPayroll() {
    const common = { Source: PAYROLL_SOURCE, Company: 'Peak Demo Pty Ltd (fictional)', Currency: 'AUD', From: filters.from, To: filters.to }
    exportRowsToExcel(mode === 'byLine' ? rows.map(row => ({ ...common, LineID: row.id, PayRun: row.run, PayDate: row.date, EmployeeID: row.employeeId,
      Employee: row.employee, Department: row.department, Employment: row.employment, PaymentStatus: row.status, Base: row.base / 100,
      Overtime: row.overtime / 100, Allowance: row.allowance / 100, Bonus: row.bonus / 100, Gross: row.gross / 100, Withholding: row.withholding / 100,
      Deductions: row.deductions / 100, Net: row.net / 100, Super: row.superannuation / 100, EmployerCost: row.employerCost / 100,
      Confidence: row.confidence, ReviewReason: row.reason, ReviewStatus: store.reviews[row.id]?.status ?? (row.reason ? 'Pending' : 'Not required'),
      ReviewNote: store.reviews[row.id]?.note ?? '',
    })) : months.map(month => ({ ...common, Month: month.month, Gross: month.gross / 100, Withholding: month.withholding / 100,
      Deductions: month.deductions / 100, Net: month.net / 100, Super: month.superannuation / 100, EmployerCost: month.employerCost / 100 })),
    `mock-payroll-${filters.from}-${filters.to}-${mode}.xlsx`, 'Mock payroll')
  }
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">People & pay</p><h1 className="mt-1 text-2xl font-bold">Payroll</h1><p className="mt-1 text-sm text-slate-500">Peak Demo Pty Ltd · January–September 2026 · AUD</p></div><div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">MOCK DATA</span><ExportControls mode={mode} onModeChange={setMode} onExport={exportPayroll} disabled={!rows.length || !ready || invalidPeriod} /></div></header>
    <p className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-sm text-indigo-950">12 fictional employees · 9 monthly pay runs · 108 payslips. Withholding, superannuation and confidence scores are illustrative fixtures, not statutory calculations or real AI results. This register does not post to P&amp;L or Balance Sheet and cannot send payments.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <Card><CardContent className="pt-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs font-medium text-slate-600">Pay date from<input aria-label="Payroll from" type="date" className={field} value={filters.from} onChange={event => update('from', event.target.value)} /></label>
      <label className="text-xs font-medium text-slate-600">Pay date to<input aria-label="Payroll to" type="date" className={field} value={filters.to} onChange={event => update('to', event.target.value)} /></label>
      <label className="text-xs font-medium text-slate-600">Department<select aria-label="Payroll department" className={field} value={filters.department} onChange={event => update('department', event.target.value)}><option value="">All departments</option>{Array.from(new Set(PAYROLL_LINES.map(row => row.department))).sort().map(department => <option key={department}>{department}</option>)}</select></label>
      <label className="text-xs font-medium text-slate-600">Payment status<select aria-label="Payroll payment status" className={field} value={filters.status} onChange={event => update('status', event.target.value)}><option value="">Paid + draft</option><option>Paid</option><option>Draft</option></select></label>
      <label className="text-xs font-medium text-slate-600">Employee / pay run<input aria-label="Search payroll" className={field} placeholder="Name, employee ID or run" value={filters.search} onChange={event => update('search', event.target.value)} /></label>
    </div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.lowOnly} onChange={event => update('lowOnly', event.target.checked)} />Only low confidence (≤70%)</label><Button variant="ghost" size="sm" onClick={() => { setFilters(defaults); setSelectedId(null) }}>Reset filters</Button></div>{invalidPeriod && <p role="alert" className="mt-2 text-sm text-red-700">Choose valid dates with From no later than To.</p>}</CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      { label: 'Gross pay', value: money(totals.gross), icon: Wallet, hint: `${rows.length} filtered payslips · includes drafts unless filtered` },
      { label: 'Net pay', value: money(totals.net), icon: Users, hint: `${new Set(rows.map(row => row.employeeId)).size} employees · after withholding and deductions` },
      { label: 'Employer cost', value: money(totals.employerCost), icon: ShieldCheck, hint: `Gross + ${money(totals.superannuation)} super` },
      { label: 'Needs review', value: String(pending), icon: AlertTriangle, hint: `${exceptions.length} low-confidence lines in this selection` },
    ].map(({ label, value, icon: Icon, hint }) => <Card key={label}><CardContent className="pt-5"><p className="flex items-center justify-between text-sm text-slate-500">{label}<Icon size={17} className="text-indigo-500" /></p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs text-slate-500">{hint}</p></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle>Monthly payroll</CardTitle></CardHeader><CardContent>{months.length ? <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={months.map(month => ({ month: month.month, Gross: month.gross / 100, Net: month.net / 100, 'Employer cost': month.employerCost / 100 }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={value => `$${Number(value) / 1000}k`} tick={{ fontSize: 11 }} /><Tooltip formatter={value => money(Number(value) * 100)} /><Legend /><Bar dataKey="Gross" fill="#6366f1" radius={[3, 3, 0, 0]} /><Bar dataKey="Net" fill="#06b6d4" radius={[3, 3, 0, 0]} /><Bar dataKey="Employer cost" fill="#94a3b8" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div> : <p className="py-8 text-center text-sm text-slate-500">No payroll lines match these filters.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Pay-run summary</CardTitle></CardHeader><CardContent><div className="overflow-auto"><table className="w-full min-w-[700px] text-right text-sm"><thead><tr className="text-slate-500">{['Month', 'Gross', 'Withholding', 'Other deductions', 'Net', 'Super', 'Employer cost'].map(label => <th key={label} className="p-2 font-medium">{label}</th>)}</tr></thead><tbody>{months.map(month => <tr key={month.month} className="border-t"><td className="p-2">{month.month}</td>{[month.gross, month.withholding, month.deductions, month.net, month.superannuation, month.employerCost].map((value, index) => <td key={index} className="p-2 tabular-nums">{money(value)}</td>)}</tr>)}</tbody><tfoot><tr className="border-t bg-slate-50 font-semibold"><td className="p-2">Total</td>{[totals.gross, totals.withholding, totals.deductions, totals.net, totals.superannuation, totals.employerCost].map((value, index) => <td key={index} className="p-2 tabular-nums">{money(value)}</td>)}</tr></tfoot></table></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Payroll by line <span className="text-sm font-normal text-slate-500">· {rows.length} payslips</span></CardTitle></CardHeader><CardContent><p className="mb-3 text-xs text-slate-500">Select a payslip to trace its exact calculation. Review approval does not change pay amounts or payment status.</p><div className="max-h-[440px] overflow-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead className="sticky top-0 bg-white"><tr>{['Pay date', 'Employee', 'Department', 'Status', 'Gross', 'Net', 'Super', 'Confidence', 'Payslip'].map(label => <th className="p-2 font-medium text-slate-500" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className={`border-t ${row.id === selectedId ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}><td className="p-2 whitespace-nowrap">{row.date}</td><td className="p-2"><p>{row.employee}</p><p className="text-xs text-slate-400">{row.employeeId}</p></td><td className="p-2">{row.department}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-xs ${row.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{row.status}</span></td>{[row.gross, row.net, row.superannuation].map((value, index) => <td className="p-2 tabular-nums whitespace-nowrap" key={index}>{money(value)}</td>)}<td className={`p-2 ${row.reason ? 'text-amber-700' : 'text-slate-500'}`}>{Math.round(row.confidence * 100)}%</td><td className="p-2"><button className="text-indigo-700 underline" onClick={() => setSelectedId(row.id)} aria-label={`View payslip ${row.id}`}>View</button></td></tr>)}</tbody></table></div>{!rows.length && <p className="py-5 text-center text-sm text-slate-500">No matching payslips.</p>}</CardContent></Card>
    {selected && <Card><CardHeader><CardTitle>Mock payslip · {selected.employee}</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-slate-500">{selected.id} · {selected.employment} · {selected.department} · {selected.status}</p><div className="grid gap-2 sm:grid-cols-2">{[['Base pay', selected.base], ['Overtime', selected.overtime], ['Allowance', selected.allowance], ['Bonus', selected.bonus], ['Gross pay', selected.gross], ['Withholding', selected.withholding], ['Other deductions', selected.deductions], ['Net pay', selected.net], ['Employer super', selected.superannuation], ['Employer cost', selected.employerCost]].map(([label, amount]) => <div key={label} className="flex justify-between border-b p-2 text-sm"><span>{label}</span><span className="font-medium tabular-nums">{money(Number(amount))}</span></div>)}</div><p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">Gross = base + overtime + allowance + bonus.<br />Net = {money(selected.gross)} − {money(selected.withholding)} − {money(selected.deductions)} = {money(selected.net)}.<br />Employer cost = {money(selected.gross)} + {money(selected.superannuation)} = {money(selected.employerCost)}.</p><p className="mt-3 text-xs text-slate-500">Fixture assumption: withholding is 14% or 23% of gross; super is 12% of base + allowance + bonus. Not a statutory or award interpretation.</p></CardContent></Card>}
    <Card><CardHeader><CardTitle>Low confidence / manual review</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-slate-500">Shows every low-confidence line in the current filters, including reviewed lines. Decisions and notes are saved only in this browser.</p>{exceptions.map(row => <PayrollReviewForm key={`${row.id}-${store.reviews[row.id]?.revision ?? 0}`} row={row} review={store.reviews[row.id]} disabled={!ready || saving} onSave={save} />)}{!exceptions.length && <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">No low-confidence lines in this selection.</p>}<details className="text-xs text-slate-500"><summary className="cursor-pointer">Local review history</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(store.history.filter(item => rows.some(row => row.id === item.lineId)), null, 2)}</pre></details></CardContent></Card>
  </main>
}
