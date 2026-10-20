import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspacePanel, WorkspaceTabs } from './WorkspaceTabs'

describe('workspace navigation', () => {
  it('connects tabs to panels with one keyboard entry point', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceTabs, {
      id: 'test', label: 'Finance workspace', value: 'overview', onChange: vi.fn(),
      items: [{ id: 'overview', label: 'Overview' }, { id: 'review', label: 'Review', count: 3 }],
    }))
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-controls="test-panel-review"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
  })

  it('keeps an inactive panel and its draft fields mounted but hidden', () => {
    const html = renderToStaticMarkup(<WorkspacePanel id="test" value="review" active="overview"><textarea defaultValue="Unsaved evidence" /></WorkspacePanel>)
    expect(html).toContain('hidden=""')
    expect(html).toContain('aria-labelledby="test-tab-review"')
    expect(html).toContain('Unsaved evidence')
  })

  it('does not hide the selected panel', () => {
    const html = renderToStaticMarkup(<WorkspacePanel id="test" value="review" active="review">Review content</WorkspacePanel>)
    expect(html).not.toContain('hidden=')
    expect(html).toContain('Review content')
  })
})
