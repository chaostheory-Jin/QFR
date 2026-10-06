import { browserRead, browserUpdate } from './browser-storage'
import { PAYROLL_LINES } from './payroll-mock'
export type PayrollReview = { lineId: string; status: 'Approved' | 'Needs changes'; note: string; revision: number; updatedAt: string }
export type PayrollReviews = { reviews: Record<string, PayrollReview>; history: PayrollReview[] }
const key = 'payroll-reviews:mock-2026-v1'
export async function loadPayrollReviews(): Promise<PayrollReviews> { return await browserRead<PayrollReviews>(key) ?? { reviews: {}, history: [] } }
export async function savePayrollReview(lineId: string, status: PayrollReview['status'], note: string, revision: number) {
  if (!PAYROLL_LINES.some(row => row.id === lineId) || !['Approved', 'Needs changes'].includes(status) || !note.trim() || note.length > 2000) throw new Error('Select a valid payroll line and add a review note (maximum 2,000 characters).')
  return browserUpdate<PayrollReviews>(key, current => {
    const store = current ?? { reviews: {}, history: [] }
    if ((store.reviews[lineId]?.revision ?? 0) !== revision) throw new Error('This payslip was reviewed in another tab. Reload before saving.')
    const review = { lineId, status, note: note.trim(), revision: revision + 1, updatedAt: new Date().toISOString() }
    store.reviews[lineId] = review; store.history.push(review)
    return store
  })
}
