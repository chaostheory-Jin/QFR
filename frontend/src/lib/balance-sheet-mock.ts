export interface BSLineItem {
  name: string
  current: number
  prior: number
  confidence?: number
  reason?: string
}

export interface BSSection {
  title: string
  items: BSLineItem[]
  total: BSLineItem
}

export interface BalanceSheetData {
  company: string
  currency?: string
  source?: string
  asAt: string
  priorPeriod: string
  assets: {
    subsections: BSSection[]
    total: BSLineItem
  }
  liabilities: {
    subsections: BSSection[]
    total: BSLineItem
  }
  netAssets: BSLineItem
  equity: {
    items: BSLineItem[]
    total: BSLineItem
  }
}

export const BALANCE_SHEET_DATA: BalanceSheetData = {
  company: 'Demo Company (AU)',
  currency: 'AUD',
  source: 'Xero',
  asAt: '31 Dec 2025',
  priorPeriod: '31 Dec 2024',
  assets: {
    subsections: [
      {
        title: 'Bank',
        items: [{ name: 'Business Bank Account', current: 8703.20, prior: 0 }],
        total: { name: 'Total Bank', current: 8703.20, prior: 0 },
      },
    ],
    total: { name: 'Total Assets', current: 8703.20, prior: 0 },
  },
  liabilities: {
    subsections: [
      {
        title: 'Current Liabilities',
        items: [{ name: 'GST', current: -791.20, prior: 0 }],
        total: { name: 'Total Current Liabilities', current: -791.20, prior: 0 },
      },
    ],
    total: { name: 'Total Liabilities', current: -791.20, prior: 0 },
  },
  netAssets: { name: 'Net Assets', current: 7912.00, prior: 0 },
  equity: {
    items: [{ name: 'Retained Earnings', current: 7912.00, prior: 0 }],
    total: { name: 'Total Equity', current: 7912.00, prior: 0 },
  },
}
