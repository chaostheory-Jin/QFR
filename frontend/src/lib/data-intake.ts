import * as XLSX from 'xlsx'
import { isInvoiceCurrency, minorAmount } from './invoice-evidence'

export const IMPORT_FIELDS = ['date', 'amount', 'currency', 'account', 'description', 'recordId', 'invoice', 'contact', 'category', 'role', 'tax', 'department'] as const
export type ImportField = typeof IMPORT_FIELDS[number]
export type ColumnMap = Partial<Record<ImportField, string>>
export type ImportMetadata = { source: string; company: string; currency: string; kind: 'ledger' | 'invoice' | 'bank'; sample: boolean }
export type SourceTable = { sheet: string; headers: string[]; rows: Array<{ rowNumber: number; cells: Record<string, string | number | boolean | null> }> }
export type CanonicalRecord = {
  id: string; sourceRecordId: string; source: string; company: string; batchId: string; kind: ImportMetadata['kind']
  sourceFile: string; sourceSheet: string; sourceRow: number; date: string; amount: number; currency: string
  account: string; description: string; invoice: string; contact: string; category: string; role: string; tax: number | null; department: string
}
export type ImportIssue = { row: number; field: string; message: string; severity: 'error' | 'warning'; duplicateOf?: number }
export type ValidationResult = { records: CanonicalRecord[]; issues: ImportIssue[]; excludedRows: number[] }

