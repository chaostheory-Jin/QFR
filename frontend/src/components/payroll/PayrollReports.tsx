'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { DataSourceSelect } from '@/components/DataSourceSelect'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { WorkspacePanel, workspaceAction, workspaceLink } from '@/components/WorkspaceTabs'
import { ReportNavigation, ReportPagination, useReportPagination, type ReportTab } from '@/components/report/ReportWorkspace'
import { Button } from '@/components/ui/button'
import { ExportControls, type ExportMode } from '@/components/ExportControls'
import { exportRowsToExcel } from '@/lib/excel-export'
import { usePayroll } from '@/lib/use-payroll'
import { setStoredDataSource, type ReportSource } from '@/lib/report-source'
import { ACCOUNTS, BALANCE_ACCOUNTS, EXPENSE_ACCOUNTS, OPENING_DATE, PAYROLL_COMPANY, accountBalance, payrollReport, type Account } from '@/lib/payroll-ledger'
import { PAYROLL_LINES } from '@/lib/payroll-mock'
import { JournalTable, payrollField, payrollMoney as money } from './PayrollEvidence'

export function PayrollReports({ report, onSource, query = '' }: { report: 'profit-loss' | 'balance-sheet'; onSource: (source: ReportSource) => void; query?: string }) {
  const [tab, setTab] = useState<ReportTab>('overview')
  const [allAccounts, setAllAccounts] = useState(true)
  const { state, error, reload } = usePayroll()
  const [from, setFrom] = useState(() => new URLSearchParams(query).get('from') || '2026-01-01')
  const [to, setTo] = useState(() => new URLSearchParams(query).get('to') || '2026-09-30')
  const [account, setAccount] = useState<Account | 'loss'>(report === 'profit-loss' ? 'wages' : 'bank')
  const [mode, setMode] = useState<ExportMode>('byLine')
  const data = useMemo(() => state ? payrollReport(state, from, to) : null, [state, from, to])
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
  const invalid = !validDate(from) || !validDate(to) || from > to || from <= OPENING_DATE
  const accounts = report === 'profit-loss' ? [...EXPENSE_ACCOUNTS] : [...BALANCE_ACCOUNTS, 'loss'] as const
  const entries = data?.journal.filter(l => (report === 'balance-sheet' || EXPENSE_ACCOUNTS.some(a => a === l.account)) && (allAccounts || (account === 'loss' ? EXPENSE_ACCOUNTS.some(a => a === l.account) : l.account === account)) && l.date >= from && l.date <= to) ?? []
  const entriesPage = useReportPagination(entries, JSON.stringify([from, to, account, allAccounts, report]))
  const reviewRows = PAYROLL_LINES.filter(row => row.date >= from && row.date <= to && (row.reason || state?.reviews[row.id]?.status !== 'Approved'))
  const reviewsPage = useReportPagination(reviewRows, from + to)
  function balance(key: Account | 'loss', date: string, exclusive = false) {
    if (!data) return 0
    return key === 'loss' ? -EXPENSE_ACCOUNTS.reduce((total, a) => total + accountBalance(data.journal, a, date, exclusive), 0) : accountBalance(data.journal, key, date, exclusive)
  }
  const label = (key: Account | 'loss') => key === 'loss' ? 'Current-year earnings (payroll-only loss)' : ACCOUNTS[key]
  function exportReport() {
    if (!data || invalid) return
    const common = { Source: 'Payroll Demo (fictional)', Company: PAYROLL_COMPANY, Currency: 'AUD', From: from, To: to }
    const relevant = data.journal.filter(line => line.date >= from && line.date <= to && (report === 'balance-sheet' || EXPENSE_ACCOUNTS.some(a => a === line.account)))
    exportRowsToExcel(mode === 'byLine' ? relevant.map(line => ({ ...common, Date: line.date, Journal: line.journalId, Account: ACCOUNTS[line.account], Debit: line.debit / 100, Credit: line.credit / 100, Payslip: line.lineId ?? '', Payment: line.paymentId ?? '', Description: line.description })) : accounts.map(key => ({ ...common, Account: label(key), Opening: balance(key, from, true) / 100, Movement: (balance(key, to) - balance(key, from, true)) / 100, Closing: balance(key, to) / 100 })), `payroll-demo-${report}-${mode}.xlsx`, 'Payroll Demo')
  }
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
    <header className="flex flex-wrap justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Payroll Demo · AUD</p><h1 className="mt-1 text-2xl font-bold">{report === 'profit-loss' ? 'Profit & Loss' : 'Balance Sheet'}</h1><p className="mt-1 text-sm text-slate-500">{PAYROLL_COMPANY} · Shared payroll ledger</p></div><DataSourceSelect value="payroll" onChange={onSource} /></header>
    <details className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm"><summary className="cursor-pointer font-semibold">Payroll-only demo · Reporting basis</summary><p className="mt-3">Fictional payroll-only company, isolated from Xero and QuickBooks. Posted payroll creates expenses and liabilities; settled mock payments clear liabilities without repeating expenses. Drafts are excluded. No real transfers, statutory calculations or employee access.</p></details>
    <nav className="flex flex-wrap gap-4 text-sm text-indigo-700"><Link href="/payroll" className={workspaceLink}>Payroll & payslips</Link>{(['profit-loss', 'balance-sheet'] as const).map(item => <Link key={item} onClick={() => setStoredDataSource('payroll')} className={workspaceLink} href={`/${item}`}>{item === 'profit-loss' ? 'P&L' : 'Balance Sheet'}</Link>)}<Link className={workspaceLink} href={`/report-trace?report=${report}&source=payroll&from=${from}&to=${to}`}>Report explorer</Link></nav>
    <ReportNavigation id="payroll-report" value={tab} onChange={setTab} reviewCount={reviewRows.length} />
    <div className="flex flex-wrap items-end gap-3"><label className="text-xs">{report === 'profit-loss' ? 'Period from' : 'Opening at start of'}<input className={`${payrollField} ml-2`} aria-label="Payroll report from" type="date" min="2026-01-01" value={from} onChange={e => setFrom(e.target.value)} /></label><label className="text-xs">{report === 'profit-loss' ? 'Period to' : 'Closing through'}<input aria-label="Payroll report to" className={`${payrollField} ml-2`} type="date" value={to} onChange={e => setTo(e.target.value)} /></label><Button className={workspaceAction} variant="outline" onClick={() => void reload()}>Reload browser data</Button><ExportControls mode={mode} onModeChange={setMode} onExport={exportReport} disabled={!data || invalid} /></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {invalid && <p role="alert" className="text-red-700">Choose a valid date range starting after the opening snapshot ({OPENING_DATE}).</p>}
    {!data ? <p role="status">Loading shared payroll ledger…</p> : !invalid && <>
      <WorkspacePanel id="payroll-report" value="overview" active={tab}><p className="text-sm text-slate-500">{from} → {to} · Posted ledger only · AUD</p><div className="grid gap-3 md:grid-cols-3">{(report === 'profit-loss' ? [['Revenue (payroll-only demo)', 0], ['Total payroll expenses', data.expense], ['Net result (no revenue in demo)', -data.expense]] : [['Assets / bank', data.bank], ['Payroll liabilities', data.liabilities], ['Equity', data.equity]]).map(([title, value]) => <Card key={title}><CardContent className="pt-5"><p className="text-sm text-slate-500">{title}</p><p className="mt-2 text-2xl font-semibold">{money(Number(value))}</p></CardContent></Card>)}</div>
      {report === 'balance-sheet' && <p className={`rounded-lg p-3 text-sm ${data.balanceDifference === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>Assets − liabilities − equity = {money(data.balanceDifference)}. Equity uses opening capital less cumulative posted expense, not an artificial balancing figure.</p>}
      <div className="flex flex-wrap gap-3"><Button onClick={() => setTab('transactions')}>View journal movements</Button><Button variant="outline" onClick={() => setTab('analysis')}>See account changes</Button></div></WorkspacePanel>
      <WorkspacePanel id="payroll-report" value="analysis" active={tab}><Card><CardHeader><CardTitle>{report === 'profit-loss' ? 'Posted expenses · choose a line to trace' : 'Opening + movement = closing · choose an account'}</CardTitle></CardHeader><CardContent><div className="overflow-auto"><table className="w-full min-w-[650px] text-sm"><thead><tr className="text-left text-slate-500"><th className="p-3">Account</th>{report === 'balance-sheet' && <th className="p-3 text-right">Opening before {from}</th>}<th className="p-3 text-right">{report === 'profit-loss' ? 'Period expense' : 'Movement'}</th>{report === 'balance-sheet' && <th className="p-3 text-right">Closing {to}</th>}</tr></thead><tbody>{accounts.map(key => {
        const opening = balance(key, from, true), closing = balance(key, to)
        return <tr key={key} className={`border-t ${account === key ? 'bg-indigo-50' : ''}`}><td className="p-3"><button className={workspaceLink} aria-pressed={account === key} onClick={() => { setAccount(key); setAllAccounts(false); setTab('transactions') }}>{label(key)}</button></td>{report === 'balance-sheet' && <td className="p-3 text-right tabular-nums">{money(opening)}</td>}<td className="p-3 text-right tabular-nums">{money(closing - opening)}</td>{report === 'balance-sheet' && <td className="p-3 text-right tabular-nums">{money(closing)}</td>}</tr>
      })}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Amounts are AUD. Liabilities and capital are credit-positive; bank and expenses are debit-positive. Opening includes all earlier posted movements, not only the selected period.</p></CardContent></Card></WorkspacePanel>
      <WorkspacePanel id="payroll-report" value="transactions" active={tab}><label className="flex flex-wrap items-center gap-3 text-sm font-medium">Journal account<select aria-label="Journal account" value={allAccounts ? 'all' : account} className="min-h-11 rounded-lg border bg-white p-2" onChange={event => { setAllAccounts(event.target.value === 'all'); if (event.target.value !== 'all') setAccount(event.target.value as Account | 'loss') }}><option value="all">All report accounts</option>{accounts.map(key => <option key={key} value={key}>{label(key)}</option>)}</select></label><Card><CardHeader><CardTitle>By-line evidence · {allAccounts ? 'All report accounts' : label(account)}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-slate-500">{entries.length} movements in this period. Follow each line to its payslip and employee payment. Historical tax/super remittances through July are fixtures; later balances remain outstanding. Bank statement candidates are evidence, not extra ledger postings.</p><ReportPagination {...entriesPage} label="Payroll transactions" /><JournalTable lines={entriesPage.rows} /></CardContent></Card></WorkspacePanel>
      <WorkspacePanel id="payroll-report" value="review" active={tab}><Card><CardHeader><CardTitle>Low confidence / payroll review</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-xs text-slate-500">Payroll evidence reviews do not silently reclassify or reverse a posted journal. Draft exceptions are shown for visibility but excluded from report amounts.</p>{reviewsPage.total === 0 && <p className="py-3 text-sm text-slate-500">No payroll exceptions or pending reviews in this period.</p>}<ReportPagination {...reviewsPage} label="Payroll reviews" />{reviewsPage.rows.map(row => <Link key={row.id} href={`/payroll#${row.id}`} className="block rounded border border-amber-200 bg-amber-50 p-3 text-sm"><span className="font-semibold">{row.employee} · {row.date} · {state?.posted.includes(row.id) ? 'Posted' : 'Draft — excluded'}</span><span className="block text-xs">{row.reason || state?.reviews[row.id]?.note} · {state?.reviews[row.id]?.status ?? 'Pending review'} → Review payslip</span></Link>)}</CardContent></Card></WorkspacePanel>
    </>}
  </main>
}
