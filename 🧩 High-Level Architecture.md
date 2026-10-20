# QFR High-Level Architecture

Documentation reviewed: **2026-10-15T11:11:41+11:00** (AEDT; 00:11:41 UTC).
Code baseline: `ec60f88`, committed **2026-10-13T14:27:16+11:00**.
This architecture assessment concerns the version-controlled implementation.

The [technical progress report](docs/technical-progress-2026-10-15.md) records
major milestones, exact commit timestamps, AI/feature/security changes and
remaining limitations. This document describes current architecture, not a
claim that every feature is production-ready.

## 1. Purpose and system boundaries

QFR converts accounting evidence into line-level reports, reviewable mapping
decisions and traceable financial views. It combines Python acquisition/report
pipelines with a separate Next.js dashboard. Financial arithmetic, ledger
postings and matching gates are deterministic; AI proposes classifications,
reads invoice fields and explains supplied context.

There are three distinct financial sources:

| Source | Pipeline | Dashboard representation |
| --- | --- | --- |
| Xero | OAuth → reports/transactions → QFR mapping → report outputs | Demo fixtures; no automatic consumption of Python report output |
| QuickBooks | Independent OAuth/download → P&L reconstruction / opening-plus-ledger BS rebuild → frontend exporter | Exported downloaded snapshot, not live OAuth |
| Payroll Demo | Fictional register → review → balanced ledger → simulated settlement | Shared payroll source for P&L, BS and Report Explorer |

Imported spreadsheets produce independent category summaries, not automatic
full financial statements or additions to Xero/QuickBooks totals. Invoice
reconciliation is a separate evidence/review workflow; it does not post payments.

## 2. Python reporting pipelines

### Xero and QFR mapping

`login_xero.py` authorizes an organization. `run_mvp.py` pulls P&L, opening/
closing Balance Sheets, accounts, invoices/bills, bank activity, payments,
credit notes and journals, with optional Finance/payroll evidence where authorized.

Line mapping follows deterministic rules, versioned context-aware memory,
OpenAI proposal, strict output validation and policy guards. Invalid proposals
become auditable unresolved/fallback results. Category, confidence and reason
are validated; the score is not a calibrated probability. The active mapper
is `ai/openai_mapper.py`; Gemini remains an optional/legacy path. Memory writes
use locking and atomic replacement; mapping concurrency and timeouts are bounded.

Outputs include Excel, CSV, JSON, HTML and reconciliation/debug evidence under
`output/`. Frontend browser decisions are not automatically synchronized back
into this pipeline. `export_reviewed_reports.py` reads legacy server-saved review
files, not browser IndexedDB.

### QuickBooks source-account reconstruction

The `quickbooks/` package has separate configuration, credentials, callback,
token and output locations. OAuth verifies state and supports rotating refresh
tokens. The acquisition client downloads paginated entities and standard
reports read-only, preserving raw JSON and a manifest.

- `login_quickbooks.py`: local authorization.
- `download_quickbooks_data.py`: entities, reports and opening BS snapshot.
- `run_quickbooks.py`: validates source-detail totals, hides source/split
  accounts from AI, classifies into the official P&L account hierarchy and
  compares reconstruction with official totals.
- `run_quickbooks_balance_sheet.py`: opening balances plus dated GL movements,
  per-line before/after balances and closing-report comparison. Revenue and
  expense movements roll into Net Income. No LLM performs this reconstruction.
- `export_quickbooks_frontend_data.py`: exports report results for dashboard use.

This is an implemented frontend snapshot path, but still not a canonical
QuickBooks adapter inside Xero's `run_mvp.py`. See [connector details](quickbooks/README.md).

## 3. Frontend structure and routes

The standalone `frontend/` app uses Next.js 16, React 19, TypeScript,
Tailwind, Recharts, SheetJS, unpdf and Vitest. The configured runtime is Node 22.x.
The dashboard layout mounts navigation and a floating assistant.

