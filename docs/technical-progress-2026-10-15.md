# QFR Technical Development and Assurance Report

## Document Control

| Item | Detail |
| --- | --- |
| Report reference | QFR-TECH-2026-10-15 |
| Edition | Government technical review edition |
| Report date | 15 October 2026 |
| Reporting period | 5 August–13 October 2026 |
| Technical assessment baseline | 2026-10-15T11:11:41+11:00 (AEDT, Australia/Melbourne) |
| Equivalent UTC timestamp | 2026-10-15T00:11:41Z |
| Source-code baseline | `ec60f88` |
| Latest feature commit | 2026-10-13T14:27:16+11:00 |
| Evidence basis | Version-controlled implementation, recorded tests and retained experiment reports |
| Assessment scope | Software development outcomes, AI application, financial-data controls and readiness requirements |

## Executive Summary

### Purpose and Project Objectives

This report presents the development of QFR, a financial reporting and reconciliation
prototype, for government technical review. It documents implementation milestones,
the role of artificial intelligence, financial-data integrity controls, recorded
verification activities and requirements for operational adoption.

The project objectives are to improve the traceability of accounting information,
support consistent line-level reporting, assist reviewers in resolving documentary
differences and demonstrate the connection between payroll, accounting entries and
financial statements. These are design objectives; this report does not claim
measured productivity savings or population-level recognition accuracy.

### Principal Development Outcomes

1. **Data acquisition and reporting:** implemented separate Xero and QuickBooks
   workflows, QuickBooks report reconstruction and frontend source selection.
2. **Evidence and human review:** implemented document intake, source-file retention,
   line-level tracing, invoice extraction, candidate matching and recorded decisions.
3. **Payroll demonstration:** connected fictional payslips, approval, ledger posting,
   simulated payments and bank evidence to a separate set of financial reports.
4. **AI oversight and data integrity:** separated model suggestions from accounting
   calculations, retained conflicting evidence and introduced validation and review gates.

AI supports classification, document-field extraction and explanation. Deterministic
software controls amounts, debit/credit relationships, balances and matching rules.
Development in the reporting period focused on prompts, image inputs, validation,
context and workflow integration; it did not include model training or fine-tuning.

### Scope and Evidence Conventions

The assessment concerns the version-controlled implementation and the test records
identified in this report. Milestone timestamps identify Git commits and retain their
original timezone offsets: AEST (UTC+10) for the listed August–September and October 2
commits, and AEDT (UTC+11) for the listed commits from October 6. They are implementation
traceability references, not operational release dates.

The current system includes demonstration components and self-declared reviewer roles.
Requirements for production identity, authorization and data governance are presented
in Milestone 09. This report is a technical development assessment, not an independent
security certification, statutory payroll assessment or authorization for production use.

### Commit Timeline

| Timestamp (original Git offset) | Commit | Major milestone |
| --- | --- | --- |
| 2026-08-05T15:16:06+10:00 | `ea5ad77` | QuickBooks acquisition pipeline |
| 2026-08-05T17:45:47+10:00 | `cadb311` | QuickBooks blind P&L classification and comparison |
| 2026-08-20T14:24:07+10:00 | `63c54a7` | Link to Data; opening-balance-plus-line-movement BS reconstruction |
| 2026-08-25T13:57:37+10:00 | `166ca05` | QuickBooks frontend snapshot export and report-source selection |
| 2026-09-08T10:58:22+10:00 | `7280e23` | Cola reconciliation scripts and scan samples added |
| 2026-09-08T14:53:28+10:00 | `7e2a19c` | Reconciliation UI and extraction endpoint |
| 2026-09-08T15:04:18+10:00 | `8a6969a` | Login API-key input and session-cookie flow |
| 2026-09-15T11:16:43+10:00 | `237a4eb` | JavaScript statement PDF parsing; removal of this path's pdftotext dependency |
| 2026-09-15T11:27:56+10:00 | `09391b4` | Balance Sheet confidence and review display |
| 2026-10-02T09:32:28+10:00 | `83865fe` | AI evidence controls, human review, upload validation and Report Explorer |
| 2026-10-06T13:51:39+11:00 | `b88b669` | Browser file/review storage and initial Payroll module |
| 2026-10-08T16:37:24+11:00 | `6dacc65` | Multiple review candidates, target highlighting and build-tracing exclusions |
| 2026-10-13T14:27:16+11:00 | `ec60f88` | Payroll ledger, payments, bank review and integration with both financial reports |

