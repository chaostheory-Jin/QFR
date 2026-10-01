import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readSourceTables, importAmount, importDate, suggestColumns, validateImport, type ImportMetadata } from './data-intake'

const metadata: ImportMetadata = { company: 'Mock company', source: 'Mock ledger', currency: 'AUD', kind: 'ledger', sample: true }
const csv = 'Date,Amount,Currency,Account,Description,LineID,Category\n2026-01-01,"1,250.50",AUD,Sales,"Service, delivery",001,Sales\n2026-01-02,0,AUD,Rent,Zero expense,002,Rent\n'
function check(text = csv, duplicates: 'block' | 'exclude' | 'keep' = 'block') {
  const table = readSourceTables(new TextEncoder().encode(text), 'mock.csv')[0]
  return validateImport(table, suggestColumns(table.headers), metadata, 'mock-batch', 'mock.csv', { dateFormat: 'ISO', duplicates }, ['Sales', 'Rent', 'Unmapped'])
}
describe('spreadsheet intake', () => {
  it('reads XLSX dates, numeric amounts, string IDs and multiple worksheets without flattening them', () => {
    // Disposable in-memory software fixture; not a user-facing workbook.
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Date', 'Amount', 'Account', 'Description', 'LineID'], [new Date('2026-01-01T00:00:00Z'), 12.50, 'Rent', 'Mock Excel expense', '0001']]), 'Ledger')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Date', 'Amount', 'Account', 'Description'], ['2026-01-02', 5, 'Bank', 'Mock bank movement']]), 'Bank')
    const tables = readSourceTables(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })), 'mock.xlsx')
    expect(tables.map(table => table.sheet)).toEqual(['Ledger', 'Bank'])
    const result = validateImport(tables[0], suggestColumns(tables[0].headers), metadata, 'mock', 'mock.xlsx', { dateFormat: 'ISO', duplicates: 'block' }, [])
    expect(result.records[0]).toMatchObject({ date: '2026-01-01', amount: 12.5, sourceRecordId: '0001', sourceSheet: 'Ledger' })
    expect(result.issues.filter(issue => issue.severity === 'error')).toHaveLength(0)
  })
  it('rejects cached Excel formula results instead of silently using stale amounts', () => {
    const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([['Date', 'Amount', 'Account', 'Description'], ['2026-01-01', 12, 'Rent', 'Mock formula']])
    sheet.B2 = { t: 'n', v: 12, f: '6+6' }
    XLSX.utils.book_append_sheet(workbook, sheet, 'Ledger')
    const table = readSourceTables(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })), 'formula.xlsx')[0]
    const result = validateImport(table, suggestColumns(table.headers), metadata, 'mock', 'formula.xlsx', { dateFormat: 'ISO', duplicates: 'block' }, [])
    expect(result.issues.some(issue => issue.field === 'amount' && issue.severity === 'error')).toBe(true)
  })
  it('preserves quoted text, source row and leading-zero identifiers; allows zero', () => {
    const result = check()
    expect(result.issues).toEqual([])
    expect(result.records[0]).toMatchObject({ amount: 1250.50, description: 'Service, delivery', sourceRecordId: '001', sourceRow: 2 })
    expect(result.records[1].amount).toBe(0)
  })
  it('strictly validates amounts, not permissive parseFloat', () => {
    for (const value of ['', '100AUD', '1,00', '1.000,50', '$12', 'NaN', 'Infinity', true]) expect(importAmount(value)).toBeNull()
    expect(importAmount('-1,000.50')).toBe(-1000.5)
  })
  it('requires explicit date convention, rejects impossible dates and Excel fake leap day', () => {
    expect(importDate('02/03/2026', 'ISO')).toBeNull()
    expect(importDate('02/03/2026', 'DMY')).toBe('2026-03-02')
    expect(importDate('02/03/2026', 'MDY')).toBe('2026-02-03')
    expect(importDate('2026-02-30', 'ISO')).toBeNull()
    expect(importDate(60, 'ISO')).toBeNull()
  })
  it('reports currency, precision, invalid amount and required-field errors', () => {
    const result = check('Date,Amount,Currency,Account,Description\n2026-02-30,wrong,XYZ,,\n2026-01-01,1.001,AUD,Rent,Expense\n2026-01-01,12,USD,Rent,Expense\n')
    expect(result.issues.filter(issue => issue.severity === 'error').map(issue => issue.field)).toEqual(expect.arrayContaining(['date', 'amount', 'currency', 'account', 'description']))
    expect(result.records).toHaveLength(3) // preview never silently drops bad rows
  })
  it('blocks duplicates by default; explicit exclusion retains row audit; IDs cannot be kept twice', () => {
    const text = 'Date,Amount,Currency,Account,Description,LineID\n2026-01-01,12,AUD,Rent,Expense,id1\n2026-01-01,12,AUD,Rent,Expense,id1\n'
    expect(check(text).issues.some(issue => issue.field === 'duplicate' && issue.severity === 'error')).toBe(true)
    expect(check(text, 'exclude').excludedRows).toEqual([3])
    expect(check(text, 'exclude').records).toHaveLength(1)
    expect(check(text, 'keep').issues.some(issue => issue.field === 'duplicate' && issue.severity === 'error')).toBe(true)
  })
  it('does not exclude conflicting repeated source IDs', () => {
    const result = check('Date,Amount,Account,Description,LineID\n2026-01-01,12,Rent,Expense,id1\n2026-01-01,13,Rent,Expense,id1\n', 'exclude')
    expect(result.excludedRows).toHaveLength(0)
    expect(result.issues.some(issue => issue.message.includes('Conflicting'))).toBe(true)
  })
  it('permits explicitly kept suspected repeats without IDs', () => {
    const result = check('Date,Amount,Account,Description\n2026-01-01,12,Rent,Expense\n2026-01-01,12,Rent,Expense\n', 'keep')
    expect(result.records).toHaveLength(2)
    expect(result.issues.filter(issue => issue.severity === 'error')).toHaveLength(0)
  })
  it('rejects missing/duplicate headers and unsupported file types', () => {
    expect(() => readSourceTables(new TextEncoder().encode('Date,Date\n1,2'), 'mock.csv')).toThrow('unique')
    expect(() => readSourceTables(new TextEncoder().encode('Date,,Amount\n1,2,3'), 'mock.csv')).toThrow('nonempty')
    expect(() => readSourceTables(new Uint8Array([1]), 'file.pdf')).toThrow('CSV')
  })
  it('never infers income from account ID or accepts unknown categories', () => {
    const result = check('Date,Amount,Account,Description,Category\n2026-01-01,112,29,Equipment rent,Illegal\n')
    expect(result.records[0]).toMatchObject({ category: 'Unmapped', role: 'unknown' })
    expect(result.issues[0].severity).toBe('warning')
  })
})
