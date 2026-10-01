import type { RawRow } from './report-data'
import type { CanonicalRecord } from './data-intake'
import type { BalanceLine } from './balance-sheet-review'
import { QUICKBOOKS_DATA } from './quickbooks-report-data'

export function canonicalReportRows(rows: RawRow[], scope: { source: string; company: string; currency: string; snapshot: string; file: string }): CanonicalRecord[] {
  return rows.map((row, index) => ({ id: row.LineID ?? `${scope.snapshot}:${index + 1}`, sourceRecordId: row.LineID ?? '',
    source: scope.source, company: scope.company, currency: scope.currency, batchId: scope.snapshot, kind: 'ledger', sourceFile: scope.file, sourceSheet: 'raw_data', sourceRow: index + 1,
    date: row.Date, amount: row.Amount, account: row.AccountName, description: row.Description, invoice: String(row.InvoiceNumber), contact: row.Contact,
    category: row.MappedCategory, role: row.LineRole ?? 'unknown', tax: null, department: '' }))
}
export function categoryEvidence(rows: RawRow[], category: string | null) {
  const lines = category === null ? rows : rows.filter(row => row.MappedCategory === category)
  return { lines, amount: lines.reduce((sum, row) => sum + row.Amount, 0) }
}
export function quickBooksBalanceEvidence(line: BalanceLine, endDate: string) {
  const section = line.section === 'Net Assets' ? null : line.section
  const accounts = QUICKBOOKS_DATA.balanceSheet.accounts.filter(account => (section === null ? account.section !== 'Equity' : account.section === section)
    && (line.kind !== 'Line' || account.name === line.account)
    && (line.kind === 'Total' || line.kind === 'Line' || account.category.split(' > ')[1] === line.group))
  return accounts.map(account => {
    const movements = QUICKBOOKS_DATA.balanceSheet.movements.map((movement, index) => ({ ...movement, sourceIndex: index }))
      .filter(movement => movement.key === account.key && movement.date <= endDate)
    const sign = line.section === 'Net Assets' && account.section === 'Liabilities' ? -1 : 1
    return { ...account, movements, contribution: sign * (account.opening + movements.reduce((sum, movement) => sum + movement.amount, 0)), sign }
  })
}
