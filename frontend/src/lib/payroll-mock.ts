// Deterministic synthetic register; not a tax, award, leave or super calculator.
// All arithmetic is in cents. Rates below are illustrative fixture assumptions.
export type PayrollLine = {
  id: string; run: string; employeeId: string; employee: string; department: string; employment: 'Full time' | 'Part time'
  date: string; status: 'Paid' | 'Draft'; base: number; overtime: number; allowance: number; bonus: number
  gross: number; withholding: number; deductions: number; net: number; superannuation: number; employerCost: number
  confidence: number; reason: string
}
export const PAYROLL_SOURCE = 'Mock payroll · fictional employees · AUD'
export const PAYROLL_EMPLOYEES = [
  ['EMP-001', 'Alex Morgan', 'Operations', 640000], ['EMP-002', 'Jamie Chen', 'Finance', 720000],
  ['EMP-003', 'Taylor Smith', 'Sales', 600000], ['EMP-004', 'Jordan Lee', 'Operations', 560000],
  ['EMP-005', 'Casey Wilson', 'Technology', 880000], ['EMP-006', 'Riley Brown', 'Technology', 790000],
  ['EMP-007', 'Sam Patel', 'Finance', 580000], ['EMP-008', 'Morgan Davis', 'Sales', 620000],
  ['EMP-009', 'Avery Nguyen', 'Operations', 510000], ['EMP-010', 'Charlie Evans', 'People', 650000],
  ['EMP-011', 'Quinn Thomas', 'People', 340000], ['EMP-012', 'Dakota Walker', 'Operations', 320000],
] as const

export function generateMockPayroll(): PayrollLine[] {
  return Array.from({ length: 9 }, (_, month) => PAYROLL_EMPLOYEES.map(([employeeId, employee, department, base], index): PayrollLine => {
    const period = `2026-${String(month + 1).padStart(2, '0')}`
    const overtime = department === 'Operations' ? (month % 3 + 1) * 12500 : 0
    const allowance = department === 'Sales' ? 18000 : 5000
    const bonus = department === 'Sales' && (month + 1) % 3 === 0 ? 150000 : 0
    const gross = base + overtime + allowance + bonus
    const withholding = Math.round(gross * (index >= 10 ? 0.14 : 0.23))
    const deductions = index % 4 === 0 ? 4500 : 0
    const superannuation = Math.round((base + allowance + bonus) * 0.12)
    const reason = month === 8 && index === 3 ? 'Overtime timesheet approval is missing (mock exception).'
      : month === 8 && index === 2 ? 'Quarterly bonus approval needs confirmation (mock exception).'
      : month === 7 && index === 7 ? 'Allowance supporting receipt is missing (mock exception).' : ''
    return { id: `MOCK-${period}-${employeeId}`, run: `PAY-${period}`, employeeId, employee, department,
      employment: index >= 10 ? 'Part time' : 'Full time', date: `${period}-28`, status: month === 8 ? 'Draft' : 'Paid',
      base, overtime, allowance, bonus, gross, withholding, deductions, net: gross - withholding - deductions,
      superannuation, employerCost: gross + superannuation, confidence: reason ? (index === 2 ? 0.62 : 0.68) : 0.98, reason }
  })).flat()
}
export const PAYROLL_LINES = generateMockPayroll()
export type PayrollFilters = { from: string; to: string; department: string; status: string; search: string; lowOnly: boolean }
export function filterPayroll(rows: PayrollLine[], filters: PayrollFilters) {
  if (!filters.from || !filters.to || filters.from > filters.to) return []
  return rows.filter(row => row.date >= filters.from && row.date <= filters.to
    && (!filters.department || row.department === filters.department) && (!filters.status || row.status === filters.status)
    && (!filters.lowOnly || row.confidence <= 0.7)
    && `${row.employee} ${row.employeeId} ${row.run}`.toLowerCase().includes(filters.search.trim().toLowerCase()))
}
export function payrollTotals(rows: PayrollLine[]) {
  return rows.reduce((total, row) => ({ gross: total.gross + row.gross, net: total.net + row.net, withholding: total.withholding + row.withholding,
    deductions: total.deductions + row.deductions, superannuation: total.superannuation + row.superannuation, employerCost: total.employerCost + row.employerCost }),
  { gross: 0, net: 0, withholding: 0, deductions: 0, superannuation: 0, employerCost: 0 })
}
export function payrollMonthly(rows: PayrollLine[]) {
  return Array.from(new Set(rows.map(row => row.date.slice(0, 7)))).sort().map(month => ({ month, ...payrollTotals(rows.filter(row => row.date.startsWith(month))) }))
}
export function payrollAssistantContext() {
  return `MOCK payroll, not live customer data. Full register (not current page filters): Jan–Sep 2026, AUD, 12 fictional employees, 108 employee/pay-run lines. All stored amounts in cents. Totals: ${JSON.stringify(payrollTotals(PAYROLL_LINES))}. Monthly: ${JSON.stringify(payrollMonthly(PAYROLL_LINES))}. Three illustrative low-confidence exceptions; scores are fixtures, not AI probabilities. Withholding and super are illustrative only, not statutory calculations. Review/payment states are separate. Never imply payroll payments were sent or this register is posted to P&L.`
}
