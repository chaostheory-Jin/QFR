'use client'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { flattenBalanceLines } from '@/lib/balance-sheet-review'
import { quickBooksBalanceEvidence } from '@/lib/financial-lineage'
import { QUICKBOOKS_DATA } from '@/lib/quickbooks-report-data'
import type { BalanceSheetData } from '@/lib/balance-sheet-mock'

export function BalanceTrace({ data, source, endDate }: { data: BalanceSheetData; source: 'xero' | 'quickbooks'; endDate: string }) {
  const [key, setKey] = useState('')
  const lines = flattenBalanceLines(data), selected = lines.find(line => line.key === key)
  const evidence = selected && source === 'quickbooks' ? quickBooksBalanceEvidence(selected, endDate) : []
  const calculated = evidence.reduce((sum, account) => sum + account.contribution, 0)
  return <Card><CardHeader><CardTitle>Balance sheet calculation trace</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-xs text-muted-foreground">Click a balance to inspect its components. {source === 'quickbooks' ? `Opening snapshot ${QUICKBOOKS_DATA.balanceSheet.openingDate} plus downloaded movements through ${endDate}.` : 'Xero demo balances are illustrative; this bundle does not provide a complete transaction-level reconciliation.'}</p>
    <div className="flex flex-wrap gap-2">{lines.map(line => <Button size="sm" variant="outline" key={line.key} onClick={() => setKey(line.key)}>{line.account}: {line.current.toLocaleString()} {data.currency}</Button>)}</div>
    {selected && <div className="space-y-2 text-sm"><p>{selected.account} · Report {selected.current} {data.currency} · {selected.reason}</p>
      {source === 'quickbooks' ? <><p>Opening + movement contributions: {calculated.toLocaleString()} {data.currency}</p>{Math.abs(calculated - selected.current) > 0.005 && <p role="alert" className="text-amber-800">This filtered or derived balance differs from the available source components. Do not treat it as fully reconciled.</p>}
        <div className="max-h-80 overflow-auto">{evidence.map(account => <details className="border-t py-2" key={account.key}><summary className="cursor-pointer">{account.name} · Account ID {account.key} · Opening {account.opening} + {account.movements.length} movements · Contribution {account.contribution}</summary><pre className="whitespace-pre-wrap text-xs">{JSON.stringify({ sourceFile: 'quickbooks-report-data.generated.json', accountKey: account.key, openingDate: QUICKBOOKS_DATA.balanceSheet.openingDate, through: endDate, ...account }, null, 2)}</pre></details>)}</div></>
        : <pre className="whitespace-pre-wrap text-xs">{JSON.stringify({ sourceFile: 'balance-sheet-periods.ts / demo balance snapshot', component: selected, transactionEvidenceAvailable: false }, null, 2)}</pre>}
    </div>}
  </CardContent></Card>
}
