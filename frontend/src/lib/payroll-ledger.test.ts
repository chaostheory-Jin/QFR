import { describe, expect, it } from 'vitest'
import { PAYROLL_LINES } from './payroll-mock'
import { accountBalance, applyPayrollAction, bankCandidates, createPayrollState, linePayments, matchedBank, OPENING_CASH, paidAmount, paymentStatus, payrollJournal, payrollReport, reconciliationStatus, type PayrollAction, type PayrollState } from './payroll-ledger'

const reviewer = 'Demo finance tester', note = 'Checked fictional evidence; no real payment.'
const find = (month: string, employee: string) => PAYROLL_LINES.find(row => row.date.startsWith(month) && row.employeeId === employee)!
const next = (state: PayrollState, action: PayrollAction) => applyPayrollAction(state, action, state.revision, '2026-10-13T00:00:00Z')
describe('integrated payroll ledger', () => {
  it('is deterministic, unique and every journal balances to the cent', () => {
    const state = createPayrollState(), journal = payrollJournal(state)
    expect(state).toEqual(createPayrollState())
    expect(state.posted).toHaveLength(96)
    expect(new Set(journal.map(l => l.id)).size).toBe(journal.length)
    for (const id of new Set(journal.map(l => l.journalId))) {
      const lines = journal.filter(l => l.journalId === id)
      expect(lines.reduce((n, l) => n + l.debit - l.credit, 0), id).toBe(0)
      expect(lines.every(l => Number.isSafeInteger(l.debit) && Number.isSafeInteger(l.credit) && l.debit >= 0 && l.credit >= 0)).toBe(true)
    }
  })
  it('only posted payroll reaches P&L; draft liabilities do not leak into balances', () => {
    const state = createPayrollState(), data = payrollReport(state, '2026-01-01', '2026-09-30')
    expect(data.expense).toBe(PAYROLL_LINES.filter(r => state.posted.includes(r.id)).reduce((n, r) => n + r.employerCost, 0))
    expect(payrollReport(state, '2026-09-01', '2026-09-30').expense).toBe(0)
    expect(data.balanceDifference).toBe(0)
    expect(data.capital).toBe(OPENING_CASH)
    expect(data.equity).toBe(OPENING_CASH - data.cumulativeLoss)
  })
  it('reconciles opening plus movements to every daily endpoint, including remittance dates', () => {
    const state = createPayrollState(), journal = payrollJournal(state)
    for (const day of ['2026-01-01', '2026-01-27', '2026-01-28', '2026-01-29', '2026-07-29', '2026-08-28', '2026-09-30']) {
      expect(payrollReport(state, day, day).balanceDifference, day).toBe(0)
      const open = accountBalance(journal, 'bank', day, true)
      const movement = journal.filter(l => l.account === 'bank' && l.date === day).reduce((n, l) => n + l.debit - l.credit, 0)
      expect(open + movement).toBe(accountBalance(journal, 'bank', day))
    }
    expect(accountBalance(journal, 'tax', '2026-07-29')).toBe(0)
    expect(accountBalance(journal, 'superPayable', '2026-07-29')).toBe(0)
    expect(accountBalance(journal, 'tax', '2026-08-28')).toBeGreaterThan(0)
  })
  it('models partial, split, failed and batch payments without duplicate costs', () => {
    const state = createPayrollState()
    const partial = find('2026-08', 'EMP-001'), split = find('2026-08', 'EMP-002'), failed = find('2026-08', 'EMP-003')
    expect(paymentStatus(state, partial)).toBe('Part paid')
    expect(partial.net - paidAmount(state, partial.id)).toBe(10000)
    expect(reconciliationStatus(state, partial)).toBe('Amount outstanding')
    expect(linePayments(state, split.id)).toHaveLength(2)
    expect(reconciliationStatus(state, split)).toBe('Reconciled')
    expect(paymentStatus(state, failed)).toBe('Failed')
    expect(payrollJournal(state).filter(l => l.paymentId === linePayments(state, failed.id)[0].id)).toHaveLength(0)
    const batch = state.payments.find(p => p.allocations.length === 2)!
    expect(batch.allocations.reduce((n, a) => n + a.amount, 0)).toBe(batch.amount)
    expect(matchedBank(state, batch)).toBeTruthy()
    for (const a of batch.allocations) expect(reconciliationStatus(state, PAYROLL_LINES.find(r => r.id === a.lineId)!)).toBe('Reconciled')
  })
  it('requires approval then posting then payment, enforces revision and refuses duplicates', () => {
    let state = createPayrollState()
    const row = find('2026-09', 'EMP-001'), action = { lineId: row.id, reviewer, note }
    expect(() => next(state, { type: 'post', ...action })).toThrow(/Approve/)
    state = next(state, { type: 'review', status: 'Approved', ...action })
    expect(() => next(state, { type: 'pay', ...action })).toThrow(/Post payroll/)
    state = next(state, { type: 'post', ...action })
    const before = payrollReport(state, '2026-01-01', '2026-09-30')
    expect(() => next(state, { type: 'post', ...action })).toThrow(/Already posted/)
    expect(() => applyPayrollAction(state, { type: 'pay', ...action }, 0, '')).toThrow(/another tab/)
    state = next(state, { type: 'pay', ...action })
    const after = payrollReport(state, '2026-01-01', '2026-09-30')
    expect(after.expense).toBe(before.expense)
    expect(after.bank).toBe(before.bank - row.net)
    expect(after.liabilities).toBe(before.liabilities - row.net)
    expect(after.balanceDifference).toBe(0)
    expect(reconciliationStatus(state, row)).toBe('Reconciled')
    expect(() => next(state, { type: 'pay', ...action })).toThrow(/No unpaid balance/)
    expect(state.history).toHaveLength(3)
  })
  it('review approval alone does not change money or reverse historical journals', () => {
    const state = createPayrollState(), row = find('2026-08', 'EMP-001'), before = payrollJournal(state)
    const changed = next(state, { type: 'review', status: 'Needs changes', lineId: row.id, reviewer, note })
    expect(payrollJournal(changed)).toEqual(before)
    expect(() => next(changed, { type: 'pay', lineId: row.id, reviewer, note })).toThrow(/Approve/)
    expect(state.reviews[row.id].status).toBe('Approved')
  })
  it('offers candidates without treating a same-amount transfer or a variance as proof', () => {
    const state = createPayrollState(), row = find('2026-08', 'EMP-006'), payment = linePayments(state, row.id)[0]
    const candidates = bankCandidates(state, payment)
    expect(candidates).toHaveLength(2)
    expect(candidates[0].exactReference).toBe(true)
    expect(candidates[0].difference).toBe(-5000)
    expect(candidates[1].difference).toBe(0)
    expect(matchedBank(state, payment)).toBeNull()
    expect(() => next(state, { type: 'bank', decision: 'confirm', paymentId: payment.id, bankId: candidates[0].bank.id, reviewer, note })).toThrow(/differs/)
    const reviewed = next(state, { type: 'bank', decision: 'confirm', paymentId: payment.id, bankId: candidates[1].bank.id, reviewer, note })
    expect(matchedBank(reviewed, payment)).toBe(candidates[1].bank.id)
    expect(payrollJournal(reviewed)).toEqual(payrollJournal(state))
    expect(next(reviewed, { type: 'bank', decision: 'reject', paymentId: payment.id, bankId: null, reviewer, note }).bankReviews[payment.id].action).toBe('reject')
  })
  it('rejects duplicate bank use, ambiguous references and failed payment matching', () => {
    const state = createPayrollState(), first = state.payments[0], second = state.payments[1]
    const bankId = matchedBank(state, first)!
    second.amount = first.amount
    second.allocations[0].amount = first.amount
    expect(() => next(state, { type: 'bank', decision: 'confirm', paymentId: second.id, bankId, reviewer, note })).toThrow(/already assigned/)
    const duplicate = structuredClone(state.banks[0]); duplicate.id += '-duplicate'; state.banks.push(duplicate)
    expect(matchedBank(state, first)).toBeNull()
    const failed = state.payments.find(p => p.status === 'Failed')!
    expect(() => next(state, { type: 'bank', decision: 'confirm', paymentId: failed.id, bankId, reviewer, note })).toThrow(/Only settled/)
  })
  it('settles only the outstanding remainder and leaves journal IDs stable', () => {
    const state = createPayrollState(), row = find('2026-08', 'EMP-001'), originalIds = payrollJournal(state).map(l => l.id)
    const changed = next(state, { type: 'pay', lineId: row.id, reviewer, note })
    expect(changed.payments.at(-1)?.amount).toBe(10000)
    expect(paidAmount(changed, row.id)).toBe(row.net)
    expect(payrollJournal(changed).map(l => l.id)).toEqual(expect.arrayContaining(originalIds))
    expect(() => next(state, { type: 'review', lineId: row.id, status: 'Approved', note: '', reviewer })).toThrow(/reviewer name/)
  })
})
