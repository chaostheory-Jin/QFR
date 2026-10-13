import { PAYROLL_LINES, type PayrollLine } from './payroll-mock'

// Fictional, single-company AUD ledger. Integer cents throughout; not a tax engine.
export const PAYROLL_COMPANY = 'Peak Demo Pty Ltd'
export const OPENING_DATE = '2025-12-31'
export const OPENING_CASH = 150_000_000
export const ACCOUNTS = {
  bank: 'Demo business bank', wages: 'Wages & Salaries', superExpense: 'Employer Superannuation',
  wagesPayable: 'Wages payable', tax: 'Withholding payable', deductions: 'Other deductions payable',
  superPayable: 'Superannuation payable', capital: 'Opening capital',
} as const
export type Account = keyof typeof ACCOUNTS
export type Payment = { id: string; date: string; status: 'Settled' | 'Failed'; allocations: { lineId: string; amount: number }[]; amount: number; currency: 'AUD'; reference: string }
export type BankLine = { id: string; date: string; amount: number; currency: 'AUD'; reference: string; paymentIds: string[] }
export type PayrollDecision = { status: 'Approved' | 'Needs changes'; note: string; reviewer: string; at: string }
export type BankDecision = { bankId: string | null; action: 'confirm' | 'reject'; note: string; reviewer: string; at: string }
export type PayrollState = {
  version: 1; revision: number; posted: string[]; reviews: Record<string, PayrollDecision>
  payments: Payment[]; banks: BankLine[]; bankReviews: Record<string, BankDecision>
  history: { action: string; target: string; note: string; reviewer: string; at: string }[]
}
export type JournalLine = { id: string; journalId: string; date: string; account: Account; debit: number; credit: number; lineId?: string; paymentId?: string; description: string }
export const PAYABLE_ACCOUNTS = ['wagesPayable', 'tax', 'deductions', 'superPayable'] as const
export const EXPENSE_ACCOUNTS = ['wages', 'superExpense'] as const
export const BALANCE_ACCOUNTS = ['bank', ...PAYABLE_ACCOUNTS, 'capital'] as const
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

export function createPayrollState(): PayrollState {
  const state: PayrollState = { version: 1, revision: 0, posted: [], reviews: {}, payments: [], banks: [], bankReviews: {}, history: [] }
  const addPayment = (id: string, lines: PayrollLine[], amounts = lines.map(row => row.net), status: Payment['status'] = 'Settled', bank = true) => {
    const payment: Payment = { id, date: lines[0].date, status, currency: 'AUD', reference: id,
      allocations: lines.map((row, i) => ({ lineId: row.id, amount: amounts[i] })), amount: sum(amounts) }
    state.payments.push(payment)
    if (status === 'Settled' && bank) state.banks.push({ id: `BANK-${id}`, date: payment.date, amount: payment.amount, currency: 'AUD', reference: id, paymentIds: [id] })
  }
  for (const row of PAYROLL_LINES.filter(row => row.date < '2026-09-01')) {
    state.posted.push(row.id)
    if (!row.reason) state.reviews[row.id] = { status: 'Approved', note: 'Historical mock approval; not verified human evidence.', reviewer: 'Demo fixture', at: `${row.date}T09:00:00Z` }
    const id = `PMT-${row.id}`
    if (row.date.startsWith('2026-08')) {
      if (row.employeeId === 'EMP-001') { addPayment(id, [row], [row.net - 10000]); continue }
      if (row.employeeId === 'EMP-002') { const half = Math.floor(row.net / 2); addPayment(`${id}-A`, [row], [half]); addPayment(`${id}-B`, [row], [row.net - half]); continue }
      if (row.employeeId === 'EMP-003') { addPayment(id, [row], [row.net], 'Failed'); continue }
      if (row.employeeId === 'EMP-005') continue
      if (row.employeeId === 'EMP-004') { addPayment(`BATCH-${row.run}`, [row, PAYROLL_LINES.find(item => item.run === row.run && item.employeeId === 'EMP-005')!]); continue }
      if (row.employeeId === 'EMP-006') {
        addPayment(id, [row], [row.net], 'Settled', false)
        // Two plausible lines: an amount-only candidate and a referenced variance. Neither auto-matches.
        state.banks.push({ id: `BANK-UNREFERENCED-${id}`, date: row.date, amount: row.net, currency: 'AUD', reference: 'Payroll transfer — missing reference', paymentIds: [] },
          { id: `BANK-VARIANCE-${id}`, date: row.date, amount: row.net - 5000, currency: 'AUD', reference: id, paymentIds: [id] })
        continue
      }
    }
    addPayment(id, [row])
  }
  return state
}