## Milestone 01: Data Integration and Multiple Reporting Sources

**Timestamps: 2026-08-05T15:16:06+10:00 → 2026-08-25T13:57:37+10:00**  
**Commits: `ea5ad77`, `cadb311`, `63c54a7`, `166ca05`.**

### Functional Development

- Added independent QuickBooks OAuth, paginated entity acquisition, standard-report downloads and a manifest, separate from Xero.
- P&L reconstruction targets the downloaded official account hierarchy and retains differences from official totals.
- Balance Sheet reconstruction starts from a selected opening snapshot, accumulates General Ledger records, records each line's before/after balance and compares the endpoint.
- `export_quickbooks_frontend_data.py` produces frontend snapshots; P&L and Balance Sheet support source selection.
- Link to Data becomes the entry page: Xero/QuickBooks show staged animation, progress and success feedback before AI Insights.

### AI Application and Development

- QuickBooks blind P&L classification hides original and split-account fields to reduce answer leakage.
- Classification remains separate from comparison against official results; BS reconstruction does not call an LLM.
- Xero's rules-first → contextual cache → AI → strict validation sequence is an existing foundation, not newly trained capability.

### Security and Controls

- QuickBooks credentials, tokens, callbacks and output directories remain separate from Xero; the acquisition client is read-only in purpose.
- Closing differences remain visible; entries and balances are not fabricated to force reconciliation.

**Implementation scope and operating conditions:** Link to Data animations do not perform browser OAuth or live downloads. Frontend QuickBooks data is an exported snapshot; Xero pages still use demo data. The two Python pipelines are not automatically merged.

**Implementation references:** `quickbooks/`, `run_quickbooks.py`, `run_quickbooks_balance_sheet.py`, `export_quickbooks_frontend_data.py`, `frontend/src/lib/report-source.ts`.

## Milestone 02: P&L and Balance Sheet Consistency and Human Review

**Timestamps: 2026-09-15T11:27:56+10:00; extended 2026-10-02T09:32:28+10:00.**  
**Commits: `09391b4`, `83865fe`.**

### Functional Development

- Added Balance Sheet low-confidence/manual review, reasons and saved review status.
- Separated P&L drafts from saved decisions: saved classifications affect pages, charts and exports while original AI proposals and amounts remain intact.
- Balance Sheet review records evidence/classification decisions without directly changing official balances.
- Standardized liabilities as credit-positive; working capital and current ratio use only current assets and current liabilities.
- Income detection uses categories/line roles rather than treating the first digit of a QuickBooks account ID as a Xero account code.

### AI Application and Development

- ReviewRequired, Unmapped and confidence ≤ threshold jointly determine review eligibility.
- Original AI scores, proposals, rule provenance and human outcomes are stored separately so human confirmation does not become the original AI judgment.

### Security and Controls

- Stable line IDs, dataset hashes, source/period scopes and revisions prevent filtered-row misbinding and inherited approvals across changed datasets.
- Conflicting concurrent edits are rejected instead of overwriting another decision.

**Implementation scope and operating conditions:** Confidence is a model/rule score, not calibrated accuracy. Review is not formal financial authorization.

**Implementation references:** `mapping-reviews.ts`, `use-mapping-reviews.ts`, `balance-sheet-review.ts`, `balance-sheet-metrics.ts`, `report-utils.ts` under `frontend/src/lib/`.

## Milestone 03: Reconciliation AI Extraction and Independent Evidence

**Timestamps: 2026-09-08T14:53:28+10:00; major hardening 2026-10-02T09:32:28+10:00.**  
**Commits: `7e2a19c`, `83865fe`; historical experiment date: 2026-10-01.**

### AI Application and Development

- The model receives invoices only, not statement candidates, target amounts or visual-baseline answers.
- Original image bytes are preserved. Extraction uses full-page views plus original-colour/enhanced portrait crops to improve small-text readability.
- The assessed code specifies `gpt-6-astra`, high reasoning and `detail: original`, with server-side configuration overrides.
- Independent total-region rereading excludes the first guess and preserves both readings and conflict reasons.
- Strict JSON Schema is supplemented by runtime type, amount, index-uniqueness and completeness validation.
- Invoice-ID verification requires independent local OCR; repeated text from the same model is not independent evidence.

### Functional Development

- Displays originals, ID/final-amount evidence, processing stages, match reasons and differences.
- Audits preserve file SHA-256, image views, requested/served models, response IDs, token usage and timestamps.
- Exact IDs with different amounts retain the discrepancy rather than substituting statement values into the invoice.

