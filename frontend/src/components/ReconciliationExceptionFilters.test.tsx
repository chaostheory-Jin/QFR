import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReconciliationExceptionFilters } from './ReconciliationExceptionFilters'

describe('exception queue controls', () => {
  it('shows all five categories even when empty, with an accessible selected filter', () => {
    const html = renderToStaticMarkup(<ReconciliationExceptionFilters entries={[]} value="amount" onChange={vi.fn()} />)
    for (const label of ['Amount mismatch', 'Possible ID issue', 'Multiple candidates', 'No candidate found', 'Shared statement line']) expect(html).toContain(label)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toContain('aria-controls="reconciliation-result-list"')
    expect(html).toContain('Categories may overlap')
    expect(html).toContain('Suggestions are not confirmed matches')
    expect(html).toContain('All results · 0')
  })
})
