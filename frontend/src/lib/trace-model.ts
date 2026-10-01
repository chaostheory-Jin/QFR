import type { RawRow } from './report-data'
import type { BalanceSheetData } from './balance-sheet-mock'
import { flattenBalanceLines } from './balance-sheet-review'
import { quickBooksBalanceEvidence } from './financial-lineage'
import { profitEntry, type TraceEntry } from './trace-data'
import type { TraceSource } from './trace-navigation'

export type TraceGroup = { id: string; label: string; section: string; amount: number; entries: TraceEntry[]; opening?: number; calculated?: number }
export const traceLabel = (label: string) => label.split(' > ').at(-1) || label
export function profitTraceGroups(rows: RawRow[]): TraceGroup[] {
  const groups = new Map<string, TraceGroup>()
  for (const row of rows) {
    const category = row.MappedCategory || 'Unmapped'
    const group = groups.get(category) ?? { id: category, label: category, section: 'Report categories', amount: 0, entries: [] }
    group.amount += row.Amount; group.entries.push(profitEntry(row)); groups.set(category, group)
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}
export function balanceTraceGroups(data: BalanceSheetData, source: TraceSource, endDate: string): TraceGroup[] {
  // Only leaf accounts are navigable here; adding subtotals would duplicate their transactions.
  return flattenBalanceLines(data).filter(line => line.kind === 'Line').map(line => {
    const accounts = source === 'quickbooks' ? quickBooksBalanceEvidence(line, endDate) : []
    return { id: line.key, label: line.account, section: line.section, amount: line.current,
      ...(source === 'quickbooks' ? { opening: accounts.reduce((sum, account) => sum + account.opening, 0), calculated: accounts.reduce((sum, account) => sum + account.contribution, 0) } : {}),
      entries: accounts.flatMap(account => account.movements.map(movement => ({
        id: `movement-${movement.sourceIndex}`, date: movement.date, amount: movement.amount, account: account.name,
        description: 'Account movement from the downloaded balance-sheet records.', reference: '', contact: '', type: 'Account movement', category: line.account,
      }))),
    }
  })
}
