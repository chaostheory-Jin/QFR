import { describe, expect, it } from 'vitest'
import { categoryEvidence, canonicalReportRows, quickBooksBalanceEvidence } from './financial-lineage'
import { QUICKBOOKS_REPORT_DATA, buildQuickBooksBalanceSheet, QUICKBOOKS_DATA } from './quickbooks-report-data'
import { flattenBalanceLines } from './balance-sheet-review'

describe('report lineage', () => {
  it('category drilldowns add up to exactly the same filtered lines', () => {
    const rows = QUICKBOOKS_REPORT_DATA.raw_data.slice(0, 15)
    const amounts = Array.from(new Set(rows.map(row => row.MappedCategory))).map(category => categoryEvidence(rows, category).amount)
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(categoryEvidence(rows, null).amount, 8)
    const canonical = canonicalReportRows(rows, { source: 'quickbooks', company: 'Mock', currency: 'USD', snapshot: 'snapshot', file: 'original.json' })
    expect(canonical[0]).toMatchObject({ sourceRow: 1, currency: 'USD', sourceFile: 'original.json', batchId: 'snapshot' })
    expect(canonical[0].id).toBe(rows[0].LineID)
  })
  it('QuickBooks account, subtotal and section traces equal unchanged balances', () => {
    const end = QUICKBOOKS_DATA.balanceSheet.reportTo
    const data = buildQuickBooksBalanceSheet(QUICKBOOKS_DATA.balanceSheet.reportFrom, end)
    for (const line of flattenBalanceLines(data)) {
      const contribution = quickBooksBalanceEvidence(line, end).reduce((sum, account) => sum + account.contribution, 0)
      expect(contribution, line.account).toBeCloseTo(line.current, 6)
    }
  })
})
