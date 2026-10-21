'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { TrendingUp, LayoutList, Sparkles, ChevronLeft, ChevronRight, Database, GitCompareArrows, Files, Users, Upload, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

export const NAV_GROUPS = [
  { label: 'Workspace', items: [{ href: '/ai-insights', label: 'AI Insights', icon: Sparkles }] },
  { label: 'Financial reports', items: [
    { href: '/profit-loss', label: 'Profit & Loss', icon: TrendingUp },
    { href: '/balance-sheet', label: 'Balance Sheet', icon: LayoutList },
    { href: '/report-trace', label: 'Report Explorer', icon: Files },
  ] },
  { label: 'Operations', items: [
    { href: '/payroll', label: 'Payroll', icon: Users },
    { href: '/reconciliation', label: 'Reconciliation', icon: GitCompareArrows },
  ] },
  { label: 'Data & settings', items: [
    { href: '/link-data', label: 'Link to Data', icon: Database },
    { href: '/imports', label: 'File imports', icon: Upload },
  ] },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const labelClass = collapsed ? 'hidden' : 'hidden md:block'
  return <aside aria-label="Main navigation" className={cn('flex h-full w-16 shrink-0 flex-col border-r border-slate-200 bg-white', !collapsed && 'md:w-60')}>
    <div className="flex h-16 shrink-0 items-center justify-center gap-2 border-b border-slate-200 px-2">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-700 text-white', collapsed && 'md:hidden')} title="Peak Advisory"><Layers className="size-5" /></span>
      <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', labelClass)}>Peak Advisory</span>
      <button type="button" onClick={() => setCollapsed(!collapsed)} className="hidden size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500 md:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    </div>
    <nav aria-label="Portal sections" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {NAV_GROUPS.map((group, index) => <section key={group.label} aria-label={group.label} className={cn('pt-4', index > 0 && 'mt-3 border-t border-slate-100')}>
        <h2 className={cn('mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500', labelClass)}>{group.label}</h2>
        <div className="space-y-1">{group.items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-label={label} title={label} aria-current={pathname === href ? 'page' : undefined}
          className={cn('flex min-h-11 items-center justify-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500', !collapsed && 'md:justify-start', pathname === href ? 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
          <Icon size={18} className="shrink-0" /><span className={labelClass}>{label}</span>
        </Link>)}</div>
      </section>)}
    </nav>
    <p className={cn('border-t border-slate-100 px-5 py-4 text-xs text-slate-400', labelClass)}>Peak Advisory · Finance portal</p>
  </aside>
}
