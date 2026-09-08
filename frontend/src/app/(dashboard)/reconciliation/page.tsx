'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileImage,
  FileSearch,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  RECONCILIATION_METHOD_LABELS,
  reconcileInvoices,
  statementIdentifiers,
  type BoundingBox,
  type InvoiceExtraction,
  type ReconciliationMatch,
  type StatementRecord,
} from '@/lib/reconciliation'
import { cn } from '@/lib/utils'

type Phase = 'idle' | 'extracting' | 'matching' | 'complete' | 'error'

const PROCESSING_STEPS = [
  { at: 0, label: 'Validate files', detail: 'Checking formats, sizes and document order.' },
  { at: 12, label: 'Read master statement', detail: 'Finding candidate Sales invoice rows and inclusive amounts.' },
  { at: 28, label: 'Locate invoice ID', detail: 'Reading the printed identifier and its exact position.' },
  { at: 44, label: 'Verify final gross amount', detail: 'Rejecting net, VAT, line-item and handwritten amounts.' },
  { at: 62, label: 'Normalise unclear characters', detail: 'Testing OCR confusions such as O/0, I/1 and S/5.' },
  { at: 76, label: 'Match ID and amount', detail: 'Applying exact, unique-amount and guarded fuzzy rules.' },
  { at: 88, label: 'Check one-to-one assignment', detail: 'Preventing two invoices from consuming the same statement row.' },
  { at: 97, label: 'Write audit result', detail: 'Recording confidence, evidence and review reasons.' },
]

const VERIFIED_FIELDS = {
  invoiceNumberVerified: true,
  totalAmountVerified: true,
  arithmeticVerified: true,
  reason: 'Printed invoice ID, final gross label, amount and arithmetic verified.',
}

const DEMO_STATEMENT: StatementRecord[] = [
  { invoiceNumber: 'DI1000045981', identifiers: ['DI1000045981'], amount: 25108709, date: '12.12.24', description: 'Sales invoice', lineIndex: 1, page: 1 },
  { invoiceNumber: 'I1000064240', identifiers: ['I1000064240'], amount: 25108709, date: '12.12.24', description: 'Sales invoice', lineIndex: 2, page: 1 },
  { invoiceNumber: 'DI1000000165', identifiers: ['DI1000000165'], amount: 29004637, date: '06.03.24', description: 'Sales invoice', lineIndex: 3, page: 1 },
  { invoiceNumber: 'DI1000000431', identifiers: ['DI1000000431'], amount: 29784748, date: '06.03.24', description: 'Credit note', lineIndex: 4, page: 1 },
  { invoiceNumber: 'DI1000000242', identifiers: ['DI1000000242'], amount: 17864512, date: '06.03.24', description: 'Payment', lineIndex: 5, page: 1 },
]

const DEMO_INVOICES: InvoiceExtraction[] = [
  {
    documentIndex: 0,
    fileName: '20260805113702_003.jpg',
    invoiceNumber: 'DI1000045981',
    totalAmount: 25108709,
    invoiceNumberText: 'DI1000045981',
    totalAmountText: '25 108 709,00',
    totalAmountLabel: 'Gross Amount Payable',
    netAmount: 21278567,
    taxAmount: 3830142,
    invoiceNumberBox: [690, 130, 948, 205],
    totalAmountBox: [650, 780, 945, 872],
    fieldVerification: VERIFIED_FIELDS,
  },
  {
    documentIndex: 1,
    fileName: '20260805113702_004.jpg',
    invoiceNumber: 'I100006424O',
    totalAmount: 25108709,
    invoiceNumberText: 'I100006424O',
    totalAmountText: '25 108 709,00',
    totalAmountLabel: 'Gross Amount Payable',
    netAmount: 21278567,
    taxAmount: 3830142,
    invoiceNumberBox: [690, 130, 948, 205],
    totalAmountBox: [650, 780, 945, 872],
    fieldVerification: VERIFIED_FIELDS,
  },
  {
    documentIndex: 2,
    fileName: '20260805114055_001.jpg',
    invoiceNumber: 'DI1000000165',
    totalAmount: 29004637,
    invoiceNumberText: 'DI1000000165',
    totalAmountText: '29 004 637,00',
    totalAmountLabel: 'Gross Amount Payable',
    netAmount: null,
    taxAmount: null,
    invoiceNumberBox: [690, 130, 948, 205],
    totalAmountBox: [650, 780, 945, 872],
    fieldVerification: { ...VERIFIED_FIELDS, arithmeticVerified: false, reason: 'Printed invoice ID, final gross label and amount verified; arithmetic not available.' },
  },
]