| Route | Responsibility |
| --- | --- |
| `/` | Redirect to `/link-data` |
| `/login` | Demo login and optional session AI key |
| `/link-data` | Simulated connector stages/success, then AI Insights; entry to file intake |
| `/ai-insights` | Visual progress flow, not evidence that a real pipeline was executed |
| `/profit-loss` | Source-specific P&L, filters, mapping review, exports |
| `/balance-sheet` | Source-specific balances, ratios, movements and review |
| `/report-trace` | Report Explorer and underlying evidence |
| `/imports` | Spreadsheet intake, validation and independent summaries |
| `/payroll` | Demo payroll finance workflow |
| `/reconciliation` | Invoice/statement evidence, candidate review and audit |

`report-source.ts` manages Xero, QuickBooks and Payroll selections. Liabilities
are exposed credit-positive; working capital and current ratio use current-only
assets/liabilities. Income classification uses categories/line roles, not the
first digit of a QuickBooks account ID.

Review gates include source ReviewRequired, Unmapped and confidence at or below
the threshold. P&L saved decisions affect classifications, charts and exports
while preserving original AI proposals/amounts. BS decisions are audit records,
not edits to official balances. Unsaved drafts are not exported as approved.

## 4. Invoice reconciliation and AI evidence

The statement is parsed independently. The model receives invoice content,
not statement targets or visual benchmark answers. Original bytes, SHA-256,
printed fields, model metadata and evidence are retained.

```text
Invoice original → whole-page/crop extraction → field validation / independent checks
Statement       → all parsed lines          → global exact-match and candidate search
                                             → explicit human review
                                             → preserved original + revision history
```

The extraction route uses strict JSON Schema and independent runtime validation.
Full-page and crop views improve readability without replacing originals.
Independent amount rereads retain conflicting values. Model repetition is not
independent OCR proof. Only globally unique exact ID/signed-amount matches that
pass evidence checks are automatic; duplicate, weak, conflicting or incomplete
evidence remains reviewable.

Candidate ranking searches all parsed statement lines and identifiers, offering
up to five supported alternatives. Ranking is deterministic, not another AI
call or a confidence guarantee. Selecting a candidate scrolls/highlights its
line but does not approve it. Review stores reasons, field revisions, selected
line, self-declared reviewer/role and timestamps. Materiality/manager rules
are demo controls; occupied lines cannot be silently reused.

Statement PDF parsing uses JavaScript `unpdf`, not external `pdftotext`.
It supports particular text layouts, not arbitrary bank templates/scanned PDFs.
The optional independent invoice locator uses macOS Vision/Swift; missing OCR
on Linux/Vercel requires manual ID review and cannot provide equivalent boxes.
Highlights need evidence coordinates, not guessed rectangles.

The code configures a default invoice model and reasoning effort, with environment
overrides; this is configuration, not a provider-availability promise. Request
size/count limits and time budgets are enforced; Responses uses `store: false`,
which is not a blanket guarantee about all provider retention.

See [evidence controls](docs/reconciliation-evidence-plan.md) and the explicitly
historical [2026-10-01 API experiment](docs/reconciliation-api-reproduction.md).

## 5. Imports, lineage and persistence

Spreadsheet intake supports CSV/XLSX/XLS with sheet/column/date mapping and
limits of 3 MB, 10,000 rows, 100 columns and 30 sheets. Invalid monetary/date
values, formula financial inputs, mixed currencies and conflicting source IDs
block commitment. Duplicate policies are explicit; committed batches retain
original row numbers, bytes and hashes rather than being edited in place.

Report Explorer links aggregate figures to source lines and attachments.
PDF/PNG/JPEG attachments are scoped to source, company, dataset and record.
A linked document is evidence, not automatic approval.

The dashboard uses origin-scoped IndexedDB (`qfr-browser-data-v1`) for uploads,
Blob originals, batches, attachments, review snapshots and payroll state.
Downloads/previews use browser object URLs instead of developer-machine paths.
Hash checks protect original-file consistency. Stable IDs, dataset scopes,
revisions and same-transaction checks reject stale/conflicting writes.

No database, cloud backup, cross-device synchronization or general audit re-import
UI is implemented. Browser eviction, clearing site data or changing origins can
make records unavailable; export/download before removal. Localhost, preview and
production origins are separate. Legacy filesystem APIs remain but are not the
dashboard's storage route and need their own durability if used directly.