### Security and Controls

- Original extraction remains separate from human corrections; model output cannot directly rewrite the statement or trigger payment.
- Reconciliation Responses requests use `store: false`; this does not disable every provider log, retention mechanism or organizational compliance obligation.
- File-count/byte limits, timeouts and reread budgets are bounded. Failure leads to review, not fabricated values.

**Implementation scope and operating conditions:** Independent ID localization uses macOS Vision/Swift. When this OCR is absent on Linux/Vercel, IDs conservatively require review; equivalent highlighting or automatic verification rates are not promised. A historical 9/9 total-agreement run is agreement with that visual baseline, not 100% OCR accuracy.

**Implementation references:** `frontend/src/app/api/reconciliation/route.ts`, `invoice-evidence.ts`, `invoice-image-views.ts`, `invoice-amount-reread.ts`. See the [historical API reproduction record](reconciliation-api-reproduction.md).

## Milestone 04: Full-Statement Matching, Candidate Review and Target Highlighting

**Timestamps: review/matching gates 2026-10-02T09:32:28+10:00; candidate interaction 2026-10-08T16:37:24+11:00.**  
**Commits: `83865fe`, `6dacc65`.**

### Functional Development

- Globally unique exact ID plus signed-amount relationships are handled first; duplicates, many-to-one and ambiguous relationships remain reviewable.
- Up to five relevant candidates are recommended from all parsed statement records and identifiers, with line/page numbers, differences and reasons.
- Ranking considers exact IDs, OCR-confusable characters, text similarity and amounts; irrelevant rows are not added to fill five slots.
- Animation finishes by locating the leading candidate for the invoice under review. Selecting another candidate or a row from the full dropdown scrolls and highlights the target.
- Selection creates a draft only. A saved decision requires confirmed fields, a reason and a reviewer; occupied rows cannot be reassigned twice.
- Materiality-threshold results require a manager decision. Approval with an ID/amount difference remains an approved variance, not an exact match.

### AI Application and Development

- Candidate ranking is **deterministic recommendation logic**, not another AI call or a change that treats weak OCR as verified.
- Readings awaiting independent confirmation may support candidate discovery; they remain subject to human review and are not automatically accepted as reconciled evidence.

### Security and Controls

- Review requires archived originals and hash checks; revisions and before/after history are retained.
- Automatic outcomes, effective human decisions and review suggestions remain distinct in the audit.

**Implementation scope and operating conditions:** Manager/finance roles are self-declared, with no server-side RBAC. Local originals and audit history are not tamper-proof external evidence.

**Implementation references:** `reconciliation.ts`, `reconciliation-candidates.ts`, `reconciliation-review.ts`, `ReconciliationCandidates.tsx`, `ReconciliationReviewPanel.tsx`.

## Milestone 05: PDF Support and Vercel File Persistence

**Timestamps: 2026-09-15T11:16:43+10:00 → 2026-10-06T13:51:39+11:00; build-tracing changes 2026-10-08T16:37:24+11:00.**  
**Commits: `237a4eb`, `b88b669`, `6dacc65`.**

### Functional Development

- Statement PDF parsing now uses `unpdf` JavaScript text/coordinate extraction instead of system `pdftotext`.
- Uploads, import batches, originals, attachments, reconciliation snapshots and review decisions use browser IndexedDB.
- Files are stored as Blobs; previews/downloads use temporary object URLs rather than development-machine absolute paths.
- The dashboard no longer persists these records through legacy filesystem APIs, supporting the current no-database requirement.

### AI Application and Development

- Storage and AI extraction remain separate services. Document AI analysis uses server requests and transmits selected invoice content to the analysis provider; browser persistence does not change this processing boundary.

### Security and Controls

- Original-file integrity checks, idempotent batch identifiers and same-transaction conflict checks remain in place.
- Unavailable storage/quota errors are explicit. The UI explains same-browser/same-origin storage and the absence of cloud backup.
- Build tracing for four legacy archive APIs excludes `.env*`, output archives and related paths to reduce accidental packaging. This is not a repository-wide credential audit or universal leak-prevention guarantee.

**Implementation scope and operating conditions:** IndexedDB is not an encrypted vault or tenant boundary. Localhost, Vercel preview origins and production domains do not share records. Clearing site data may remove files. Statement parsing depends on supported text layouts, not arbitrary scanned PDFs/bank templates. Browser persistence does not remove analysis-upload limits.

