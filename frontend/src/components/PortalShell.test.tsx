import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sidebar, NAV_GROUPS } from './Sidebar'
import { PortalShell } from './PortalShell'
import { BrowserStorageNotice } from './BrowserStorageNotice'
import { FloatingAssistant } from './FloatingAssistant'
import AIInsightsPage from '@/app/(dashboard)/ai-insights/page'

vi.mock('next/navigation', () => ({ usePathname: () => '/payroll', useRouter: () => ({ push: vi.fn() }) }))

describe('portal presentation', () => {
  it('groups every destination once and exposes the current page accessibly', () => {
    const routes = NAV_GROUPS.flatMap(group => group.items.map(item => item.href))
    expect(new Set(routes).size).toBe(routes.length)
    expect(routes).toContain('/imports')
    const html = renderToStaticMarkup(<Sidebar />)
    for (const label of ['Workspace', 'Financial reports', 'Operations', 'Data &amp; settings']) expect(html).toContain(label)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Payroll"')
    expect(html).toContain('md:w-60')
  })

  it('keeps storage and AI disclosure available inside a collapsed notice', () => {
    const html = renderToStaticMarkup(<BrowserStorageNotice />)
    expect(html).toContain('<details')
    expect(html).not.toContain('open=""')
    for (const message of ['No cloud backup', 'Clearing site data removes them', 'AI analysis still sends selected documents']) expect(html).toContain(message)
  })

  it('keeps the assistant in the layout, hidden by default, with one header trigger', () => {
    const html = renderToStaticMarkup(<PortalShell><input defaultValue="Unsaved review" /></PortalShell>)
    expect(html).toContain('Unsaved review')
    expect(html).toContain('aria-controls="financial-assistant"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/<aside[^>]*id="financial-assistant"[^>]*hidden=""/)
    expect(html).not.toContain('fixed bottom')
  })

  it('renders the open assistant with a labelled editor and no floating overlay', () => {
    const html = renderToStaticMarkup(<FloatingAssistant open onClose={vi.fn()} />)
    expect(html).not.toContain('hidden=""')
    expect(html).toContain('for="assistant-question"')
    expect(html).toContain('Close AI panel')
    expect(html).toContain('xl:w-[360px]')
    expect(html).not.toContain('fixed')
  })

  it('has one primary preview action and selectable report options', () => {
    const html = renderToStaticMarkup(<AIInsightsPage />)
    expect(html.match(/type="radio"/g)).toHaveLength(2)
    expect(html.match(/data-slot="button"/g)).toHaveLength(1)
    expect(html).toContain('Demo workflow')
    expect(html).toContain('does not sync a live account')
    expect(html).not.toContain('bg-[#03060f]')
  })
})
