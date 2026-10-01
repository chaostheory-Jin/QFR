import { Suspense } from 'react'
import { TraceExplorer } from '@/components/trace/TraceExplorer'

export default function ReportTracePage() {
  return <Suspense fallback={<div className="p-10 text-slate-500">Opening report explorer…</div>}><TraceExplorer /></Suspense>
}