**Implementation references:** `statement-parser.ts`, `browser-storage.ts`, `browser-data.ts`, `BrowserFileLink.tsx`, `frontend/next.config.ts`.

## Milestone 06: File Intake and Report Explorer

**Timestamps: 2026-10-02T09:32:28+10:00; browser persistence migration 2026-10-06T13:51:39+11:00.**  
**Commits: `83865fe`, `b88b669`.**

### Functional Development

- `/imports` supports CSV/XLSX/XLS, worksheet selection, column mapping, date-format selection, validation and commitment.
- Limits are 3 MB, 10,000 rows, 100 columns and 30 worksheets; originals can be downloaded and batches traced.
- Duplicate rows, repeated source IDs and cross-batch conflicts are handled separately; repeated uploads with identical bytes/context return the existing batch.
- `/report-trace` drills down from report amounts to transactions and original documents while preserving filters and saved classifications.
- PDF/PNG/JPEG originals and notes can be attached to records, scoped by source, company, snapshot and record.

### AI Application and Development

- Upload validation, column/category aggregation and tracing are deterministic. This intake path does not automatically send spreadsheets to AI.
- Unknown categories remain Unmapped; manually attached files are not treated as model-verified evidence.

### Security and Controls

- Formula cells are rejected as financial inputs to avoid treating stale formula caches as reliable amounts.
- Non-finite amounts, invalid precision/dates, missing fields, mixed currencies and conflicting source IDs block commitment.
- Committed batches cannot be edited in place; original row numbers, bytes and hashes are retained.

**Implementation scope and operating conditions:** Imported output is an independent category summary, not automatic double-entry accounting or integration into Xero/QuickBooks statements. Linking an attachment does not constitute reconciliation.

**Implementation references:** `data-intake.ts`, `import-store.ts`, `browser-data.ts`, `trace-model.ts`, `trace-data.ts`, `components/trace/`.

## Milestone 07: Payroll Integration with Accounting, Payments and Reports

**Timestamps: initial version 2026-10-06T13:51:39+11:00; integrated version 2026-10-13T14:27:16+11:00.**  
**Commits: `b88b669`, `ec60f88`.**

### Functional Development

- Added 12 fictional employees, nine payroll months and 108 payslips, calculated in integer AUD cents.
- The finance workspace supports filters, monthly charts, line-level details, pay components, low-confidence review and exports.
- Review, posting, payment and bank reconciliation are separate states; approval does not mark pay as paid.
- Posting recognizes wages/super expenses and net-wages, withholding, deduction and super liabilities.
- Simulated payments settle remaining net pay, reducing bank and wages payable without recognizing expenses again.
- P&L shows Wages & Salaries and Employer Superannuation. Balance Sheet derives closing balances from opening balances plus line movements.
- Reports, payslips, journals and payments link together; one payslip can have multiple payments and one batch can allocate to several employees.
- Exception fixtures cover underpayment, failed/split/batch payments, reference matches with amount differences and same-amount rows without references.
- Up to five bank candidates are offered, with selection/highlighting across all simulated bank lines; confirmation checks amount/currency, allocations and occupancy.

### AI Application and Development

- The assistant reads the current browser payroll-workflow snapshot instead of relying solely on the old mock Paid field.
- Context includes revisions, posted IDs, expenses, bank, liabilities, equity, paid amounts and reconciliation status.
- Prompts explicitly distinguish full January–September data from page filters, specify cent units and state that no real payment occurs.
- The LLM does not calculate or approve ledger entries, balances, payments or candidate matches.

### Security and Controls

- Approval precedes posting, and posting precedes simulated payment. Duplicate posting and payments beyond the remaining payable are rejected.
- Every journal balances. Equity is opening capital minus cumulative expense, not a balancing plug.
- Bank lines cannot be reused; unequal amounts cannot be forced into an approved bank match.
- Self-declared reviewer, evidence note, action time and revision are retained. Migration preserves old review records and stores.
- Cross-tab notifications and same-transaction revision checks reduce concurrent overwrites.

**Implementation scope and operating conditions:** Payroll Demo is a separate fictional AUD company, never mixed into real QuickBooks/Xero totals. There is no employee portal, bank API, payroll-tax engine or posted-journal correction/reversal workflow. Historical tax/super remittances are demo entries; the bank-candidate table contains employee-payment fixtures, not proof that the complete bank ledger is reconciled. Simulated accounting actions use displayed pay dates; audit entries use actual action times.

