# Payroll Demo finance workflow

This is a fictional AUD company, isolated from downloaded Xero/QuickBooks data. It has no employee portal, real payments, tax engine, or production identity/role enforcement.

## Try the workflow

- Open Payroll. January–August are historical posted fixtures; September starts unposted.
- Inspect a September payslip, enter a self-declared reviewer and an evidence note, then save an approval.
- **Post to demo ledger** recognizes wages and employer super as expense, offset by net wages, withholding, deductions and super liabilities.
- **Simulate remaining payment** settles only the remaining net wages; it creates mock payment/bank evidence. It never calls a banking API or recognizes expense again. Posting and payment use the payslip's displayed demo pay date, while audit entries use the action timestamp.
- Use the Payroll Demo links to open P&L, Balance Sheet or Report Explorer. Other sources remain unchanged. Click an account to trace journals, then follow a payslip link back to payment evidence.
- Changing an approval does not reverse a journal. Corrections/reversals are not implemented; no silent edits to posted amounts are allowed.

## Exception fixtures (August 2026)

| Employee | Scenario |
| --- | --- |
| EMP-001 | $100 net pay remains outstanding |
| EMP-002 | Two payments settle one payslip |
| EMP-003 | Failed payment, no cash movement |
| EMP-004 / EMP-005 | One batch with two allocations, reconciled at full batch total |
| EMP-006 | Referenced bank variance and same-amount unreferenced candidate; human review required |
| EMP-008 | Missing allowance receipt; previous browser review preserved |

Candidates never constitute approval. Auto-reconciliation requires an unambiguous payment reference, matching AUD amount, valid allocation total and nearby date. Bank lines cannot be reused for different payments. Manual matching requires a reviewer, evidence note and equal amount/currency. Differences remain unmatched; no forced adjustment is posted.

## Accounting and storage

All calculations use integer cents. Every journal balances. Opening is $1.5m bank funded by capital on 31 December 2025. Payroll-only earnings are negative cumulative recognized expense, not a balancing plug. Historical mock tax, deduction and super remittances through July are generated separately; later amounts remain payable. These dates/rates are fixture assumptions, not statutory guidance. Imported bank candidates are evidence only and never add duplicate cash movements.

Workflow is saved in origin-scoped IndexedDB (`payroll-workflow:demo-v1`). Legacy payroll review records are copied once without deleting originals. Revision checks and writes share one transaction; stale edits are rejected. Changes refresh same-tab consumers and notify other tabs. Export the audit JSON and spreadsheets before clearing browser data. There is no cloud backup, cross-device sync or audit re-import UI.

Tests cover balanced journals, date cut-offs, P&L/BS consistency, partial/split/batch/failed payments, duplicate prevention, candidate review, migration and concurrent browser writes.
