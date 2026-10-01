import type { BalanceSheetData } from "./balance-sheet-mock"
import type { ReportData } from "./report-data"

export function balanceReviewReport(data: BalanceSheetData, from: string, to: string): ReportData {
  const lines = flattenBalanceLines(data)
  return {
    meta: { report_from: from, report_to: to, balance_sheet_date: to },
    raw_data: lines.map(line => ({
      LineID: line.key, Type: line.kind, InvoiceNumber: line.key, Date: to,
      Contact: data.company, AccountCode: '', AccountName: line.account,
      Description: `${line.section} / ${line.group} / prior=${line.prior}`,
      Amount: line.current, MappedCategory: line.account,
      Confidence: line.confidence ?? 1, Reason: line.reason,
      RuleID: null, OriginalMappedCategory: line.account, NormalizationRule: null,
    })),
    allowed_categories: Array.from(new Set(lines.map(line => line.account))),
    income_categories: [], balance_sheet_data: [], balance_sheet_summary: [], review_threshold: 0.7,
  }
}

export type BalanceLine = {
  key: string
  section: string
  group: string
  kind: string
  account: string
  current: number
  prior: number
  confidence: number | null
  reason: string
}

export function flattenBalanceLines(data: BalanceSheetData): BalanceLine[] {
  const rows: BalanceLine[] = []
  data.assets.subsections.forEach((section) => {
    section.items.forEach((item) => rows.push({
      key: `assets|${section.title}|line|${item.name}`,
      section: 'Assets',
      group: section.title,
      kind: 'Line',
      account: item.name,
      current: item.current,
      prior: item.prior,
      confidence: item.confidence ?? 1,
      reason: item.reason ?? 'Balance-sheet line was sourced directly from the accounting record.',
    }))
    rows.push({
      key: `assets|${section.title}|subtotal|${section.total.name}`,
      section: 'Assets',
      group: section.title,
      kind: 'Subtotal',
      account: section.total.name,
      current: section.total.current,
      prior: section.total.prior,
      confidence: null,
      reason: 'Calculated subtotal.',
    })
  })
  rows.push({
    key: `assets|total|${data.assets.total.name}`,
    section: 'Assets',
    group: 'Assets',
    kind: 'Total',
    account: data.assets.total.name,
    current: data.assets.total.current,
    prior: data.assets.total.prior,
    confidence: null,
    reason: 'Calculated total.',
  })

  data.liabilities.subsections.forEach((section) => {
    section.items.forEach((item) => rows.push({
      key: `liabilities|${section.title}|line|${item.name}`,
      section: 'Liabilities',
      group: section.title,
      kind: 'Line',
      account: item.name,
      current: item.current,
      prior: item.prior,
      confidence: item.confidence ?? 1,
      reason: item.reason ?? 'Balance-sheet line was sourced directly from the accounting record.',
    }))
    rows.push({
      key: `liabilities|${section.title}|subtotal|${section.total.name}`,
      section: 'Liabilities',
      group: section.title,
      kind: 'Subtotal',
      account: section.total.name,
      current: section.total.current,
      prior: section.total.prior,
      confidence: null,
      reason: 'Calculated subtotal.',
    })
  })
  rows.push({
    key: `liabilities|total|${data.liabilities.total.name}`,
    section: 'Liabilities',
    group: 'Liabilities',
    kind: 'Total',
    account: data.liabilities.total.name,
    current: data.liabilities.total.current,
    prior: data.liabilities.total.prior,
    confidence: null,
    reason: 'Calculated total.',
  })
  rows.push({
    key: `net-assets|${data.netAssets.name}`,
    section: 'Net Assets',
    group: 'Net Assets',
    kind: 'Total',
    account: data.netAssets.name,
    current: data.netAssets.current,
    prior: data.netAssets.prior,
    confidence: null,
    reason: 'Calculated as assets less liabilities.',
  })
  data.equity.items.forEach((item) => rows.push({
    key: `equity|line|${item.name}`,
    section: 'Equity',
    group: 'Equity',
    kind: 'Line',
    account: item.name,
    current: item.current,
    prior: item.prior,
    confidence: item.confidence ?? 1,
    reason: item.reason ?? 'Balance-sheet line was sourced directly from the accounting record.',
  }))
  rows.push({
    key: `equity|total|${data.equity.total.name}`,
    section: 'Equity',
    group: 'Equity',
    kind: 'Total',
    account: data.equity.total.name,
    current: data.equity.total.current,
    prior: data.equity.total.prior,
    confidence: null,
    reason: 'Calculated total.',
  })
  return rows
}

