import { describe, expect, it } from 'vitest'
import {
  buildQuickBooksBalanceSheet,
  buildQuickBooksCashPeriods,
  QUICKBOOKS_AGING,
  QUICKBOOKS_DATA,
  QUICKBOOKS_REPORT_DATA,
} from './quickbooks-report-data'

describe('downloaded QuickBooks frontend data', () => {
  it('exposes every downloaded P&L detail line', () => {
    expect(QUICKBOOKS_REPORT_DATA.raw_data).toHaveLength(123)
    expect(QUICKBOOKS_REPORT_DATA.meta.report_from).toBe('2026-01-01')
    expect(QUICKBOOKS_REPORT_DATA.meta.report_to).toBe('2026-08-25')
  })

  it('rebuilds the endpoint from opening balances and line movements', () => {
    const data = buildQuickBooksBalanceSheet(
      QUICKBOOKS_DATA.balanceSheet.reportFrom,
      QUICKBOOKS_DATA.balanceSheet.reportTo,
    )

    expect(data.assets.total.current).toBeCloseTo(23436.29, 2)
    expect(data.liabilities.total.current).toBeCloseTo(31131.33, 2)
    expect(data.equity.total.current).toBeCloseTo(-7695.04, 2)
    expect(data.assets.total.current - data.liabilities.total.current).toBeCloseTo(data.equity.total.current, 2)
    const lines = [
      ...data.assets.subsections.flatMap((section) => section.items),
      ...data.liabilities.subsections.flatMap((section) => section.items),
      ...data.equity.items,
    ]
    expect(lines.every((line) => line.confidence === 1 && line.reason)).toBe(true)
  })

  it('provides cash periods and downloaded aging buckets', () => {
    expect(buildQuickBooksCashPeriods()).toHaveLength(8)
    expect(QUICKBOOKS_AGING.receivables.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(5281.52, 2)
    expect(QUICKBOOKS_AGING.payables.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(1602.67, 2)
  })
})
