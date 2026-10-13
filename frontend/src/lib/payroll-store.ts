import { browserRead, browserUpdate } from './browser-storage'
import { applyPayrollAction, createPayrollState, type PayrollAction, type PayrollState } from './payroll-ledger'
import { loadPayrollReviews } from './payroll-reviews'

const KEY = 'payroll-workflow:demo-v1'
export async function loadPayrollState(): Promise<PayrollState> {
  const existing = await browserRead<PayrollState>(KEY)
  if (existing) return existing
  const legacy = await loadPayrollReviews()
  return browserUpdate<PayrollState>(KEY, current => {
    if (current) return current
    const state = createPayrollState()
    for (const [id, review] of Object.entries(legacy.reviews)) {
      state.reviews[id] = { status: review.status, note: review.note, reviewer: 'Imported local review (identity unavailable)', at: review.updatedAt }
    }
    state.history.push(...legacy.history.map(review => ({ action: 'import-legacy-review', target: review.lineId, note: review.note, reviewer: 'Legacy browser review', at: review.updatedAt })))
    return state
  })
}
export async function savePayrollAction(action: PayrollAction, revision: number) {
  return browserUpdate<PayrollState>(KEY, current => {
    if (!current) throw new Error('Load the payroll demo before making changes.')
    return applyPayrollAction(current, action, revision, new Date().toISOString())
  })
}