**Implementation references:** `payroll-ledger.ts`, `payroll-store.ts`, `use-payroll.ts`, `components/payroll/`. See [Payroll workflow](../frontend/docs/payroll-demo.md).

## Milestone 08: AI Assistant and API-Key Flow

**Timestamps: API-key flow 2026-09-08T15:04:18+10:00; payroll context 2026-10-06T13:51:39+11:00 and 2026-10-13T14:27:16+11:00.**  
**Commits: `8a6969a`, `b88b669`, `ec60f88`.**

### AI and Functional Development

- Login accepts a session OpenAI key, resolved in this order: session cookie → `OPENAI_API_KEY_QFR` → `OPENAI_API_KEY`.
- Assistant and invoice-extraction endpoints share this resolution path; users need not commit credentials to Git.
- The assistant code uses `gpt-4o-mini`, receiving deterministic drafts, summaries and sample rows for explanation.
- Payroll and Payroll Demo reports use dedicated workflow context; failed requests explicitly show AI unavailable.

### Credential Protection Controls

- The legacy `qfr_openai_api_key` sessionStorage field is no longer the key source and is cleared on login/logout.
- The server sets an HttpOnly, SameSite=Strict session cookie, with Secure in production. Set/clear responses use no-store.
- Keys are not placed in NEXT_PUBLIC environment variables; the configuration endpoint returns status, not the key.

**Implementation scope and operating conditions:** HttpOnly prevents ordinary page JavaScript from reading the cookie, but the key still resides in a browser cookie and accompanies same-site requests. There is no encrypted vault, genuine user-session system, uniform API authorization or usage quota. Non-payroll assistant context still primarily uses static demo data rather than all selected QuickBooks filters; this remains an improvement item.

**Implementation references:** `frontend/src/app/api/session-key/route.ts`, `openai-key.ts`, `auth.ts`, `FloatingAssistant.tsx`, `api/ai-insights/route.ts`.

## Milestone 09: Security and Integrity - Implemented Controls and Gaps

**Assessment timestamp: 2026-10-15T11:11:41+11:00.** The following assessment distinguishes implemented software controls from additional assurance requirements.

| Control area | Implemented measures | Additional assurance requirements |
| --- | --- | --- |
| Credential handling | HttpOnly, production Secure and SameSite cookie settings; environment fallback; no public frontend environment key | Centralized protected credential storage, authenticated sessions and consistent API authorization |
| Source-file integrity | Original bytes, SHA-256 checks, download validation and scoped identifiers | Storage encryption, malicious-file inspection and independently protected audit retention |
| AI result integrity | Schema/runtime validation; separation of original values and human decisions; candidates do not replace source evidence | Broader evaluation datasets, error monitoring and continued human review of uncertain results |
| Financial integrity | Integer cents, currency/direction checks, balanced journals, allocation controls and duplicate-action prevention | External bank confirmation and specialist review before real payroll or payment processing |
| Edit consistency | Stable IDs, snapshot hashes, revisions and atomic browser transactions | Trusted reviewer identities and cross-device/multi-tenant consistency where required |
| Request controls | Reconciliation byte/count/time limits and targeted archive API build-tracing exclusions | Consistent endpoint authorization, rate/cost controls and operational abuse monitoring |
| Approval workflow | Materiality thresholds, manager-review branch, evidence notes and decision history | Server-enforced roles, segregation of duties and an appropriate electronic approval framework |

### Required Work Before Production Adoption

1. **P0: Real authentication and API authorization.** `auth.ts` implements hardcoded demo login; `proxy.ts` matches only `/` and `/login`. It is not a security boundary for every dashboard/API route. AI endpoints need real user/tenant authorization before deploying shared server-funded keys.
2. **P0: Identity and permissions.** Reviewer names and finance/manager roles are self-declared. Trusted identity, role enforcement and segregation of duties cannot rely solely on frontend controls.
3. **P1: Request governance.** Add authorization, rate/cost limits, consistent input caps and error handling to paid AI endpoints. Legacy data API Origin checks are not universal and permit requests without Origin.
4. **P1: Data governance.** Cloud backup, cross-device recovery, encrypted centralized credential management, protected audit storage and comprehensive malicious-file checks are absent. Financial snapshots/scans in the repository need sensitivity review before publication.
5. **P1: AI data boundaries.** Explain outbound analysis content before upload; improve non-payroll source/filter isolation and prompt-injection safeguards. Instructions inside documents must not become trusted system instructions.
6. **P2: Operational readiness.** Improve Linux OCR, statement-template coverage, scanned-PDF support, deployment acceptance and monitoring. Credential lifecycle procedures should cover secure issuance, access, rotation and revocation.

