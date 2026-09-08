'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { TrendingUp, LayoutList, Sparkles, ChevronLeft, ChevronRight, Database, GitCompareArrows } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/link-data', label: 'Link to Data', icon: Database },
  { href: '/ai-insights', label: 'AI Insights', icon: Sparkles },
  { href: '/profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { href: '/balance-sheet', label: 'Balance Sheet', icon: LayoutList },
  { href: '/reconciliation', label: 'Reconciliation', icon: GitCompareArrows },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-slate-900 text-white transition-all duration-300 shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700 min-h-[57px]">
        {!collapsed && (
          <span className="font-semibold text-sm tracking-wide truncate">Peak Advisory</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn('rounded p-1 hover:bg-slate-700 shrink-0', collapsed && 'mx-auto')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className="flex flex-col gap-1 p-2 mt-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              'hover:bg-slate-700',
              pathname === href
                ? 'bg-slate-700 text-white font-medium'
                : 'text-slate-300',
              collapsed && 'justify-center px-2'
            )}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