const aliases: Record<ImportField, string[]> = {
  date: ['date', 'transactiondate', 'postingdate'], amount: ['amount', 'total', 'netamount'], currency: ['currency', 'currencycode'],
  account: ['account', 'accountname', 'glaccount'], description: ['description', 'memo'], recordId: ['lineid', 'recordid', 'transactionid'],
  invoice: ['invoice', 'invoicenumber'], contact: ['contact', 'supplier', 'customer', 'name'], category: ['mappedcategory', 'category'],
  role: ['linerole', 'role'], tax: ['tax', 'taxamount'], department: ['department', 'costcentre'],
}
export function suggestColumns(headers: string[]): ColumnMap {
  const result: ColumnMap = {}
  for (const field of IMPORT_FIELDS) {
    const found = headers.find(header => aliases[field].includes(header.toLowerCase().replace(/[^a-z0-9]/g, '')))
    if (found) result[field] = found
  }
  return result
}
export function readSourceTables(bytes: Uint8Array, fileName: string): SourceTable[] {
  if (!/\.(csv|xlsx|xls)$/i.test(fileName)) throw new Error('Use a CSV, XLSX or XLS file.')
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new Error('File must be nonempty and at most 3 MB.')
  // Formula results are not trusted: a cached formula value may be stale.
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, dense: false, raw: true })
  if (workbook.SheetNames.length > 30) throw new Error('Workbook has too many sheets (maximum 30).')
  return workbook.SheetNames.map(sheet => {
    const ws = workbook.Sheets[sheet]
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    if (range.s.r !== 0 || range.s.c !== 0) throw new Error(`Sheet ${sheet}: headers must start in cell A1.`)
    if (range.e.r > 10000 || range.e.c > 99) throw new Error('Maximum 10,000 rows and 100 columns per sheet.')
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })
    const headers = (matrix[0] ?? []).map(value => String(value ?? '').trim())
    if (!headers.length || headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error(`Sheet ${sheet}: headers must be nonempty and unique on the first row.`)
    const rows = matrix.slice(1).flatMap((values, index) => {
      if (values.every(value => value === null || value === '')) return []
      const cells: Record<string, string | number | boolean | null> = {}
      headers.forEach((header, column) => {
        const cell = ws[XLSX.utils.encode_cell({ r: index + 1, c: column })]
        const value = values[column]
        cells[header] = cell?.f ? '[FORMULA: replace with source value]' : value instanceof Date
          ? value.toISOString().slice(0, 10) : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null
      })
      return [{ rowNumber: index + 2, cells }]
    })
    return { sheet, headers, rows }
  })
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function importDate(value: unknown, format: 'ISO' | 'DMY' | 'MDY'): string | null {
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value)
    if (!date || value % 1 !== 0) return null
    const result = `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
    return validDate(result) ? result : null
  }
  const text = String(value ?? '').trim()
  if (validDate(text)) return text
  if (format === 'ISO') return null
  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text)
  if (!match) return null
  const [, first, second, year] = match
  const result = `${year}-${(format === 'DMY' ? second : first).padStart(2, '0')}-${(format === 'DMY' ? first : second).padStart(2, '0')}`
  return validDate(result) ? result : null
}
export function importAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '').trim()
  // Deliberately reject currency symbols, European decimals and malformed grouping.
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null
  const parsed = Number(text.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}
export function validateImport(table: SourceTable, mapping: ColumnMap, metadata: ImportMetadata, batchId: string, fileName: string,
  options: { dateFormat: 'ISO' | 'DMY' | 'MDY'; duplicates: 'block' | 'exclude' | 'keep' }, categories: string[]): ValidationResult {
  if (!metadata.source.trim() || !metadata.company.trim() || metadata.source.length > 200 || metadata.company.length > 200
    || !isInvoiceCurrency(metadata.currency) || !['ledger', 'invoice', 'bank'].includes(metadata.kind) || typeof metadata.sample !== 'boolean') throw new Error('Provide source, company, supported currency and document kind.')
  if (!['ISO', 'DMY', 'MDY'].includes(options.dateFormat) || !['block', 'exclude', 'keep'].includes(options.duplicates)) throw new Error('Invalid date or duplicate policy.')
  for (const field of ['date', 'amount', 'account', 'description'] as const) if (!mapping[field]) throw new Error(`Map the required ${field} column.`)
  for (const [field, column] of Object.entries(mapping)) if (!IMPORT_FIELDS.includes(field as ImportField) || (column && !table.headers.includes(column))) throw new Error('Unknown mapped column.')
  const records: CanonicalRecord[] = [], issues: ImportIssue[] = [], excludedRows: number[] = []
  const seen = new Map<string, number>()
  for (const row of table.rows) {
    const get = (field: ImportField) => mapping[field] ? row.cells[mapping[field]!] : null
    const text = (field: ImportField) => String(get(field) ?? '').trim()
    const error = (field: string, message: string) => issues.push({ row: row.rowNumber, field, message, severity: 'error' })
    const date = importDate(get('date'), options.dateFormat), amount = importAmount(get('amount'))
    const currency = mapping.currency ? text('currency').toUpperCase() : metadata.currency
    if (!date) error('date', 'Invalid or missing date. Choose the correct date convention.')
    if (amount === null || Math.abs(amount) > 1e12 || minorAmount(amount, currency) === null) error('amount', 'Invalid amount or unsupported currency precision; zero is allowed.')
    if (!isInvoiceCurrency(currency) || currency !== metadata.currency) error('currency', 'Missing/invalid currency or mixed-currency batch. Split currencies before reporting.')
    for (const field of ['account', 'description'] as const) if (!text(field)) error(field, 'Required value is missing.')
    const tax = get('tax') === null || text('tax') === '' ? null : importAmount(get('tax'))
    if (text('tax') && (tax === null || minorAmount(tax, currency) === null)) error('tax', 'Invalid tax amount.')
    const category = categories.includes(text('category')) ? text('category') : 'Unmapped'
    if (category === 'Unmapped') issues.push({ row: row.rowNumber, field: 'category', severity: 'warning', message: 'Classification requires review; no category was inferred from the account ID.' })
    const role = text('role')
    if (role && !['income', 'other_income', 'expense', 'other_expense', 'cost_of_goods_sold', 'unknown'].includes(role)) error('role', 'Unknown line role.')
    const key = text('recordId') ? `id:${text('recordId')}` : JSON.stringify([date, amount, currency, text('account'), text('description'), text('invoice'), text('contact')])
    const duplicateOf = seen.get(key)
    if (duplicateOf !== undefined) {
      // Repeated source IDs are never allowed. Identical rows without IDs may be legitimate, so require an explicit policy.
      const conflictingId = Boolean(text('recordId')) && JSON.stringify(row.cells) !== JSON.stringify(table.rows.find(r => r.rowNumber === duplicateOf)?.cells)
      issues.push({ row: row.rowNumber, field: 'duplicate', message: conflictingId ? 'Conflicting source ID; correct the file.' : `Duplicate of row ${duplicateOf}.`, severity: conflictingId || options.duplicates === 'block' || (text('recordId') && options.duplicates === 'keep') ? 'error' : 'warning', duplicateOf })
      if (!conflictingId && options.duplicates === 'exclude') { excludedRows.push(row.rowNumber); continue }
    } else seen.set(key, row.rowNumber)
    records.push({ id: `${batchId}:${row.rowNumber}`, sourceRecordId: text('recordId'), source: metadata.source.trim(), company: metadata.company.trim(), batchId, kind: metadata.kind,
      sourceFile: fileName, sourceSheet: table.sheet, sourceRow: row.rowNumber, date: date ?? '', amount: amount ?? 0, currency,
      account: text('account'), description: text('description'), invoice: text('invoice'), contact: text('contact'), category, role: role || 'unknown', tax, department: text('department') })
  }
  if (!records.length) issues.push({ row: 0, field: 'rows', severity: 'error', message: 'No records to import.' })
  return { records, issues, excludedRows }
}