## Milestone 10: Verification Evidence and Operational Readiness

### Recorded Verification Activities

| Timestamp | Activity | Recorded result and assessment scope |
| --- | --- | --- |
| 2026-10-01 (experiment date; precise UTC times retained in run directories) | Live invoice API experiments | Original inputs, responses and reading variations retained; results describe the tested sample |
| 2026-10-13 (prior development record) | Payroll browser checks, TypeScript and production build | Completion recorded during the Payroll integration work |
| 2026-10-15T11:11:32+11:00 | Non-live frontend regression suite | **27 test files passed, 2 skipped; 179 tests passed, 2 skipped** |
| 2026-10-15T11:11:41+11:00 (result-check time) | TypeScript `--noEmit` | Passed |

Regression coverage includes mapping review, statement PDF parsing, invoice-field
validation, candidate ranking, original-file and import persistence, concurrent
edits, payroll journal balancing and payment-state transitions. The October 15
suite excluded live paid-model tests. Historical API experiments are presented
separately from deterministic regression tests because they measure different
properties of the system.

Invoice results are reported as agreement with a visual transcription baseline.
A single run achieving 9/9 total agreement does not establish general OCR accuracy
or consistent performance on subsequent requests. Retained run records include
both agreement and disagreement, and uncertain fields remain subject to review.

### Operational Adoption Requirements

The implementation supports evaluation of the documented workflows. Before use
for real financial approvals or payroll operations, the following activities form
the proposed acceptance work:

1. Implement and test authenticated user identities, server-side roles and API
   authorization, including denied-access and cross-user isolation cases.
2. Establish approved storage, retention, backup and recovery arrangements for
   original documents and audit records.
3. Validate document processing on the target runtime and representative invoice
   and statement layouts, including degraded scans and conflicting fields.
4. Reconcile accounting outputs against independently confirmed source records
   and review payroll assumptions with the responsible finance specialists.
5. Complete target-environment acceptance testing, security assessment, monitoring
   and incident-response arrangements; retain dated results and accountable sign-off.

These activities are future acceptance requirements, separate from the completed
development and tests recorded above. The report does not assign an implementation
deadline or approval owner on behalf of a reviewing authority.

### Technical Assessment Conclusion

The assessed version implements an integrated prototype for source-specific
financial reporting, evidence-based reconciliation and payroll-accounting
demonstration. Its principal technical advances are line-level traceability,
separation of AI suggestions from deterministic financial calculations, preservation
of conflicting evidence, and human review with revision history.

The recorded regression results support the tested software behaviours.
Operational adoption depends on completing the identity, security, data-governance
and acceptance requirements identified in this report. Demonstration payment and
approval workflows remain distinct from authorized real-world financial execution.

## Supporting Technical Documentation

- [Root README](../README.md): pipeline entry points, report sources and review workflows.
- [High-Level Architecture](../🧩%20High-Level%20Architecture.md): modules, routes, processing boundaries and security architecture.
- [Frontend README](../frontend/README.md): application pages, runtime configuration and browser storage.
- [QuickBooks README](../quickbooks/README.md): acquisition, reconstruction and frontend snapshot integration.
- [Reconciliation Evidence Plan](reconciliation-evidence-plan.md): field validation, candidate review and evidence-preservation controls.
- [Historical API Reproduction Record](reconciliation-api-reproduction.md): 2026-10-01 experiment methods, retained results and reproduction procedures.
- [Payroll Workflow](../frontend/docs/payroll-demo.md): demonstration accounting, payments, bank matching and persistence.

## Glossary

| Term | Meaning in this report |
| --- | --- |
| P&L | Profit and Loss statement |
| BS | Balance Sheet |
| General Ledger | Account-level transaction records used to reconstruct balances |
| OCR | Optical character recognition |
| LLM | Large language model used for classification, extraction or explanation |
| RBAC | Role-based access control |
| SHA-256 | Hash function used to compare file bytes and identify changed content |
| IndexedDB | Browser-local database scoped to the browser profile and site origin |
| Snapshot | A fixed dataset exported for reporting, rather than a live source connection |
| Revision | A record version used to detect conflicting edits |