export function linePayments(state: PayrollState, lineId: string) { return state.payments.filter(p => p.allocations.some(a => a.lineId === lineId)) }
export function paidAmount(state: PayrollState, lineId: string) {
  return sum(linePayments(state, lineId).filter(p => p.status === 'Settled').flatMap(p => p.allocations.filter(a => a.lineId === lineId).map(a => a.amount)))
}
export function paymentStatus(state: PayrollState, row: PayrollLine) {
  const paid = paidAmount(state, row.id)
  return paid === row.net ? 'Paid' : paid > 0 ? 'Part paid' : linePayments(state, row.id).some(p => p.status === 'Failed') ? 'Failed' : 'Unpaid'
}
export function bankCandidates(state: PayrollState, payment: Payment) {
  return state.banks.filter(bank => bank.currency === payment.currency && Math.abs(Date.parse(bank.date) - Date.parse(payment.date)) <= 7 * 86400000
    && (bank.paymentIds.includes(payment.id) || bank.amount === payment.amount))
    .map(bank => ({ bank, difference: bank.amount - payment.amount, exactReference: bank.paymentIds.includes(payment.id),
      reason: bank.paymentIds.includes(payment.id) ? bank.amount === payment.amount ? 'Payment reference + batch total agree' : 'Payment reference agrees; amount differs' : 'Same amount and nearby date only — inspect evidence' }))
    .sort((a, b) => Number(b.exactReference) - Number(a.exactReference) || Math.abs(a.difference) - Math.abs(b.difference) || a.bank.id.localeCompare(b.bank.id)).slice(0, 5)
}
function automaticBank(state: PayrollState, payment: Payment) {
  if (payment.status !== 'Settled' || !payment.allocations.length || sum(payment.allocations.map(a => a.amount)) !== payment.amount) return null
  const candidates = state.banks.filter(bank => bank.currency === payment.currency && bank.amount === payment.amount && bank.paymentIds.includes(payment.id)
    && Math.abs(Date.parse(bank.date) - Date.parse(payment.date)) <= 7 * 86400000)
  if (candidates.length !== 1) return null
  const bank = candidates[0]
  // A single bank line cannot automatically prove two different payments.
  if (state.payments.filter(p => p.status === 'Settled' && bank.paymentIds.includes(p.id)).length !== 1) return null
  return bank.id
}
export function matchedBank(state: PayrollState, payment: Payment): string | null {
  if (payment.status !== 'Settled') return null
  const review = state.bankReviews[payment.id]
  const id = review ? review.action === 'confirm' ? review.bankId : null : automaticBank(state, payment)
  if (!id) return null
  const bank = state.banks.find(b => b.id === id)
  if (!bank || bank.currency !== payment.currency || bank.amount !== payment.amount) return null
  if (Object.entries(state.bankReviews).some(([other, d]) => other !== payment.id && d.action === 'confirm' && d.bankId === id)) return null
  return id
}
export function bankOwner(state: PayrollState, bankId: string, except?: string) {
  return state.payments.find(p => p.id !== except && matchedBank(state, p) === bankId)?.id
}
export function reconciliationStatus(state: PayrollState, row: PayrollLine) {
  const payments = linePayments(state, row.id).filter(p => p.status === 'Settled')
  if (!payments.length) return 'No settled payment'
  if (payments.some(p => !matchedBank(state, p))) return 'Needs bank review'
  return paidAmount(state, row.id) === row.net ? 'Reconciled' : 'Amount outstanding'
}

export function payrollJournal(state: PayrollState): JournalLine[] {
  const lines: JournalLine[] = []
  const add = (journalId: string, date: string, account: Account, debit: number, credit: number, description: string, lineId?: string, paymentId?: string) => {
    if (debit || credit) lines.push({ id: `${journalId}:${account}:${lineId ?? 'opening'}`, journalId, date, account, debit, credit, description, lineId, paymentId })
  }
  add('OPENING', OPENING_DATE, 'bank', OPENING_CASH, 0, 'Fictional opening funding')
  add('OPENING', OPENING_DATE, 'capital', 0, OPENING_CASH, 'Fictional opening capital')
  for (const row of PAYROLL_LINES.filter(row => state.posted.includes(row.id))) {
    const id = `JRN-${row.id}`, desc = `${row.employee} · ${row.run} · payroll recognition`
    add(id, row.date, 'wages', row.gross, 0, desc, row.id)
    add(id, row.date, 'superExpense', row.superannuation, 0, desc, row.id)
    add(id, row.date, 'wagesPayable', 0, row.net, desc, row.id)
    add(id, row.date, 'tax', 0, row.withholding, desc, row.id)
    add(id, row.date, 'deductions', 0, row.deductions, desc, row.id)
    add(id, row.date, 'superPayable', 0, row.superannuation, desc, row.id)
  }
  for (const payment of state.payments.filter(p => p.status === 'Settled')) {
    for (const a of payment.allocations) {
      add(payment.id, payment.date, 'wagesPayable', a.amount, 0, `Employee settlement · ${payment.id}`, a.lineId, payment.id)
      add(payment.id, payment.date, 'bank', 0, a.amount, `Employee settlement · ${payment.id}`, a.lineId, payment.id)
    }
  }
  // Historical fixture remittances through July. August onwards remains payable.
  // This is demo scheduling, not a statutory due-date rule or verified bank evidence.
  for (const row of PAYROLL_LINES.filter(row => row.date < '2026-08-01' && state.posted.includes(row.id))) {
    for (const [account, amount] of [['tax', row.withholding], ['deductions', row.deductions], ['superPayable', row.superannuation]] as const) {
      const id = `REMIT-${row.id}-${account}`, date = `${row.date.slice(0, 7)}-29`
      add(id, date, account, amount, 0, 'Historical mock remittance', row.id)
      add(id, date, 'bank', 0, amount, 'Historical mock remittance', row.id)
    }
  }
  return lines
}
export function accountBalance(lines: JournalLine[], account: Account, beforeOrThrough: string, exclusive = false) {
  const debitNormal = account === 'bank' || EXPENSE_ACCOUNTS.some(a => a === account)
  return sum(lines.filter(l => l.account === account && (exclusive ? l.date < beforeOrThrough : l.date <= beforeOrThrough)).map(l => debitNormal ? l.debit - l.credit : l.credit - l.debit))
}
export function payrollReport(state: PayrollState, from: string, to: string) {
  const journal = payrollJournal(state)
  const expense = (account: Account) => accountBalance(journal, account, to) - accountBalance(journal, account, from, true)
  const wages = expense('wages'), superExpense = expense('superExpense')
  const bank = accountBalance(journal, 'bank', to), liabilities = sum(PAYABLE_ACCOUNTS.map(a => accountBalance(journal, a, to)))
  const cumulativeLoss = accountBalance(journal, 'wages', to) + accountBalance(journal, 'superExpense', to)
  const capital = accountBalance(journal, 'capital', to), equity = capital - cumulativeLoss
  return { journal, wages, superExpense, expense: wages + superExpense, bank, liabilities, capital, cumulativeLoss, equity, balanceDifference: bank - liabilities - equity }
}

