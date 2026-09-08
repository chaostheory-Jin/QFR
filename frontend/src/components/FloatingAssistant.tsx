'use client'

import { useMemo, useState } from 'react'
import { Bot, ChevronDown, Loader2, Send, Sparkles, X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { REPORT_DATA } from '@/lib/report-data-mock'
import { BALANCE_SHEET_DATA } from '@/lib/balance-sheet-mock'
import type { RawRow } from '@/lib/report-data'
import { cn } from '@/lib/utils'

const PL_QUESTIONS = [
  'Summarise the top expense categories and any low-confidence mappings.',
  'What changed in payroll throughout 2025?',
  'List advertising suppliers from June 2025 to December 2025.',
]

const BALANCE_SHEET_QUESTIONS = [
  'Assess liquidity and working capital from the balance sheet.',
  'What are the biggest balance sheet risks?',
  'Explain assets, liabilities, and equity movement year on year.',
]

const THINKING_STEPS = ['Reading report data', 'Running local checks', 'Preparing LLM context', 'Drafting insight']

function money(value: number): string {
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

function parseDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function rowsByCategory(category: string): RawRow[] {
  return REPORT_DATA.raw_data.filter((row) => row.MappedCategory === category)
}

function categoryTotals(): [string, number][] {
  const totals = new Map<string, number>()
  REPORT_DATA.raw_data.forEach((row) => {
    const category = row.MappedCategory || 'Unmapped'
    totals.set(category, (totals.get(category) ?? 0) + row.Amount)
  })
  return Array.from(totals.entries()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
}

function payrollTrend(): string {
  const monthly = new Map<string, number>()
  rowsByCategory('Wages and Salaries').forEach((row) => {
    const date = parseDate(row.Date)
    if (!date || date.getFullYear() !== 2025) return
    const month = monthKey(date)
    monthly.set(month, (monthly.get(month) ?? 0) + row.Amount)
  })

  const months = Array.from(monthly.keys()).sort()
  if (!months.length) return 'No payroll rows were found in the mapped P&L data.'

  let text = `Payroll total in 2025: ${money(months.reduce((sum, month) => sum + (monthly.get(month) ?? 0), 0))}\n\n`
  text += 'Monthly movement:\n'
  months.forEach((month, index) => {
    const value = monthly.get(month) ?? 0
    if (index === 0) {
      text += `- ${month}: ${money(value)} (baseline)\n`
      return
    }
    const delta = value - (monthly.get(months[index - 1]) ?? 0)
    text += `- ${month}: ${money(value)} (${delta >= 0 ? '+' : ''}${money(delta)})\n`
  })
  return text
}

function advertisingSuppliers(): string {
  const suppliers = new Set<string>()
  rowsByCategory('Advertising').forEach((row) => {
    const date = parseDate(row.Date)
    if (!date || date < new Date('2025-06-01') || date > new Date('2025-12-31')) return
    if (row.Contact) suppliers.add(row.Contact)
  })
  return `Advertising suppliers from Jun-Dec 2025:\n${suppliers.size ? Array.from(suppliers).map((supplier) => `- ${supplier}`).join('\n') : '- none'}`
}

function balanceSheetDraft(): string {
  const assets = BALANCE_SHEET_DATA.assets.total.current
  const liabilities = BALANCE_SHEET_DATA.liabilities.total.current
  const equity = BALANCE_SHEET_DATA.equity.total.current
  const workingCapital = BALANCE_SHEET_DATA.assets.subsections.reduce((sum, section) => sum + section.total.current, 0)
    + BALANCE_SHEET_DATA.liabilities.subsections.reduce((sum, section) => sum + section.total.current, 0)
  const currentRatio = Math.abs(liabilities) === 0 ? null : Math.abs(assets) / Math.abs(liabilities)

  return [
    `Total assets: ${money(assets)}`,
    `Total liabilities: ${money(liabilities)}`,
    `Total equity: ${money(equity)}`,
    `Working capital: ${money(workingCapital)}`,
    `Current ratio: ${currentRatio === null ? 'n/a' : `${currentRatio.toFixed(2)}x`}`,
    '',
    'Initial view:',
    '- Presentation convention: assets and equity are positive; liabilities are negative.',
    '- Working capital is calculated as current assets plus displayed current liabilities.',
  ].join('\n')
}

function localDraft(question: string): string {
  const normalized = question.toLowerCase()

  if (normalized.includes('payroll') || normalized.includes('wages')) return payrollTrend()
  if (normalized.includes('advertising') || normalized.includes('supplier')) return advertisingSuppliers()
  if (normalized.includes('balance') || normalized.includes('liquidity') || normalized.includes('working capital') || normalized.includes('asset') || normalized.includes('liabilit') || normalized.includes('equity')) {
    return balanceSheetDraft()
  }

  const lowConfidence = REPORT_DATA.raw_data.filter((row) => row.Confidence < REPORT_DATA.review_threshold)
  let text = 'P&L snapshot from mapped report data:\n\nTop category totals:\n'
  categoryTotals().slice(0, 8).forEach(([category, value]) => {
    text += `- ${category}: ${money(value)}\n`
  })
  text += `\nLow-confidence mappings: ${lowConfidence.length}`
  if (lowConfidence.length) {
    text += '\n'
    lowConfidence.slice(0, 5).forEach((row) => {
      text += `- ${row.Contact}: ${row.MappedCategory} (${row.Confidence.toFixed(2)})\n`
    })
  }
  return text
}

function datasetSummary(): string {
  return [
    `P&L rows: ${REPORT_DATA.raw_data.length}`,
    `P&L period: ${REPORT_DATA.meta.report_from} to ${REPORT_DATA.meta.report_to}`,
    `Balance sheet company: ${BALANCE_SHEET_DATA.company}`,
    `Balance sheet date: ${BALANCE_SHEET_DATA.asAt}`,
    `Assets: ${money(BALANCE_SHEET_DATA.assets.total.current)}`,
    `Liabilities: ${money(BALANCE_SHEET_DATA.liabilities.total.current)}`,
    `Equity: ${money(BALANCE_SHEET_DATA.equity.total.current)}`,
  ].join('\n')
}

function ThinkingState() {
  return (
    <div className="relative overflow-hidden rounded-lg bg-slate-950 p-3 text-slate-100">
      <div className="absolute inset-0 opacity-60">
        {[10, 24, 38, 52, 70, 84].map((left, index) => (
          <span
            key={left}
            className="absolute size-1.5 animate-bounce rounded-full bg-cyan-300"
            style={{ left: `${left}%`, top: `${22 + (index % 3) * 22}%`, animationDelay: `${index * 120}ms` }}
          />
        ))}
      </div>
      <div className="relative flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-cyan-300" />
        AI is thinking
      </div>
      <div className="relative mt-3 grid gap-1.5 text-xs text-slate-300">
        {THINKING_STEPS.map((step) => (
          <div key={step} className="flex items-center gap-2">
            <span className="size-1 rounded-full bg-cyan-300" />
            {step}
          </div>
        ))}
      </div>
    </div>
  )
}

export function FloatingAssistant() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('Ask a P&L or Balance Sheet question to generate an insight.')
  const [status, setStatus] = useState('Ready')
  const [isThinking, setIsThinking] = useState(false)

  const quickQuestions = useMemo(() => {
    if (pathname.includes('balance-sheet')) return BALANCE_SHEET_QUESTIONS
    if (pathname.includes('profit-loss')) return PL_QUESTIONS
    return [...PL_QUESTIONS.slice(0, 2), ...BALANCE_SHEET_QUESTIONS.slice(0, 2)]
  }, [pathname])

  async function ask(nextQuestion = question) {
    const trimmed = nextQuestion.trim()
    if (!trimmed) {
      setStatus('Enter a question first')
      return
    }

    setQuestion(trimmed)
    setIsOpen(true)
    setIsThinking(true)
    setStatus('Generating')

    const draft = localDraft(trimmed)
    setAnswer('Generating answer...')

    try {
      const response = await fetch('/api/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          localDraft: draft,
          datasetSummary: datasetSummary(),
          sampleRows: REPORT_DATA.raw_data.slice(0, 120),
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || `LLM request failed with ${response.status}`)
      }

      const payload = (await response.json()) as { answer?: string }
      setAnswer(payload.answer || 'No answer was returned.')
      setStatus('Done')
    } catch (error) {
      setAnswer(`AI response unavailable. ${error instanceof Error ? error.message : String(error)}`)
      setStatus('AI unavailable')
    } finally {
      setIsThinking(false)
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {isOpen && (
        <Card className="mb-3 w-[min(420px,calc(100vw-2.5rem))] overflow-hidden border-blue-200 shadow-2xl">
          <CardHeader className="border-b bg-gradient-to-r from-blue-700 to-slate-900 px-4 py-3 text-white">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="size-4" />
                AI Financial Assistant
              </CardTitle>
              <button type="button" onClick={() => setIsOpen(false)} className="rounded p-1 hover:bg-white/10" aria-label="Close assistant">
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs text-blue-100">Available across P&L and Balance Sheet pages.</p>
          </CardHeader>
          <CardContent className="flex max-h-[70vh] flex-col gap-3 overflow-auto p-4">
            <div className="grid gap-2">
              {quickQuestions.map((quickQuestion) => (
                <button
                  key={quickQuestion}
                  type="button"
                  onClick={() => void ask(quickQuestion)}
                  disabled={isThinking}
                  className="rounded-lg border bg-blue-50 px-3 py-2 text-left text-xs text-blue-950 transition-colors hover:border-blue-300 hover:bg-blue-100 disabled:opacity-60"
                >
                  {quickQuestion}
                </button>
              ))}
            </div>

            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about P&L, Balance Sheet, liquidity, suppliers..."
              className="min-h-20 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{status}</span>
              <Button size="sm" onClick={() => void ask()} disabled={isThinking} className="bg-blue-700 text-white hover:bg-blue-600">
                <Send className="size-3.5" />
                Ask
              </Button>
            </div>

            {isThinking && <ThinkingState />}

            <pre className="max-h-72 whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 font-sans text-sm leading-relaxed text-slate-900 shadow-inner">
              {answer}
            </pre>
          </CardContent>
        </Card>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full bg-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-xl transition-colors hover:bg-blue-600"
      >
        <Bot className="size-5" />
        AI Assistant
        <ChevronDown className={cn('size-4 transition-transform', !isOpen && 'rotate-180')} />
      </button>
    </div>
  )
}
