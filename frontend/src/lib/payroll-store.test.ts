import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BROWSER_DATABASE } from './browser-storage'
import { savePayrollReview } from './payroll-reviews'
import { loadPayrollState, savePayrollAction } from './payroll-store'
beforeEach(async () => { await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(BROWSER_DATABASE); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) }) })
describe('browser payroll workflow persistence', () => {
  it('preserves existing local reviews and initializes once', async () => {
    const id = 'MOCK-2026-08-EMP-008'
    await savePayrollReview(id, 'Needs changes', 'Existing receipt missing', 0)
    const a = await loadPayrollState(), b = await loadPayrollState()
    expect(a).toEqual(b)
    expect(a.reviews[id].note).toBe('Existing receipt missing')
    expect(a.history).toHaveLength(1)
  })
  it('persists after reload and rejects competing writes in one transaction', async () => {
    await loadPayrollState()
    const action = { type: 'review' as const, lineId: 'MOCK-2026-09-EMP-001', status: 'Approved' as const, reviewer: 'Demo tester', note: 'Evidence inspected' }
    const results = await Promise.allSettled([savePayrollAction(action, 0), savePayrollAction(action, 0)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const loaded = await loadPayrollState()
    expect(loaded.revision).toBe(1)
    expect(loaded.history).toHaveLength(1)
    expect(loaded.reviews[action.lineId].status).toBe('Approved')
    expect(loaded.posted).not.toContain(action.lineId)
  })
})
