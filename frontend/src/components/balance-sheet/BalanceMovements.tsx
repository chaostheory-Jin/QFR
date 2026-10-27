'use client'
import { TableViewport, CopyReference } from '@/components/TableReading'
import { useMemo } from 'react'
import { balanceTraceGroups } from '@/lib/trace-model'
import type { BalanceSheetData } from '@/lib/balance-sheet-mock'
import type { DataSource } from '@/lib/link-data'
import { ReportPagination, useReportPagination } from '@/components/report/ReportWorkspace'

export function BalanceMovements({ data, source, from, to }: { data: BalanceSheetData; source: DataSource; from: string; to: string }) {
  const entries = useMemo(() => {
    const records = balanceTraceGroups(data, source, to).flatMap(group => group.entries).filter(entry => entry.date >= from && entry.date <= to)
    return [...new Map(records.map(entry => [entry.id, entry])).values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  }, [data, source, from, to])
  const pagination = useReportPagination(entries, JSON.stringify([source, from, to, entries.map(row => row.id)]))
  if (source === 'xero') return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Xero demo balances do not include a complete transaction-level ledger. View account balances instead; no movements have been invented.</p>
  return <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Downloaded account movements</h2><p className="mt-2 text-xs leading-5 text-slate-500">{from} → {to} · {data.currency} · Uses the accounts selected by the report filters. Movement amounts retain the source account sign. Opening balances are shown in Account balances, not repeated as transactions.</p><ReportPagination {...pagination} label="Balance movements" /><TableViewport label="Balance sheet movements" resetKey={`${source}-${from}-${to}-${pagination.page}-${entries.map(row => row.id).join()}`}><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-3">Source line</th><th>Date</th><th>Account</th><th className="text-right">Movement ({data.currency})</th></tr></thead><tbody>{pagination.rows.map(row => <tr className="border-b" key={row.id}><td className="p-3"><CopyReference value={row.id} /></td><td>{row.date}</td><td>{row.account}</td><td className="text-right tabular-nums">{row.amount.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</td></tr>)}</tbody></table></TableViewport>{!entries.length && <p className="py-4 text-sm text-slate-500">No downloaded movements in this selection.</p>}</div>
}
