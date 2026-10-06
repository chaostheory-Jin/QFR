import { describe, expect, it } from 'vitest'
import { PAYROLL_LINES, filterPayroll, generateMockPayroll, payrollMonthly, payrollTotals, type PayrollFilters } from './payroll-mock'
const filters: PayrollFilters = { from: '2026-01-01', to: '2026-09-30', search: '', status: '', department: '', lowOnly: false }
describe('mock payroll', () => {
  it('generates deterministic unique employee/pay-run lines, explicitly separate from real accounting data', () => {
    expect(generateMockPayroll()).toEqual(PAYROLL_LINES)
    expect(PAYROLL_LINES).toHaveLength(108)
    expect(new Set(PAYROLL_LINES.map(row => row.id)).size).toBe(108)
    expect(new Set(PAYROLL_LINES.map(row => row.employeeId)).size).toBe(12)
    expect(PAYROLL_LINES.every(row => row.id.startsWith('MOCK-'))).toBe(true)
  })
  it('balances every payslip to the cent and never deducts employer super from net pay', () => {
    for (const row of PAYROLL_LINES) {
      expect(row.gross).toBe(row.base + row.overtime + row.allowance + row.bonus)
      expect(row.net + row.withholding + row.deductions).toBe(row.gross)
      expect(row.employerCost).toBe(row.gross + row.superannuation)
      for (const amount of [row.base, row.overtime, row.allowance, row.bonus, row.gross, row.net, row.withholding, row.superannuation]) expect(Number.isSafeInteger(amount)).toBe(true)
    }
    const totals = payrollTotals(PAYROLL_LINES)
    expect(totals.gross).toBe(totals.net + totals.withholding + totals.deductions)
    expect(payrollMonthly(PAYROLL_LINES).reduce((sum, month) => sum + month.employerCost, 0)).toBe(totals.employerCost)
  })
  it('filters by pay date, department, employee, payment state and confidence consistently', () => {
    expect(filterPayroll(PAYROLL_LINES, { ...filters, from: '2026-09-28', to: '2026-09-28' })).toHaveLength(12)
    expect(filterPayroll(PAYROLL_LINES, { ...filters, status: 'Draft' })).toHaveLength(12)
    expect(filterPayroll(PAYROLL_LINES, { ...filters, lowOnly: true })).toHaveLength(3)
    expect(filterPayroll(PAYROLL_LINES, { ...filters, department: 'Sales', search: 'EMP-003', status: 'Draft' })).toHaveLength(1)
    expect(filterPayroll(PAYROLL_LINES, { ...filters, from: '2027-01-01' })).toHaveLength(0)
    expect(payrollTotals([]).net).toBe(0)
  })
})
