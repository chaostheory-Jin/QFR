import type { BalanceSheetData, BSSection } from './balance-sheet-mock'

// Both adapters expose liabilities in their natural (credit-positive) direction.
export function isCurrentSection(section: BSSection, kind: 'assets' | 'liabilities'): boolean {
  if (section.classification) return section.classification === 'current'
  const title = section.title.trim().toLowerCase()
  return kind === 'assets'
    ? ['bank', 'bank accounts', 'current assets'].includes(title)
    : title === 'current liabilities'
}

export function liquidityMetrics(data: BalanceSheetData) {
  const currentAssets = data.assets.subsections
    .filter(section => isCurrentSection(section, 'assets'))
    .reduce((sum, section) => sum + section.total.current, 0)
  const currentLiabilities = data.liabilities.subsections
    .filter(section => isCurrentSection(section, 'liabilities'))
    .reduce((sum, section) => sum + section.total.current, 0)
  return {
    currentAssets,
    currentLiabilities,
    workingCapital: currentAssets - currentLiabilities,
    currentRatio: currentLiabilities <= 0 ? null : currentAssets / currentLiabilities,
  }
}
