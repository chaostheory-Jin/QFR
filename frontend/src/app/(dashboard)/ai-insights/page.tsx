'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, BarChart3, Check, FileText, Loader2, Scale, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const TRANSACTIONS = [
  { contact: 'Westfield Corp',            amount: 18000, category: 'Sales',                   income: true  },
  { contact: 'ADP Payroll Services',       amount: 12500, category: 'Wages & Salaries',        income: false },
  { contact: 'Apex Solutions Ltd',         amount: 22000, category: 'Sales',                   income: true  },
  { contact: 'Metro Office Supplies',      amount: 4000,  category: 'Office Expenses',         income: false },
  { contact: 'Maddox Publishing Group',    amount: 11700, category: 'Sales',                   income: true  },
  { contact: 'Commercial Property Group',  amount: 3500,  category: 'Rent',                    income: false },
  { contact: 'Blue Mountain Consulting',   amount: 25000, category: 'Sales',                   income: true  },
  { contact: 'TechStream Pty Ltd',         amount: 490,   category: 'Subscriptions',           income: false },
  { contact: 'Pacific Trade Partners',     amount: 26500, category: 'Sales',                   income: true  },
  { contact: 'Digital Marketing Agency',   amount: 1500,  category: 'Advertising',             income: false },
  { contact: 'Apex Solutions Ltd',         amount: 28000, category: 'Sales',                   income: true  },
  { contact: 'Peak Advisory Services',     amount: 2400,  category: 'Consulting & Accounting', income: false },
  { contact: 'Northern Logistics',         amount: 7800,  category: 'Sales',                   income: true  },
  { contact: 'Harrington & Associates',    amount: 13600, category: 'Sales',                   income: true  },
]


type ReportTarget = 'profit-loss' | 'balance-sheet'
const REPORTS = {
  'profit-loss': { title: 'Profit & Loss', description: 'Revenue, expenses and net profit over a reporting period.', icon: BarChart3, href: '/profit-loss' },
  'balance-sheet': { title: 'Balance Sheet', description: 'Assets, liabilities and equity at a reporting date.', icon: Scale, href: '/balance-sheet' },
}
const STEPS = ['Read sample records', 'Classify transactions', 'Prepare report view']
const money = (value: number) => value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })

export default function AIInsightsPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<ReportTarget>('profit-loss')
  const [running, setRunning] = useState(false)
  const [processed, setProcessed] = useState(0)
  const done = processed === TRANSACTIONS.length

  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => {
      if (done) router.push(REPORTS[selected].href)
      else setProcessed(count => Math.min(count + 2, TRANSACTIONS.length))
    }, done ? 800 : 1000)
    return () => window.clearTimeout(timer)
  }, [running, processed, done, selected, router])

  const progress = Math.round(processed / TRANSACTIONS.length * 100)
  const step = done ? 3 : Math.min(2, Math.floor(progress / 34))
  const transaction = TRANSACTIONS[Math.min(processed, TRANSACTIONS.length - 1)]
  const completed = TRANSACTIONS.slice(0, processed)
  const revenue = completed.filter(row => row.income).reduce((sum, row) => sum + row.amount, 0)
  const expenses = completed.filter(row => !row.income).reduce((sum, row) => sum + row.amount, 0)

  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-700">Workspace / Report preparation</p><h1 className="mt-2 text-2xl font-bold tracking-tight">AI Insights</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Choose a report, preview the analysis workflow, then explore the results and supporting records.</p></div>
      <span className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700"><Sparkles className="size-3.5" />Demo workflow</span>
    </header>

    {!running ? <section aria-label="Report preparation" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5"><h2 className="text-lg font-semibold">Choose your report</h2><p className="mt-1 text-sm text-slate-500">One report at a time. You can open either report directly from the sidebar.</p></div>
      <fieldset className="grid gap-4 md:grid-cols-2"><legend className="sr-only">Report type</legend>
        {(Object.entries(REPORTS) as [ReportTarget, typeof REPORTS[ReportTarget]][]).map(([key, report]) => {
          const Icon = report.icon
          return <label key={key} className={cn('relative flex cursor-pointer items-start gap-4 rounded-xl border-2 p-5 transition focus-within:ring-2 focus-within:ring-indigo-500', selected === key ? 'border-indigo-600 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-indigo-300')}>
            <input type="radio" name="report-type" value={key} checked={selected === key} onChange={() => setSelected(key)} className="sr-only" />
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-white text-indigo-700"><Icon className="size-5" /></span>
            <span className="min-w-0 flex-1"><span className="block font-semibold">{report.title}</span><span className="mt-2 block text-sm leading-6 text-slate-500">{report.description}</span></span>
            <span aria-hidden="true" className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border', selected === key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300')}>{selected === key && <Check className="size-3.5" />}</span>
          </label>
        })}
      </fieldset>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5">
        <p className="max-w-xl text-xs leading-5 text-slate-500">This animation uses sample transactions. It does not sync a live account or rerun AI analysis. The report opens with your selected data source.</p>
        <Button onClick={() => { setProcessed(0); setRunning(true) }}><Sparkles className="size-4" />Preview {REPORTS[selected].title}<ArrowRight className="size-4" /></Button>
      </div>
    </section> : <section aria-label="Report preparation progress" className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{REPORTS[selected].title}</h2><p role="status" className="mt-1 text-sm text-slate-500">{done ? 'Preview complete — opening report…' : STEPS[step]}</p></div><Button variant="outline" onClick={() => { setRunning(false); setProcessed(0) }}>Back to report selection</Button></div>
        <div className="mt-5 flex justify-between text-xs font-medium text-slate-500"><span>{processed} / {TRANSACTIONS.length} sample records</span><span>{progress}%</span></div>
        <div role="progressbar" aria-label="Sample analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-2 h-2 overflow-hidden rounded-full bg-indigo-50"><div className="h-full rounded-full bg-indigo-600 transition-[width] duration-500" style={{ width: progress + '%' }} /></div>
        <ol className="mt-5 grid gap-2 sm:grid-cols-3">{STEPS.map((label, index) => <li key={label} className={cn('flex items-center gap-2 rounded-lg px-3 py-3 text-xs font-medium', index === step ? 'bg-indigo-50 text-indigo-800' : 'text-slate-500')}><span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', index < step ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100')}>{index < step ? <Check className="size-3.5" /> : index + 1}</span>{label}</li>)}</ol>
      </div>
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><FileText className="size-4" />Sample record</p><p className="mt-5 font-semibold">{transaction.contact}</p><p className="mt-2 text-2xl font-bold tabular-nums">{money(transaction.amount)}</p><p className="mt-3 text-sm text-slate-500">{transaction.category}</p></div>
        <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><span className="flex size-16 items-center justify-center rounded-2xl bg-white text-indigo-700 shadow-sm">{done ? <Check className="size-7" /> : <Loader2 className="size-7 animate-spin motion-reduce:animate-none" />}</span><p className="mt-4 font-semibold text-indigo-900">{done ? 'Report preview ready' : 'Processing sample evidence'}</p><p className="mt-2 text-center text-xs leading-5 text-indigo-700">Read → classify → prepare</p></div>
        <div className="rounded-2xl border bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sample totals · AUD</p><dl className="mt-5 space-y-4"><div><dt className="text-xs text-slate-500">Revenue</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(revenue)}</dd></div><div><dt className="text-xs text-slate-500">Expenses</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(expenses)}</dd></div></dl></div>
      </div>
      <p className="text-xs leading-5 text-slate-500">Illustrative workflow only. Sample totals are not your connected company&apos;s report totals.</p>
    </section>}
  </main>
}
