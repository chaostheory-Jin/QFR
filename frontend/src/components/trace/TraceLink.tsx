import Link from 'next/link'
import { ArrowUpRight, Files } from 'lucide-react'

export function TraceLink({ href }: { href: string }) {
  return <Link href={href} className="group flex items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-indigo-50/50 px-5 py-4 transition hover:border-indigo-300 hover:bg-indigo-50">
    <div className="flex items-center gap-3"><span className="rounded-lg bg-white p-2 text-indigo-600"><Files size={21} /></span><div><p className="font-medium text-slate-900">Explore the numbers</p><p className="text-sm text-slate-500">See the transactions and documents behind this report.</p></div></div>
    <ArrowUpRight className="shrink-0 text-indigo-600 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" size={22} />
  </Link>
}
