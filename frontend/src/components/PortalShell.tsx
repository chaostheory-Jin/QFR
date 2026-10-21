'use client'

import { useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { PanelRightOpen } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { FloatingAssistant } from './FloatingAssistant'
import { BrowserStorageNotice } from './BrowserStorageNotice'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

const PAGE_NAMES: Record<string, string> = {
  '/ai-insights': 'AI Insights', '/profit-loss': 'Profit & Loss', '/balance-sheet': 'Balance Sheet',
  '/payroll': 'Payroll', '/reconciliation': 'Reconciliation', '/report-trace': 'Report Explorer',
  '/link-data': 'Link to Data', '/imports': 'File imports',
}

export function PortalShell({ children }: { children: ReactNode }) {
  const [assistantPath, setAssistantPath] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()
  const assistantOpen = assistantPath === pathname
  function closeAssistant() {
    setAssistantPath(null)
    trigger.current?.focus()
  }

  return <div className="portal-shell flex h-dvh overflow-hidden bg-slate-50 text-slate-900">
    <a href="#workspace-content" className="sr-only z-50 rounded-lg bg-white p-3 focus:not-sr-only focus:absolute">Skip to workspace</a>
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 lg:px-6">
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Finance workspace</p><p className="text-sm font-semibold">{PAGE_NAMES[pathname] ?? 'Workspace'}</p></div>
        <Button ref={trigger} variant="outline" onClick={() => assistantOpen ? closeAssistant() : setAssistantPath(pathname)} aria-expanded={assistantOpen} aria-controls="financial-assistant" className="border-indigo-200 text-indigo-700"><PanelRightOpen className="size-4" />{assistantOpen ? 'Close assistant' : 'AI Assistant'}</Button>
      </header>
      <div className="flex min-h-0 flex-1">
        {/* Preserve page drafts and scroll position while the mobile assistant is open. */}
        <div id="workspace-content" tabIndex={-1} className={cn('min-w-0 flex-1 overflow-y-auto outline-none', assistantOpen && 'hidden xl:block')}>
          <BrowserStorageNotice />
          {children}
        </div>
        <FloatingAssistant open={assistantOpen} onClose={closeAssistant} />
      </div>
    </div>
  </div>
}
