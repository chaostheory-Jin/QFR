'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { REPORT_DATA } from '@/lib/report-data-mock'
import { BALANCE_SHEET_DATA } from '@/lib/balance-sheet-mock'
import { liquidityMetrics } from '@/lib/balance-sheet-metrics'
import { requiresReview } from '@/lib/report-utils'
import type { RawRow } from '@/lib/report-data'
import { PAYROLL_LINES, payrollAssistantContext } from '@/lib/payroll-mock'
import { useReportSource } from '@/lib/report-source'
import { loadPayrollState } from '@/lib/payroll-store'
import { paidAmount, payrollReport, reconciliationStatus } from '@/lib/payroll-ledger'

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
  const { workingCapital, currentRatio } = liquidityMetrics(BALANCE_SHEET_DATA)

  return [
    `Total assets: ${money(assets)}`,
    `Total liabilities: ${money(liabilities)}`,
    `Total equity: ${money(equity)}`,
    `Working capital: ${money(workingCapital)}`,
    `Current ratio: ${currentRatio === null ? 'n/a' : `${currentRatio.toFixed(2)}x`}`,
    '',
    'Initial view:',
    '- Liabilities use the natural credit-positive reporting convention.',
    '- Working capital is current assets minus current liabilities, excluding non-current items.',
  ].join('\n')
}

function localDraft(question: string): string {
  const normalized = question.toLowerCase()

  if (normalized.includes('payroll') || normalized.includes('wages')) return payrollTrend()
  if (normalized.includes('advertising') || normalized.includes('supplier')) return advertisingSuppliers()
  if (normalized.includes('balance') || normalized.includes('liquidity') || normalized.includes('working capital') || normalized.includes('asset') || normalized.includes('liabilit') || normalized.includes('equity')) {
    return balanceSheetDraft()
  }

  const lowConfidence = REPORT_DATA.raw_data.filter((row) => requiresReview(row, REPORT_DATA.review_threshold))
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
  return <div role="status" className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-indigo-900">
    <p className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />Preparing your answer</p>
    <p className="mt-2 text-xs leading-5 text-indigo-700">{THINKING_STEPS.join(' · ')}</p>
  </div>
}

export function FloatingAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const [reportSource] = useReportSource()
  const questionInput = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (open) questionInput.current?.focus() }, [open])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('Ask a P&L or Balance Sheet question to generate an insight.')
  const [status, setStatus] = useState('Ready')
  const [isThinking, setIsThinking] = useState(false)

  const quickQuestions = useMemo(() => {
    if (pathname.includes('payroll')) return ['Summarise the mock payroll and monthly employer cost.', 'Which payroll lines need manual review?', 'Explain gross pay, net pay and super in this mock register.']
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
    setIsThinking(true)
    setStatus('Generating')

    const explicitSource = new URLSearchParams(window.location.search).get('source')
    const isPayroll = pathname.includes('payroll') || (['/profit-loss', '/balance-sheet', '/report-trace'].includes(pathname) && (explicitSource ?? reportSource) === 'payroll')
    setAnswer('Generating answer...')

    try {
      let draft = isPayroll ? payrollAssistantContext() : localDraft(trimmed)
      if (isPayroll) {
        const workflow = await loadPayrollState(), report = payrollReport(workflow, '2026-01-01', '2026-09-30')
        draft += ` Browser workflow snapshot, full Jan–Sep period (not UI filters), integer AUD cents: ${JSON.stringify({ revision: workflow.revision, postedIds: workflow.posted, expenses: report.expense, bank: report.bank, liabilities: report.liabilities, equity: report.equity, balanceDifference: report.balanceDifference, lines: PAYROLL_LINES.map(row => ({ id: row.id, review: workflow.reviews[row.id]?.status ?? 'Pending', posted: workflow.posted.includes(row.id), paid: paidAmount(workflow, row.id), reconciliation: reconciliationStatus(workflow, row) })) })}`
      }
      const response = await fetch('/api/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          localDraft: draft,
          datasetSummary: isPayroll ? draft : datasetSummary(),
          sampleRows: isPayroll ? PAYROLL_LINES : REPORT_DATA.raw_data.slice(0, 120),
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

  return <aside id="financial-assistant" aria-label="AI Financial Assistant" hidden={!open} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
    className="h-full w-full min-w-0 shrink-0 border-l border-slate-200 bg-white xl:w-[360px] 2xl:w-[400px]">
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-3">
        <div><h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-950"><Sparkles className="size-4" />AI Financial Assistant</h2><p className="mt-1 text-xs text-indigo-700">P&L, balance sheet and payroll questions</p></div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close AI panel"><X className="size-4" /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Suggested questions</summary>
          <div className="mt-3 grid gap-2">{quickQuestions.map(quickQuestion => <button key={quickQuestion} type="button" onClick={() => setQuestion(quickQuestion)} disabled={isThinking}
            className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left text-sm text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50">{quickQuestion}</button>)}</div>
        </details>
        <div className="space-y-2"><label htmlFor="assistant-question" className="text-sm font-semibold">Your question</label>
          <textarea ref={questionInput} id="assistant-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about financial results or a payroll question…"
            className="min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-100" />
          <div className="flex flex-wrap items-center justify-between gap-2"><span role="status" className="text-xs text-slate-500">{status}</span><Button onClick={() => void ask()} disabled={isThinking || !question.trim()}><Send className="size-4" />Ask assistant</Button></div>
        </div>
        <p className="text-xs leading-5 text-slate-500">Uses the existing analysis dataset, not necessarily your current page filters. Check source records before acting on an answer.</p>
        {isThinking && <ThinkingState />}
        <section aria-label="Assistant answer" className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Response</h3><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{answer}</p></section>
      </div>
    </div>
  </aside>
}
