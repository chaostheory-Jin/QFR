import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DataTables } from './DataTables'
import { ProfitOverview } from './ProfitOverview'
import { ReportNavigation } from './ReportWorkspace'
import { BalanceTable } from '@/components/balance-sheet/BalanceTable'
import { BalanceMovements } from '@/components/balance-sheet/BalanceMovements'
import { QUICKBOOKS_REPORT_DATA, QUICKBOOKS_DATA, buildQuickBooksBalanceSheet } from '@/lib/quickbooks-report-data'
import { filterBalanceSheet, defaultBSFilters } from '@/lib/balance-sheet-filter'
import { BALANCE_SHEET_DATA } from '@/lib/balance-sheet-mock'

const rows = Array.from({ length: 251 }, (_, i) => ({ ...QUICKBOOKS_REPORT_DATA.raw_data[0], LineID: `test-${i}`, InvoiceNumber: `invoice-${i}`, Confidence: .5 }))
const filters = { startDate: '2026-01-01', endDate: '2026-08-25', search: '', topN: 8, selectedTypes: new Set<string>(), selectedAccounts: new Set<string>(), onlyUnmapped: false, onlyLowConf: false }

describe('report workspace sections', () => {
  it('defaults the shared navigation to Overview with four accessible panels', () => {
    const html = renderToStaticMarkup(<ReportNavigation id="report" value="overview" onChange={vi.fn()} reviewCount={3} />)
    expect(html.match(/role="tab"/g)).toHaveLength(4)
    expect(html).toContain('aria-controls="report-panel-transactions"')
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html).toContain('Report workspace section')
  })
  it('keeps review mounted but hidden from the transaction section and paginates both', () => {
    const html = renderToStaticMarkup(<DataTables active="transactions" resetKey="test" rows={rows} reviewThreshold={.7} categories={['Unmapped']} reviews={{}} onSaveReview={vi.fn()} reviewReady saving={false} />)
    expect(html).toMatch(/id="pl-report-panel-review"[^>]*hidden=""/)
    expect(html).toContain('of 251')
    const transactions = html.split('id="pl-report-panel-transactions"')[1].split('</section>')[0]
    expect(transactions.match(/<tbody[^>]*>[\s\S]*<\/tbody>/)?.[0].match(/<tr /g)).toHaveLength(25)
    expect(transactions).toContain('invoice-24')
    expect(transactions).not.toContain('invoice-25')
    expect(html).toContain('Exports include all filtered rows')
  })
  it('does not show incomplete comparison periods as zero growth', () => {
    const html = renderToStaticMarkup(<ProfitOverview rows={rows.slice(0, 1)} allRows={rows} incomeCategories={QUICKBOOKS_REPORT_DATA.income_categories} filters={filters} coverage={{ report_from: '2026-01-01', report_to: '2026-08-25' }} threshold={.7} currency="USD" />)
    expect(html).toContain('Revenue')
    expect(html).toContain('Net profit / (loss)')
    expect(html).toContain('Comparison unavailable')
    expect(html).not.toContain('Change:')
  })
  it('separates balance review controls from read-only account balances', () => {
    const html = renderToStaticMarkup(<BalanceTable active="review" resetKey="test" data={BALANCE_SHEET_DATA} reviews={{}} onSaveReview={vi.fn()} reviewReady saving={false} movements={<p>Evidence</p>} />)
    expect(html).toMatch(/id="bs-report-panel-transactions"[^>]*hidden=""/)
    const review = html.split('id="bs-report-panel-review"')[1]
    expect(review).not.toMatch(/^[^>]*hidden=""/)
    expect(review).toContain('Save reviews')
    expect(review).toContain('Unconfirmed account balances')
  })
  it('never invents Xero demo transactions', () => {
    const html = renderToStaticMarkup(<BalanceMovements data={BALANCE_SHEET_DATA} source="xero" from="2025-01-01" to="2025-12-31" />)
    expect(html).toContain('no movements have been invented')
    expect(html).not.toContain('<table')
  })
  it('respects hidden balance-sheet sections in the source movement table', () => {
    const from = QUICKBOOKS_DATA.balanceSheet.reportFrom, to = QUICKBOOKS_DATA.balanceSheet.reportTo
    const data = filterBalanceSheet(buildQuickBooksBalanceSheet(from, to), { ...defaultBSFilters(), showAssets: false, showLiabilities: false, showEquity: false })
    const html = renderToStaticMarkup(<BalanceMovements data={data} source="quickbooks" from={from} to={to} />)
    expect(html).toContain('No downloaded movements')
  })
})