function money(value: number): string {
  return new Intl.NumberFormat('en-UG', {
    style: 'currency', currency: 'UGX', maximumFractionDigits: 0,
  }).format(value)
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function statementRecordKey(record: StatementRecord): string {
  return record.lineIndex ? `line-${record.lineIndex}` : `${record.invoiceNumber}-${record.amount}`
}

function UploadPanel({
  title,
  description,
  accept,
  multiple,
  files,
  onFiles,
}: {
  title: string
  description: string
  accept: string
  multiple?: boolean
  files: File[]
  onFiles: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        onFiles(Array.from(event.dataTransfer.files))
      }}
      className={cn(
        'w-full rounded-xl border border-dashed px-4 py-3 text-left transition-colors',
        dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50/70 hover:border-blue-300 hover:bg-blue-50/50',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(event) => onFiles(Array.from(event.target.files ?? []))}
      />
      <span className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm ring-1 ring-slate-200">
          <UploadCloud className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {files.length ? files.map((file) => file.name).join(', ') : description}
          </span>
        </span>
      </span>
    </button>
  )
}

function HighlightBox({ box, label }: { box: BoundingBox; label: string }) {
  if (box.every((coordinate) => coordinate === 0)) return null
  const [x1, y1, x2, y2] = box
  return (
    <div
      className="absolute rounded-md border-2 border-emerald-500 bg-emerald-300/15 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
      style={{ left: `${x1 / 10}%`, top: `${y1 / 10}%`, width: `${(x2 - x1) / 10}%`, height: `${(y2 - y1) / 10}%` }}
    >
      <span className="pointer-events-none absolute bottom-full right-0 mb-1 whitespace-nowrap rounded bg-emerald-600 px-1.5 py-1 text-[9px] font-semibold leading-none uppercase tracking-wide text-white shadow-sm">
        <Check className="mr-1 inline size-2.5" />{label}
      </span>
    </div>
  )
}

function DemoInvoice({ scanning, extraction }: { scanning: boolean; extraction: InvoiceExtraction }) {
  return (
    <div className="relative mx-auto aspect-[0.77] w-full max-w-[390px] overflow-hidden rounded-md border bg-[#fffefa] p-5 shadow-inner">
      <div className="flex items-start justify-between border-b-2 border-red-600 pb-3">
        <div>
          <p className="text-lg font-black italic text-red-600">Coca-Cola</p>
          <p className="text-[9px] font-semibold uppercase tracking-widest">Beverages Uganda Limited</p>
        </div>
        <p className="text-right text-base font-black">TAX INVOICE</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-[9px] text-slate-600">
        <div className="rounded border p-2"><b className="block text-slate-900">Sold to</b>UTUKUFU LTD — SEMUTO<br />Central, Uganda</div>
        <div className="rounded border p-2"><b className="block text-slate-900">Delivered to</b>UTUKUFU LTD — SEMUTO<br />Cash on Delivery</div>
      </div>
      <div className="mt-3 grid grid-cols-3 border-y py-2 text-[9px]">
        <span>Date<br /><b>12/12/2024</b></span>
        <span>Outlet No.<br /><b>12028700</b></span>
        <span className="text-right">Invoice No.<br />
          <b className={cn('relative inline-block rounded px-1', !scanning && 'border-2 border-emerald-500 bg-emerald-50 text-emerald-800 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]')}>
            {extraction.invoiceNumber}
            {!scanning && <span className="absolute -top-5 right-0 whitespace-nowrap rounded bg-emerald-600 px-1 py-0.5 text-[7px] uppercase tracking-wide text-white">ID verified</span>}
          </b>
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {['FANTA ORANGE 01X06 2000ML PET', 'COKE 330ML 12 S/W', 'MINUTE MAID MANGO 1L', 'POWER PLAY 350ML'].map((item, index) => (
          <div key={item} className="grid grid-cols-[1fr_42px_64px] border-b border-dotted pb-1 text-[8px] text-slate-500">
            <span>{item}</span><span>{[160, 768, 180, 192][index]}</span><span className="text-right">{[2993118, 5657920, 3325518, 2603328][index].toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="absolute bottom-[9%] right-5 w-44 space-y-1 text-[9px]">
        <div className="flex justify-between"><span>Net Amount Payable</span><b>21,278,567</b></div>
        <div className="flex justify-between"><span>Total VAT</span><b>3,830,142</b></div>
        <div className={cn('relative flex justify-between rounded border-t px-1 pt-1 text-[11px]', !scanning && 'border-2 border-emerald-500 bg-emerald-50 text-emerald-900 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]')}>
          <span>Gross Amount Payable</span><b>{extraction.totalAmount.toLocaleString()}</b>
          {!scanning && <span className="absolute -top-5 right-0 whitespace-nowrap rounded bg-emerald-600 px-1 py-0.5 text-[7px] uppercase tracking-wide text-white">Final total verified</span>}
        </div>
      </div>
      {scanning && (
        <div className="reconciliation-scan-line absolute inset-x-0 top-0 z-20 h-12 border-b-2 border-blue-500 bg-gradient-to-b from-transparent via-blue-400/10 to-blue-400/25 shadow-[0_8px_24px_rgba(59,130,246,0.25)]" />
      )}
    </div>
  )
}

export default function ReconciliationPage() {
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([])
  const [statementFile, setStatementFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [statementRecords, setStatementRecords] = useState<StatementRecord[]>(DEMO_STATEMENT)
  const [extractions, setExtractions] = useState<InvoiceExtraction[]>(DEMO_INVOICES)
  const [matches, setMatches] = useState<ReconciliationMatch[]>([])
  const [activeDocument, setActiveDocument] = useState(0)
  const [previewUrls, setPreviewUrls] = useState<Array<string | null>>([])
  const statementScrollRef = useRef<HTMLDivElement>(null)

  const working = phase === 'extracting' || phase === 'matching'
  const selectedExtraction = extractions[activeDocument] ?? DEMO_INVOICES[0]
  const previewUrl = previewUrls[activeDocument] ?? null
  const matchedCount = matches.filter((match) => match.matched).length
  const selectedVerified = selectedExtraction.fieldVerification
  const activeProcessStepIndex = PROCESSING_STEPS.reduce(
    (active, step, index) => progress >= step.at ? index : active,
    0,
  )
  const activeProcessStep = PROCESSING_STEPS[activeProcessStepIndex]

  useEffect(() => () => {
    previewUrls.forEach((url) => { if (url) URL.revokeObjectURL(url) })
  }, [previewUrls])

  useEffect(() => {
    if (!working) return
    const ceiling = phase === 'extracting' ? 62 : 92
    const timer = window.setInterval(() => {
      setProgress((current) => current < ceiling ? Math.min(ceiling, current + Math.max(1, Math.round((ceiling - current) / 8))) : current)
    }, 240)
    return () => window.clearInterval(timer)
  }, [working, phase])

  const matchedRows = useMemo(
    () => new Set(matches.filter((match) => match.matched && match.statementRecord).map((match) => statementRecordKey(match.statementRecord!))),
    [matches],
  )

  useEffect(() => {
    if (phase !== 'complete' || !matchedRows.size) return
    const container = statementScrollRef.current
    const target = container?.querySelector<HTMLElement>('[data-target-line="true"]')
    if (!container || !target) return
    container.scrollTo({ top: Math.max(0, target.offsetTop - container.clientHeight / 2), behavior: 'smooth' })
  }, [matchedRows, phase])

  function resetResults() {
    setPhase('idle')
    setProgress(0)
    setError('')
    setMatches([])
  }

  function selectInvoiceFiles(files: File[]) {
    const selected = files.slice(0, 12)
    setInvoiceFiles(selected)
    setPreviewUrls(selected.map((file) => file.type.startsWith('image/') ? URL.createObjectURL(file) : null))
    setActiveDocument(0)
    resetResults()
  }

  async function runDemo() {
    resetResults()
    setInvoiceFiles([])
    setStatementFile(null)
    setPreviewUrls([])
    setActiveDocument(0)
    setStatementRecords(DEMO_STATEMENT)
    setExtractions(DEMO_INVOICES)
    setPhase('extracting')
    setProgress(8)
    await delay(1500)
    setPhase('matching')
    setProgress(68)
    await delay(1300)
    setMatches(reconcileInvoices(DEMO_INVOICES, DEMO_STATEMENT))
    setProgress(100)
    setPhase('complete')
  }

  async function reconcileUploads() {
    if (!statementFile || invoiceFiles.length === 0) {
      setError('Upload a master statement and at least one invoice document first.')
      setPhase('error')
      return
    }

    resetResults()
    setPhase('extracting')
    setProgress(5)
    const formData = new FormData()
    formData.append('statement', statementFile)
    invoiceFiles.forEach((file) => formData.append('invoices', file))

    try {
      const response = await fetch('/api/reconciliation', { method: 'POST', body: formData })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Document extraction failed.')

      setStatementRecords(payload.statementRecords)
      setExtractions(payload.invoiceDocuments)
      setPhase('matching')
      setProgress(70)
      await delay(1200)
      setMatches(reconcileInvoices(payload.invoiceDocuments, payload.statementRecords))
      setProgress(100)
      setPhase('complete')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reconciliation failed.')
      setPhase('error')
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Document intelligence</p>
          <h1 className="text-2xl font-bold tracking-tight">Reconciliation</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Extract invoice evidence, locate the same record in the master statement, and keep the match reason visible for review.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
          <ShieldCheck className="size-3.5" /> API key stays server-side
        </div>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_76px_1fr]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b bg-slate-50/70 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><FileImage className="size-4 text-blue-700" />Invoice source</CardTitle>
                <CardDescription className="mt-1">Upload invoice images or PDFs; up to 12 files.</CardDescription>
              </div>
              <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">Evidence</span>
            </div>
            <UploadPanel
              title="Upload invoice documents"
              description="JPG, PNG, WebP or PDF"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              files={invoiceFiles}
              onFiles={selectInvoiceFiles}
            />
          </CardHeader>
          <CardContent className="bg-slate-100/60 p-4">
            {extractions.length > 1 && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {extractions.map((extraction, index) => (
                  <button
                    key={`${extraction.fileName}-${index}`}
                    type="button"
                    onClick={() => setActiveDocument(index)}
                    className={cn(
                      'shrink-0 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                      index === activeDocument ? 'border-blue-600 bg-blue-600 text-white' : 'bg-white text-slate-600 hover:border-blue-300',
                    )}
                  >
                    Invoice {index + 1}
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              {previewUrl ? (
                <div className="relative mx-auto w-full max-w-[390px] overflow-hidden rounded-md bg-white shadow-inner">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Uploaded invoice preview" className="block h-auto w-full" />
                  {!working && phase !== 'idle' && <>
                    {selectedVerified?.invoiceNumberVerified && <HighlightBox box={selectedExtraction.invoiceNumberBox} label="ID verified" />}
                    {selectedVerified?.totalAmountVerified && <HighlightBox box={selectedExtraction.totalAmountBox} label="Gross verified" />}
                  </>}
                  {working && <div className="reconciliation-scan-line absolute inset-x-0 top-0 h-12 border-b-2 border-blue-500 bg-blue-400/15" />}
                </div>
              ) : (
                <DemoInvoice scanning={working} extraction={selectedExtraction} />
              )}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200">
              <span className="truncate font-medium">{selectedExtraction.fileName}</span>
              <span className={cn('ml-3 shrink-0', working ? 'text-blue-700' : selectedVerified?.invoiceNumberVerified && selectedVerified?.totalAmountVerified ? 'text-emerald-700' : 'text-amber-700')}>
                {working ? 'Locating fields…' : selectedVerified?.invoiceNumberVerified && selectedVerified?.totalAmountVerified
                  ? `${selectedExtraction.invoiceNumber} · ${money(selectedExtraction.totalAmount)}`
                  : 'Extracted fields need review'}
              </span>
            </div>
            {!working && phase !== 'idle' && (
              <div className="mt-2 grid gap-1.5 text-[11px] sm:grid-cols-3">
                <span className={cn('rounded-md px-2 py-1.5', selectedVerified?.invoiceNumberVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                  <Check className="mr-1 inline size-3" />Printed ID evidence
                </span>
                <span className={cn('rounded-md px-2 py-1.5', selectedVerified?.totalAmountVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                  <Check className="mr-1 inline size-3" />{selectedExtraction.totalAmountLabel || 'Final amount label'}
                </span>
                <span className={cn('rounded-md px-2 py-1.5', selectedVerified?.arithmeticVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                  {selectedVerified?.arithmeticVerified ? <Check className="mr-1 inline size-3" /> : null}
                  {selectedVerified?.arithmeticVerified ? 'Net + tax verified' : 'Arithmetic unavailable'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="hidden items-center justify-center lg:flex">
          <div className="relative h-px w-full overflow-hidden bg-slate-200">
            <span className="reconciliation-flow-dot absolute -top-1.5 left-0 size-3 rounded-full bg-blue-600 shadow-[0_0_14px_rgba(37,99,235,0.7)]" />
          </div>
          <span className="absolute flex size-8 items-center justify-center rounded-full border bg-white text-blue-700 shadow-sm">
            <ArrowRight className="size-4" />
          </span>
        </div>

        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b bg-slate-50/70 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="size-4 text-violet-700" />Master statement</CardTitle>
                <CardDescription className="mt-1">Upload the source statement used as the control total.</CardDescription>
              </div>
              <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Master</span>
            </div>
            <UploadPanel
              title="Upload master statement"
              description="PDF, CSV or text statement"
              accept="application/pdf,text/csv,text/plain"
              files={statementFile ? [statementFile] : []}
              onFiles={(files) => { setStatementFile(files[0] ?? null); resetResults() }}
            />
          </CardHeader>
          <CardContent className="relative p-0">
            <div className="flex items-center justify-between border-b px-4 py-3 text-xs">
              <span className="font-semibold text-slate-700">{statementFile?.name ?? 'COLA customer statement · sample'}</span>
              <span className="text-muted-foreground">All {statementRecords.length.toLocaleString()} lines loaded</span>
            </div>
            <div ref={statementScrollRef} className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-900 text-slate-200">
                  <tr><th className="px-3 py-2.5 font-medium">Line</th><th className="px-3 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">All references</th><th className="px-3 py-2.5 font-medium">Type</th><th className="px-4 py-2.5 text-right font-medium">Incl. VAT</th></tr>
                </thead>
                <tbody>
                  {statementRecords.map((record, index) => {
                    const matched = matchedRows.has(statementRecordKey(record))
                    return (
                      <tr
                        key={statementRecordKey(record)}
                        data-target-line={matched ? 'true' : undefined}
                        className={cn(
                          'border-b transition-colors',
                          matched && 'bg-emerald-100 text-emerald-950 ring-1 ring-inset ring-emerald-400',
                          phase === 'matching' && 'animate-pulse',
                        )}
                        style={phase === 'matching' ? { animationDelay: `${index * 90}ms` } : undefined}
                      >
                        <td className="px-3 py-3 text-muted-foreground">{record.lineIndex ?? index + 1}</td>
                        <td className="px-3 py-3 text-muted-foreground">{record.date || '—'}</td>
                        <td className="max-w-56 px-3 py-3 font-mono font-semibold">
                          <span className="block truncate">{statementIdentifiers(record).join(' · ') || record.invoiceNumber}</span>
                          {matched && <span className="mt-1 inline-flex rounded bg-emerald-600 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wide text-white">Target line</span>}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{record.description ?? 'Statement line'}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">{money(record.amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {working && (
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-blue-500/0 via-blue-400/10 to-blue-500/0">
                <div className="reconciliation-scan-line absolute inset-x-0 top-0 h-14 border-b-2 border-violet-500 bg-violet-400/10" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-5 border-slate-200 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-[220px] flex-1">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-semibold text-slate-700">
                {working && <Loader2 className="size-3.5 animate-spin text-blue-700" />}
                {phase === 'extracting' && 'Reading invoice and statement evidence'}
                {phase === 'matching' && 'Applying ID and amount matching rules'}
                {phase === 'complete' && <><CheckCircle2 className="size-3.5 text-emerald-600" />Reconciliation complete</>}
                {phase === 'error' && <><AlertCircle className="size-3.5 text-rose-600" />Reconciliation needs attention</>}
                {phase === 'idle' && <><ScanLine className="size-3.5 text-blue-700" />Ready to reconcile</>}
              </span>
              <span className="font-semibold tabular-nums">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={cn('h-full rounded-full transition-[width] duration-300', phase === 'error' ? 'bg-rose-500' : phase === 'complete' ? 'bg-emerald-500' : 'bg-blue-700')} style={{ width: `${progress}%` }} />
            </div>
            {working && (
              <div className="mt-3 flex items-start gap-3 rounded-lg bg-blue-50 px-3 py-2.5 text-xs ring-1 ring-blue-100">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-700 text-[10px] font-bold text-white">{activeProcessStepIndex + 1}</span>
                <span>
                  <span className="block font-semibold text-blue-950">Processing now: {activeProcessStep.label}</span>
                  <span className="mt-0.5 block text-blue-800/75">{activeProcessStep.detail}</span>
                </span>
              </div>
            )}
            {working && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                {PROCESSING_STEPS.map((step, index) => (
                  <span key={step.label} className={cn(
                    'shrink-0 rounded-full px-2 py-1 text-[10px] font-medium',
                    index < activeProcessStepIndex && 'bg-emerald-50 text-emerald-700',
                    index === activeProcessStepIndex && 'bg-blue-700 text-white',
                    index > activeProcessStepIndex && 'bg-slate-100 text-slate-400',
                  )}>
                    {index < activeProcessStepIndex && <Check className="mr-1 inline size-2.5" />}{step.label}
                  </span>
                ))}
              </div>
            )}
            {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
          </div>
          <Button type="button" variant="outline" onClick={runDemo} disabled={working}>
            <Sparkles className="size-4" /> Run sample animation
          </Button>
          <Button type="button" className="bg-blue-700 text-white hover:bg-blue-600" onClick={reconcileUploads} disabled={working}>
            {working ? <Loader2 className="size-4 animate-spin" /> : <FileSearch className="size-4" />}
            Reconcile uploaded files
          </Button>
          {(phase === 'complete' || phase === 'error') && (
            <Button type="button" variant="ghost" size="icon" aria-label="Reset reconciliation" onClick={resetResults}><RotateCcw className="size-4" /></Button>
          )}
        </CardContent>
      </Card>

      {matches.length > 0 && (
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b bg-slate-50/70 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Match results</CardTitle>
                <CardDescription className="mt-1">Every master row can be assigned once; unresolved evidence stays visible for review.</CardDescription>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">{matchedCount} matched</span>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">{matches.length - matchedCount} review</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="bg-white text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Invoice file</th>
                    <th className="px-3 py-3 font-medium">Extracted evidence</th>
                    <th className="px-3 py-3 font-medium">Statement record</th>
                    <th className="px-3 py-3 font-medium">Method</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match, index) => (
                    <tr key={`${match.invoice.fileName}-${index}`} className="border-t">
                      <td className="max-w-48 truncate px-4 py-3 font-medium">{match.invoice.fileName}</td>
                      <td className="px-3 py-3"><span className="font-mono font-semibold">{match.invoice.invoiceNumber}</span><span className="ml-2 text-muted-foreground">{money(match.invoice.totalAmount)}</span></td>
                      <td className="px-3 py-3">{match.statementRecord ? <><span className="font-mono font-semibold">{statementIdentifiers(match.statementRecord).join(' · ')}</span><span className="ml-2 text-muted-foreground">{money(match.statementRecord.amount)}</span></> : '—'}</td>
                      <td className="px-3 py-3">
                        <span className={cn('rounded-full px-2 py-1 font-medium', match.matched ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700')}>
                          {RECONCILIATION_METHOD_LABELS[match.method]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1 font-semibold', match.matched ? 'text-emerald-700' : 'text-rose-700')}>
                          {match.matched ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
                          {match.matched ? 'Matched' : 'Review'}
                        </span>
                        {match.matched && <span className="ml-2 text-[10px] font-semibold text-slate-500">{Math.round(match.confidence * 100)}% confidence</span>}
                        <p className="mt-1 max-w-xs text-[11px] font-normal text-muted-foreground">{match.reason}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
