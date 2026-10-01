import { REPORT_DATA } from './report-data-mock'
import { QUICKBOOKS_DATA, QUICKBOOKS_REPORT_DATA } from './quickbooks-report-data'
import { withLineIds } from './mapping-reviews'
import type { RawRow } from './report-data'
import type { TraceReport, TraceSource } from './trace-navigation'

export type TraceEntry = {
  id: string; date: string; account: string; description: string; amount: number
  reference: string; contact: string; type: string; category: string; reviewStatus?: string
}
export function profitEntry(row: RawRow): TraceEntry {
  return { id: row.LineID!, date: row.Date, account: row.AccountName, description: row.Description,
    amount: row.Amount, reference: String(row.InvoiceNumber ?? ''), contact: row.Contact,
    type: row.Type, category: row.MappedCategory, reviewStatus: row.ReviewStatus }
}
// Attachment identity is resolved against the original bundle on the server, not
// against an editable description, invoice number, or a client-provided amount.
export function originalTraceRecord(source: TraceSource, report: TraceReport, id: string) {
  if (!['xero', 'quickbooks'].includes(source) || !['profit-loss', 'balance-sheet'].includes(report) || typeof id !== 'string') throw new Error('Unknown report record.')
  const company = source === 'quickbooks' ? QUICKBOOKS_DATA.source.company : 'Demo Company (AU)'
  if (report === 'profit-loss') {
    const data = source === 'quickbooks' ? QUICKBOOKS_REPORT_DATA : REPORT_DATA
    const row = withLineIds(data.raw_data).find(row => row.LineID === id)
    if (!row) throw new Error('Unknown report record.')
    return { source, report, company, record: row }
  }
  const match = /^movement-(0|[1-9]\d*)$/.exec(id)
  const index = match ? Number(match[1]) : -1
  const movement = source === 'quickbooks' ? QUICKBOOKS_DATA.balanceSheet.movements[index] : undefined
  if (!movement) throw new Error('This balance has no transaction-level source record.')
  return { source, report, company, record: { id, ...movement, openingDate: QUICKBOOKS_DATA.balanceSheet.openingDate } }
}

export type SupportingDocument = { id: string; name: string; mime: string; size: number; addedAt: string; note: string }
