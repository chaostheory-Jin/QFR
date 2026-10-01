import { describe, it, expect } from 'vitest'
import { liquidityMetrics } from './balance-sheet-metrics'
import { buildQuickBooksBalanceSheet, QUICKBOOKS_DATA } from './quickbooks-report-data'
import { buildBalanceSheet, BS_PERIODS } from './balance-sheet-periods'
import { filterBalanceSheet, defaultBSFilters } from './balance-sheet-filter'

describe('financial reporting conventions', () => {
  it('excludes fixed assets and long-term debt from the downloaded current position', () => {
    const data = buildQuickBooksBalanceSheet(QUICKBOOKS_DATA.balanceSheet.reportFrom, QUICKBOOKS_DATA.balanceSheet.reportTo)
    const metrics = liquidityMetrics(data)
    expect(metrics.currentAssets).toBeCloseTo(9941.29, 2)
    expect(metrics.currentLiabilities).toBeCloseTo(6131.33, 2)
    expect(metrics.workingCapital).toBeCloseTo(3809.96, 2)
    expect(metrics.currentRatio).toBeCloseTo(9941.29 / 6131.33, 5)
  })

  it('uses the same credit-positive liability convention for Xero', () => {
    const data = buildBalanceSheet(BS_PERIODS[11], '31 Dec 2024')
    const metrics = liquidityMetrics(data)
    expect(metrics.workingCapital).toBeCloseTo(-8703.2 + 38420 - 26300 - 791.2, 2)
    expect(data.netAssets.current).toBeCloseTo(data.assets.total.current - data.liabilities.total.current, 2)
  })

  it('keeps section classification through filters and does not turn a negative bank balance positive', () => {
    const data = buildBalanceSheet(BS_PERIODS[11], '31 Dec 2024')
    const filtered = filterBalanceSheet(data, { ...defaultBSFilters(), selectedAccounts: new Set(['Business Bank Account']) })
    expect(liquidityMetrics(filtered).currentAssets).toBeCloseTo(-8703.2)
    expect(liquidityMetrics(filtered).currentRatio).toBeNull()
  })
})
