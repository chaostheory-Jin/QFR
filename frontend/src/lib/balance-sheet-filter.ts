import type { BalanceSheetData, BSSection, BSLineItem } from './balance-sheet-mock'

export type BSFilterState = {
  search: string
  showAssets: boolean
  startDate: string
  endDate: string
  showLiabilities: boolean
  showEquity: boolean
  selectedAccounts: Set<string>   // empty = all accounts
}

export function defaultBSFilters(): BSFilterState {
  return {
    search: '',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    showAssets: true,
    showLiabilities: true,
    showEquity: true,
    selectedAccounts: new Set(),
  }
}

// does a line survive the current filters (search + selected accounts)?
function matchesFilters(name: string, f: BSFilterState): boolean {
  if (f.search && !name.toLowerCase().includes(f.search.toLowerCase())) return false
  if (f.selectedAccounts.size > 0 && !f.selectedAccounts.has(name)) return false
  return true
}

// sum a list of items into a fresh total with a given label
function sumItems(name: string, items: BSLineItem[]): BSLineItem {
  return {
    name,
    current: items.reduce((s, it) => s + it.current, 0),
    prior: items.reduce((s, it) => s + it.prior, 0),
  }
}

// filter one section's items, then recompute that section's total
function filterSection(section: BSSection, f: BSFilterState): BSSection | null {
  const items = section.items.filter((it) => matchesFilters(it.name, f))
  if (items.length === 0) return null
  return { ...section, items, total: sumItems(section.total.name, items) }
}

export function allAccountNames(data: BalanceSheetData): string[] {
  const names = [
    ...data.assets.subsections.flatMap((s) => s.items.map((i) => i.name)),
    ...data.liabilities.subsections.flatMap((s) => s.items.map((i) => i.name)),
    ...data.equity.items.map((i) => i.name),
  ]
  return Array.from(new Set(names)).sort()
}

export function filterBalanceSheet(data: BalanceSheetData, f: BSFilterState): BalanceSheetData {
  // ASSETS
  const assetSubs = f.showAssets
    ? data.assets.subsections.map((s) => filterSection(s, f)).filter((s): s is BSSection => s !== null)
    : []
  const assetItems = assetSubs.flatMap((s) => s.items)
  const assetsTotal = sumItems(data.assets.total.name, assetItems)

  // LIABILITIES
  const liabSubs = f.showLiabilities
    ? data.liabilities.subsections.map((s) => filterSection(s, f)).filter((s): s is BSSection => s !== null)
    : []
  const liabItems = liabSubs.flatMap((s) => s.items)
  const liabTotal = sumItems(data.liabilities.total.name, liabItems)

  // EQUITY
  const equityItems = f.showEquity
    ? data.equity.items.filter((it) => matchesFilters(it.name, f))
    : []
  const equityTotal = sumItems(data.equity.total.name, equityItems)

  // NET ASSETS = assets - liabilities (recomputed, stays consistent)
  const netAssets: BSLineItem = {
    name: data.netAssets.name,
    current: assetsTotal.current - liabTotal.current,
    prior: assetsTotal.prior - liabTotal.prior,
  }

  return {
    company: data.company,
    currency: data.currency,
    source: data.source,
    asAt: data.asAt,
    priorPeriod: data.priorPeriod,
    assets: { subsections: assetSubs, total: assetsTotal },
    liabilities: { subsections: liabSubs, total: liabTotal },
    netAssets,
    equity: { items: equityItems, total: equityTotal },
  }
}