export type PayrollAction =
  | { type: 'review'; lineId: string; status: PayrollDecision['status']; note: string; reviewer: string }
  | { type: 'post' | 'pay'; lineId: string; note: string; reviewer: string }
  | { type: 'bank'; paymentId: string; bankId: string | null; decision: 'confirm' | 'reject'; note: string; reviewer: string }

export function applyPayrollAction(current: PayrollState, action: PayrollAction, revision: number, at: string): PayrollState {
  if (current.revision !== revision) throw new Error('Payroll changed in another tab. Reload before saving.')
  if (!action.reviewer.trim() || action.reviewer.length > 100 || !action.note.trim() || action.note.length > 2000) throw new Error('Add your reviewer name and an evidence note (up to 2,000 characters).')
  const state = structuredClone(current), note = action.note.trim(), reviewer = action.reviewer.trim()
  if (action.type === 'bank') {
    const payment = state.payments.find(p => p.id === action.paymentId)
    if (!payment || payment.status !== 'Settled') throw new Error('Only settled payments can be bank-reconciled.')
    if (action.decision === 'confirm') {
      const bank = state.banks.find(b => b.id === action.bankId)
      if (!bank || bank.currency !== payment.currency || bank.amount !== payment.amount) throw new Error('The selected bank total/currency differs. Keep it for review; do not force a match.')
      if (sum(payment.allocations.map(a => a.amount)) !== payment.amount) throw new Error('Payment allocations do not add up to its total.')
      if (bankOwner(state, bank.id, payment.id)) throw new Error('That bank line is already assigned to another payment.')
    }
    state.bankReviews[payment.id] = { bankId: action.bankId, action: action.decision, note, reviewer, at }
  } else {
    const row = PAYROLL_LINES.find(row => row.id === action.lineId)
    if (!row) throw new Error('Unknown payroll line.')
    if (action.type === 'review') {
      if (!['Approved', 'Needs changes'].includes(action.status)) throw new Error('Invalid review decision.')
      state.reviews[row.id] = { status: action.status, note, reviewer, at }
    } else {
      if (state.reviews[row.id]?.status !== 'Approved') throw new Error('Approve the payroll evidence before posting or simulating payment.')
      if (action.type === 'post') {
        if (state.posted.includes(row.id)) throw new Error('Already posted. No duplicate journal was created.')
        state.posted.push(row.id)
      } else {
        if (!state.posted.includes(row.id)) throw new Error('Post payroll before simulating payment.')
        const amount = row.net - paidAmount(state, row.id)
        if (amount <= 0) throw new Error('No unpaid balance. No duplicate payment was created.')
        const id = `SIM-${row.id}-${state.revision + 1}`
        state.payments.push({ id, date: row.date, amount, currency: 'AUD', status: 'Settled', reference: id, allocations: [{ lineId: row.id, amount }] })
        state.banks.push({ id: `BANK-${id}`, date: row.date, amount, currency: 'AUD', reference: id, paymentIds: [id] })
      }
    }
  }
  state.revision += 1
  state.history.push({ action: action.type === 'bank' ? `bank-${action.decision}` : action.type, target: action.type === 'bank' ? action.paymentId : action.lineId, note, reviewer, at })
  return state
}
