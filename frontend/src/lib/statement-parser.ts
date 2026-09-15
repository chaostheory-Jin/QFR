import { extractTextItems, getDocumentProxy, type StructuredTextItem } from 'unpdf'
import type { StatementRecord } from './reconciliation'

function parsePrintedAmount(value: string): number | null {
  const compact = value.replace(/[^0-9,.-]/g, '')
  if (!compact) return null
  const europeanDecimal = /,\d{2}$/.test(compact)
  const normalised = europeanDecimal ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '')
  const parsed = Number(normalised)
  return Number.isFinite(parsed) ? parsed : null
}

function statementDescription(rawText: string): string {
  if (/sales\s+invoice/i.test(rawText)) return 'Sales invoice'
  if (/credit\s+note/i.test(rawText)) return 'Credit note'
  if (/payment/i.test(rawText)) return 'Payment'
  if (/rebate/i.test(rawText)) return 'Rebate'
  if (/adjustment/i.test(rawText)) return 'Adjustment'
  return 'Statement line'
}

function recordFromText(
  rawText: string,
  amountText: string,
  accountNumber: string,
  lineIndex: number,
  page: number,
): StatementRecord | null {
  const amount = parsePrintedAmount(amountText)
  if (amount === null) return null

  const identifiers = Array.from(rawText.matchAll(/\b(?:[A-Z]{1,3})?\d{8,}(?:-\d+)?\b/g), (match) => match[0])
    .filter((value, index) => !(index === 0 && value === accountNumber))
  const uniqueIdentifiers = Array.from(new Set(identifiers))
  const invoiceNumber = uniqueIdentifiers[0] ?? `LINE${lineIndex}`
  const date = rawText.match(/\b\d{2}\.\d{2}\.\d{2}\b/)?.[0] ?? ''

  return {
    invoiceNumber,
    invoiceNumberText: invoiceNumber,
    identifiers: uniqueIdentifiers,
    amount,
    amountText,
    date,
    description: statementDescription(rawText),
    rawText,
    lineIndex,
    page,
  }
}

export function parseStatementText(text: string): StatementRecord[] {
  const records: StatementRecord[] = []
  for (const [pageIndex, pageText] of text.split('\f').entries()) {
    const lines = pageText.split(/\r?\n/)
    const starts = lines.flatMap((line, index) => /^\s*\d{8}\s+/.test(line) ? [index] : [])
    for (const [recordIndex, start] of starts.entries()) {
      const end = starts[recordIndex + 1] ?? lines.length
      const mainLine = lines[start]
      const amountMatch = mainLine.match(/(-?(?:\d{1,3}(?: \d{3})+|\d+),\d{2})\s*$/)
      if (!amountMatch) continue

      const groupLines = lines.slice(start, end).map((line) => line.trim()).filter(Boolean)
      const rawText = groupLines.join(' ')
      const accountNumber = mainLine.match(/^\s*(\d{8})\s+/)?.[1] ?? ''
      const record = recordFromText(rawText, amountMatch[1], accountNumber, records.length + 1, pageIndex + 1)
      if (record) records.push(record)
    }
  }
  return records
}

function isStatementLineStart(item: StructuredTextItem): boolean {
  return item.x < 80 && /^\d{8}$/.test(item.str.trim())
}

function inclusiveAmount(items: StructuredTextItem[]): string | null {
  return items
    .filter((item) => item.x >= 740 && /^-?[\d ]+,\d{2}$/.test(item.str.trim()))
    .sort((left, right) => right.x - left.x)[0]?.str.trim() ?? null
}

export async function parseStatementPdf(data: Uint8Array): Promise<StatementRecord[]> {
  const pdf = await getDocumentProxy(data)
  const { items: pages } = await extractTextItems(pdf)
  const records: StatementRecord[] = []

  for (const [pageIndex, pageItems] of pages.entries()) {
    const starts = pageItems.flatMap((item, index) => isStatementLineStart(item) ? [index] : [])
    for (const [recordIndex, start] of starts.entries()) {
      const end = starts[recordIndex + 1] ?? pageItems.length
      const items = pageItems.slice(start, end).filter((item) => item.str.trim())
      const amountText = inclusiveAmount(items)
      if (!amountText) continue

      const accountNumber = items[0]?.str.trim() ?? ''
      const rawText = items.map((item) => item.str.trim()).join(' ')
      const record = recordFromText(rawText, amountText, accountNumber, records.length + 1, pageIndex + 1)
      if (record) records.push(record)
    }
  }

  return records
}

export async function parseStatementFile(file: File): Promise<StatementRecord[]> {
  if (file.type === 'text/plain' || file.type === 'text/csv' || /\.(txt|csv)$/i.test(file.name)) {
    return parseStatementText(await file.text())
  }
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    throw new Error('Master statement must be PDF, CSV or text.')
  }

  try {
    return await parseStatementPdf(new Uint8Array(await file.arrayBuffer()))
  } catch (error) {
    throw new Error(`Unable to read all statement lines${error instanceof Error ? `: ${error.message}` : '.'}`)
  }
}
