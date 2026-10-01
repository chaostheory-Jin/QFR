'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check,
  CheckCircle2,
  Cloud,
  Database,
  FileUp,
  Loader2,
  LockKeyhole,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CONNECTION_STEPS,
  connectionProgress,
  type DataSource,
} from '@/lib/link-data'
import { cn } from '@/lib/utils'
import { setStoredDataSource } from '@/lib/report-source'

type LinkPhase = 'idle' | 'loading' | 'success'

const SOURCE_META: Record<DataSource, {
  name: string
  description: string
  icon: typeof Cloud
  iconClass: string
  buttonClass: string
}> = {
  xero: {
    name: 'Xero',
    description: 'Connect an organisation and prepare its accounting records for QFR mapping.',
    icon: Cloud,
    iconClass: 'bg-blue-50 text-blue-700 ring-blue-100',
    buttonClass: 'bg-blue-700 text-white hover:bg-blue-600',
  },
  quickbooks: {
    name: 'QuickBooks',
    description: 'Connect a QuickBooks Online company and load P&L and Balance Sheet evidence.',
    icon: Database,
    iconClass: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    buttonClass: 'bg-emerald-700 text-white hover:bg-emerald-600',
  },
}

export default function LinkDataPage() {
  const router = useRouter()
  const [source, setSource] = useState<DataSource | null>(null)
  const [phase, setPhase] = useState<LinkPhase>('idle')
  const [completedSteps, setCompletedSteps] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const redirectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const steps = source ? CONNECTION_STEPS[source] : []
  const progress = connectionProgress(completedSteps, steps.length)
  const activeStepIndex = Math.min(completedSteps, Math.max(steps.length - 1, 0))

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (redirectRef.current) clearTimeout(redirectRef.current)
    }
  }, [])

  function startConnection(nextSource: DataSource) {
    if (phase === 'loading') return
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (redirectRef.current) clearTimeout(redirectRef.current)

    const nextSteps = CONNECTION_STEPS[nextSource]
    setStoredDataSource(nextSource)
    setSource(nextSource)
    setCompletedSteps(0)
    setPhase('loading')

    let completed = 0
    intervalRef.current = setInterval(() => {
      completed += 1
      setCompletedSteps(completed)
      if (completed >= nextSteps.length) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
        setPhase('success')
        redirectRef.current = setTimeout(() => {
          router.push('/ai-insights')
        }, 1200)
      }
    }, 430)
  }

  const statusText = useMemo(() => {
    if (!source) return 'Choose a source to begin'
    if (phase === 'success') return `${SOURCE_META[source].name} data successfully loaded`
    return `Loading ${SOURCE_META[source].name} data`
  }, [phase, source])

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
          <Database className="size-5" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">Data connections</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Link to Data</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Choose an accounting source. QFR will load the records needed for mapping, reconciliation and financial insights.
        </p>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {(Object.keys(SOURCE_META) as DataSource[]).map((dataSource) => {
          const meta = SOURCE_META[dataSource]
          const Icon = meta.icon
          const isActive = source === dataSource && phase !== 'idle'
          return (
            <Card
              key={dataSource}
              className={cn(
                'relative overflow-hidden transition-all',
                isActive && 'border-blue-300 shadow-lg ring-2 ring-blue-100',
              )}
            >
              <CardHeader>
                <div className={cn('mb-3 flex size-11 items-center justify-center rounded-xl ring-1', meta.iconClass)}>
                  <Icon className="size-5" />
                </div>
                <CardTitle>{meta.name}</CardTitle>
                <CardDescription className="min-h-12 leading-5">{meta.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <LockKeyhole className="size-3.5" />
                  Read-only connection
                </div>
                <Button
                  type="button"
                  className={cn('w-full', meta.buttonClass)}
                  disabled={phase === 'loading'}
                  onClick={() => startConnection(dataSource)}
                >
                  {source === dataSource && phase === 'loading' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Link to {meta.name}
                </Button>
              </CardContent>
            </Card>
          )
        })}

        <Card className="border-dashed bg-slate-50/70">
          <CardHeader>
            <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500 ring-1 ring-slate-200">
              <FileUp className="size-5" />
            </div>
            <CardTitle>Upload file</CardTitle>
            <CardDescription className="min-h-12 leading-5">
              Upload a spreadsheet or accounting export for one-off analysis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 text-xs text-muted-foreground">Excel and CSV support</div>
            <Button type="button" variant="outline" className="w-full" onClick={() => router.push('/imports')}>
              Upload CSV / Excel
            </Button>
          </CardContent>
        </Card>
      </div>

      {source && phase !== 'idle' && (
        <Card className="mx-auto mt-6 max-w-4xl overflow-hidden">
          <CardHeader className="border-b bg-slate-50/80">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  {phase === 'success' ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : (
                    <Loader2 className="size-5 animate-spin text-blue-700" />
                  )}
                  {statusText}
                </CardTitle>
                <CardDescription className="mt-1">
                  {phase === 'success'
                    ? 'Opening AI Insights…'
                    : `${completedSteps} of ${steps.length} steps complete`}
                </CardDescription>
              </div>
              <span className="text-sm font-semibold tabular-nums text-slate-700">{progress}%</span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-label={`${SOURCE_META[source].name} data loading progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-300',
                  phase === 'success' ? 'bg-emerald-500' : 'bg-blue-700',
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[360px] overflow-auto p-4">
              <ol className="grid gap-2 sm:grid-cols-2">
                {steps.map((step, index) => {
                  const isComplete = index < completedSteps
                  const isCurrent = phase === 'loading' && index === activeStepIndex
                  return (
                    <li
                      key={step.label}
                      className={cn(
                        'flex gap-3 rounded-xl border px-3 py-3 transition-colors',
                        isComplete && 'border-emerald-100 bg-emerald-50/70',
                        isCurrent && 'border-blue-200 bg-blue-50',
                        !isComplete && !isCurrent && 'border-slate-100 bg-white text-slate-400',
                      )}
                    >
                      <span className={cn(
                        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                        isComplete && 'border-emerald-500 bg-emerald-500 text-white',
                        isCurrent && 'border-blue-700 text-blue-700',
                      )}>
                        {isComplete ? <Check className="size-3" /> : isCurrent ? <Loader2 className="size-3 animate-spin" /> : index + 1}
                      </span>
                      <span>
                        <span className={cn('block text-sm font-medium', (isComplete || isCurrent) && 'text-slate-900')}>
                          {step.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{step.detail}</span>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
