import generatedData from './quickbooks-report-data.generated.json'
import type { ReportData } from './report-data'
import type { BalanceSheetData, BSLineItem, BSSection } from './balance-sheet-mock'

type QuickBooksAccount = {
  key: string
  section: 'Assets' | 'Liabilities' | 'Equity'
  category: string
  name: string
  opening: number
  confidence?: number
  reason?: string
}

type QuickBooksMovement = {
  date: string
  key: string
  amount: number
}

type QuickBooksGeneratedData = {
  source: { name: string; company: string; currency: string }
  profitLoss: ReportData
  balanceSheet: {
    openingDate: string
    reportFrom: string
    reportTo: string
    accounts: QuickBooksAccount[]
    movements: QuickBooksMovement[]
    aging: {
      asAt: string
      receivables: [number, number, number, number]
      payables: [number, number, number, number]
    }
  }
}

export const QUICKBOOKS_DATA = generatedData as unknown as QuickBooksGeneratedData
export const QUICKBOOKS_REPORT_DATA = QUICKBOOKS_DATA.profitLoss
export const QUICKBOOKS_AGING = QUICKBOOKS_DATA.balanceSheet.aging

function displayDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function dateBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function balanceAt(account: QuickBooksAccount, throughDate: string): number {
  return account.opening + QUICKBOOKS_DATA.balanceSheet.movements
    .filter((movement) => movement.key === account.key && movement.date <= throughDate)
    .reduce((sum, movement) => sum + movement.amount, 0)
}

function subsectionName(account: QuickBooksAccount): string {
  const path = account.category.split(' > ')
  return path.length >= 3 ? path[1] : account.section
}

function makeSections(accounts: QuickBooksAccount[], currentDate: string, priorDate: string): BSSection[] {
  const groups = new Map<string, BSLineItem[]>()
  for (const account of accounts) {
    const group = subsectionName(account)
    const items = groups.get(group) ?? []
    items.push({
      name: account.name,
      current: balanceAt(account, currentDate),
      prior: balanceAt(account, priorDate),
      confidence: account.confidence ?? 1,
      reason: account.reason ?? 'QuickBooks account ID and line movements reconcile to the official balance-sheet endpoint.',
    })
    groups.set(group, items)
  }

  return Array.from(groups, ([title, items]) => ({
    title,
    items,
    total: {
      name: `Total ${title}`,
      current: items.reduce((sum, item) => sum + item.current, 0),
      prior: items.reduce((sum, item) => sum + item.prior, 0),
    },
  }))
}

function sumSections(name: string, sections: BSSection[]): BSLineItem {
  return {
    name,
    current: sections.reduce((sum, section) => sum + section.total.current, 0),
    prior: sections.reduce((sum, section) => sum + section.total.prior, 0),
  }
}

export function buildQuickBooksBalanceSheet(startDate: string, endDate: string): BalanceSheetData {
  const priorDate = dateBefore(startDate)
  const accounts = QUICKBOOKS_DATA.balanceSheet.accounts
  const assetSections = makeSections(accounts.filter((account) => account.section === 'Assets'), endDate, priorDate)
  const liabilitySections = makeSections(accounts.filter((account) => account.section === 'Liabilities'), endDate, priorDate)
  const equityItems = accounts
    .filter((account) => account.section === 'Equity')
    .map((account) => ({
      name: account.name,
      current: balanceAt(account, endDate),
      prior: balanceAt(account, priorDate),
      confidence: account.confidence ?? 1,
      reason: account.reason ?? 'QuickBooks account ID and line movements reconcile to the official balance-sheet endpoint.',
    }))
  const assets = sumSections('Total Assets', assetSections)
  const liabilities = sumSections('Total Liabilities', liabilitySections)
  const equity: BSLineItem = {
    name: 'Total Equity',
    current: equityItems.reduce((sum, item) => sum + item.current, 0),
    prior: equityItems.reduce((sum, item) => sum + item.prior, 0),
  }

  return {
    company: QUICKBOOKS_DATA.source.company,
    currency: QUICKBOOKS_DATA.source.currency,
    source: QUICKBOOKS_DATA.source.name,
    asAt: displayDate(endDate),
    priorPeriod: displayDate(priorDate),
    assets: { subsections: assetSections, total: assets },
    liabilities: { subsections: liabilitySections, total: liabilities },
    netAssets: {
      name: 'Net Assets',
      current: assets.current - liabilities.current,
      prior: assets.prior - liabilities.prior,
    },
    equity: { items: equityItems, total: equity },
  }
}

export type CashPeriod = { key: string; label: string; bank: number }

function endOfMonth(isoMonth: string, finalDate: string): string {
  const [year, month] = isoMonth.split('-').map(Number)
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  return monthEnd > finalDate ? finalDate : monthEnd
}

export function buildQuickBooksCashPeriods(): CashPeriod[] {
  const { reportFrom, reportTo, accounts } = QUICKBOOKS_DATA.balanceSheet
  const bankAccounts = accounts.filter((account) => account.category.includes('Bank Accounts'))
  const periods: CashPeriod[] = []
  let cursor = reportFrom.slice(0, 7)
  const finalMonth = reportTo.slice(0, 7)

  while (cursor <= finalMonth) {
    const throughDate = endOfMonth(cursor, reportTo)
    periods.push({
      key: cursor,
      label: displayDate(throughDate),
      bank: bankAccounts.reduce((sum, account) => sum + balanceAt(account, throughDate), 0),
    })
    const [year, month] = cursor.split('-').map(Number)
    const next = new Date(Date.UTC(year, month, 1))
    cursor = next.toISOString().slice(0, 7)
  }
  return periods
}