## 6. Payroll finance workflow

The fictional AUD company has 12 employees, 9 months (Jan–Sep 2026), and
108 payslips. Integer cents drive all calculations; rates and confidence cases
are illustrative fixtures, not a tax/award engine.

```text
Review approval → ledger posting → simulated remaining payment → bank reconciliation
                     │                         │
                     ├─ P&L: wages + super     └─ BS: reduce cash and net wages payable
                     └─ BS: payroll liabilities
```

Approval is not posting/payment. Posting recognizes wages and employer super
expenses with corresponding net wages, withholding, deductions and super
liabilities. Payment settles net wages only, without recognizing expense twice.
Duplicate posting and excess repeat settlement are blocked.

January–August are historical posted fixtures; September starts unposted.
Opening cash/capital is AUD 1.5m on 2025-12-31. Historical tax/deduction/super
remittances through July are separate fixture entries. Equity is opening capital
minus recognized expenses, not a balancing plug.

Partial, split, failed, batch and ambiguous-reference fixtures exercise bank
matching. Automatic matching requires unique reference, equal amount/currency,
valid allocation total and nearby date. Manual bank matching requires reviewer,
evidence note and matching amounts; bank lines cannot be reused. Differences
do not trigger forced adjustment journals.

Workflow revisions and migration preserve prior browser reviews. Same-tab
refresh and cross-tab notifications update reports. Demo posting/payment uses
the displayed pay date; audit records use the actual action timestamp.
No employee portal, real bank API, statutory engine, posted-journal reversal or
trusted approval identity exists. See [Payroll workflow](frontend/docs/payroll-demo.md).

## 7. Assistant and credential flow

The floating assistant sends a deterministic draft, summary and sample context
to `/api/ai-insights` for explanation. Payroll routes/source use full-period
workflow/ledger context, including revisions and payment status, not just visible
filtered rows. Non-payroll context still primarily uses static demo data and
must not be described as fully synchronized with selected QuickBooks filters.
Failure is shown as AI unavailable, not silently reported as a successful answer.

A login key is submitted to `/api/session-key`. Server resolution prioritizes
the HttpOnly session cookie, then `OPENAI_API_KEY_QFR`, then `OPENAI_API_KEY`.
The cookie uses SameSite=Strict and production Secure; configuration responses
use no-store. Legacy browser key fields are cleared. Keys must not be public
environment variables. The cookie still exists in the browser: this is not an
encrypted server-side credential vault.

## 8. Security controls and production gaps

Implemented consistency controls include schema/runtime checks, hashes,
revision conflicts, original-versus-reviewed separation, accounting gates,
upload limits and targeted build-tracing exclusions for four legacy archive APIs.
These are not a production security certification.

Critical gaps remain:

- Login is hardcoded client-side demo authentication. The proxy matcher only
  covers root/login; it does not secure all dashboard/API paths.
- Reviewer identity and finance/manager roles are self-declared, not trusted RBAC.
- AI routes lack a uniform real-user/tenant authorization and rate/cost-control
  layer. Server-funded keys require those protections before production use.
- Existing Origin checks on legacy data APIs are not universal CSRF protection.
- Browser storage is not encrypted tenant isolation, immutable audit or cloud backup.
- Financial uploads leave the browser for AI analysis. Consent, data minimization,
  sensitive snapshot review and prompt-injection controls need production attention.

This documentation update does not implement those missing controls. See the
[security milestone and priorities](docs/technical-progress-2026-10-15.md#milestone-09-security-and-integrity---implemented-controls-and-gaps).

## 9. Verification and deployment status

On **2026-10-15T11:11:32+11:00**, non-live frontend tests ran: **27 files and
179 tests passed; 2 files / 2 tests skipped**. TypeScript `--noEmit` passed
(result checked at **11:11:41+11:00**). Live financial-image tests were disabled.

No fresh production build, browser acceptance, Python full-pipeline run,
paid-model experiment or penetration test was performed for this documentation
update. Historical tests remain dated evidence, not current deployment proof.
Use `frontend` as the deployment root with Node 22.x. Target-environment acceptance
and release records belong to the operational adoption process.
