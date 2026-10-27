import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DraftActionBar, SaveButton } from './ReviewSave'
import { CopyReference, ExpandableText, TableViewport } from './TableReading'
import { Button } from './ui/button'

describe('review feedback and readable tables', () => {
  it('does not show an unsaved bar on an untouched page', () => {
    expect(renderToStaticMarkup(<DraftActionBar count={0} phase="idle" message="" onSave={vi.fn()} />)).toBe('')
  })
  it('shows batch scope and retained-draft error, not a false success', () => {
    const html = renderToStaticMarkup(<DraftActionBar count={2} phase="error" message="1 saved. Storage full. Unsaved changes kept." onSave={vi.fn()} onDiscard={vi.fn()} />)
    expect(html).toContain('2 unsaved reviews')
    expect(html).toContain('including other pages and hidden filters')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Retry save')
    expect(html).not.toContain('Changes saved')
  })
  it('disables a saving button and exposes its busy state', () => {
    const html = renderToStaticMarkup(<SaveButton phase="saving" onClick={vi.fn()} />)
    expect(html).toContain('disabled')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Saving…')
  })
  it('explains why a save cannot proceed', () => {
    const html = renderToStaticMarkup(<DraftActionBar count={1} phase="idle" message="" disabledReason="Add an evidence reason." onSave={vi.fn()} />)
    expect(html).toContain('Add an evidence reason.')
    expect(html).toContain('disabled')
  })
  it('keeps the full reference and full explanation in accessible content', () => {
    const reference = 'INV-123456789012345678901234567890'
    const longText = 'Evidence details. '.repeat(20)
    expect(renderToStaticMarkup(<CopyReference value={reference} />)).toContain(reference)
    const html = renderToStaticMarkup(<ExpandableText text={longText} />)
    expect(html).toContain('<details')
    expect(html).toContain(longText)
    expect(html).toContain('Read more')
  })
  it('gives the scrolling table a keyboard target and label', () => {
    const html = renderToStaticMarkup(<TableViewport label="Transactions" resetKey="page-1"><table><tbody /></table></TableViewport>)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="Transactions"')
  })
  it('uses at least 36px compact controls', () => {
    expect(renderToStaticMarkup(<Button size="xs">Save</Button>)).toContain('min-h-9')
    expect(renderToStaticMarkup(<Button size="icon-xs" aria-label="Copy" />)).toContain('size-9')
  })
})
