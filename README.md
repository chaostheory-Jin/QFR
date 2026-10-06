# QFR Xero AI Mapping

Python batch pipeline that authenticates with Xero, pulls Profit & Loss and
Balance Sheet evidence, maps P&L transaction lines into a controlled QFR
taxonomy, and generates Excel, CSV, JSON, and HTML reports.

The primary mapper is OpenAI (`gpt-4o-mini`). Gemini remains in the repository
as an optional/legacy mapper but is not used by `run_mvp.py`.

## What the pipeline reads

- Xero Profit & Loss and opening/closing Balance Sheet reports
- Chart of Accounts
- Bills and sales invoices
- Bank transactions and bank transfers
- Credit notes and payments
- Manual journals and general journals
- Finance API Balance Sheet detail when authorized
- Payroll report or pay runs when authorized

`run_mvp.py` normalizes these sources into line-level evidence, applies
deterministic business rules first, and sends only unresolved P&L rows to the
AI mapper.

## Requirements

- Python 3.11+
- A Xero OAuth2 app and an authorized Xero organization
- `OPENAI_API_KEY_QFR` or `OPENAI_API_KEY`
- Outbound HTTPS access to Xero and OpenAI

Install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and provide the required values:

```dotenv
XERO_CLIENT_ID=your_xero_client_id
XERO_CLIENT_SECRET=your_xero_client_secret
XERO_REDIRECT_URI=http://localhost:51789/callback
XERO_TENANT_ID=
OPENAI_API_KEY_QFR=your_openai_key
```

`OPENAI_API_KEY_QFR` is preferred. `OPENAI_API_KEY` is used as a fallback.

## Xero authorization

Run:

```bash
python login_xero.py
```

Open the printed authorization URL and approve the target Xero organization.
The script stores the OAuth token in `xero_token.json` and writes the selected
`XERO_TENANT_ID` to `.env`.

Both files contain local credentials and are excluded from Git.

## QuickBooks Online sandbox (independent research connector)

The repository also contains a separate, read-only `quickbooks/` package. It
connects to a QuickBooks Online sandbox company, downloads paginated raw
accounting entities, and downloads standard reports as JSON. It does not alter
or feed into the existing Xero `run_mvp.py` pipeline.

The connector layer proves authentication and raw extraction. Its JSON is not
normalized into the main QFR evidence model, mapped into QFR categories, or
consumed by the frontend. A separate experimental runner can use the raw P&L
files for blind source-account reconstruction.

After registering `http://localhost:51790/callback` in an Intuit app and adding
the development Client ID/Secret to `.env`, run:

```bash
python login_quickbooks.py
python download_quickbooks_data.py --from-date 2026-01-01 --to-date 2026-03-31
python run_quickbooks.py
python run_quickbooks_balance_sheet.py
```

See [`quickbooks/README.md`](quickbooks/README.md) for sandbox setup, raw entity
coverage, report coverage, token behavior, focused download examples, and the
isolated blind P&L reconstruction experiment.

`run_quickbooks.py` uses the downloaded `ProfitAndLoss` account hierarchy as a
target taxonomy, hides each detail line's original account from the model,
classifies the lines, and compares the rebuilt totals with the official report.
It remains separate from `run_mvp.py`.

The downloader also saves an opening Balance Sheet dated one day before the
requested period (or at an explicit `--opening-date`).
`run_quickbooks_balance_sheet.py` starts from those official opening balances,
applies each Balance Sheet General Ledger record in date order, records the
balance before and after every line, and compares the rebuilt endpoint with the
official closing Balance Sheet. Revenue and expense lines roll into the Balance
Sheet's calculated Net Income line. Its CSV, Excel, and JSON outputs are written to
`output/quickbooks/balance_sheet_rebuild/`.

## Generate reports

Run the default reporting period (currently 2026-01-01 to 2026-03-31):

```bash
python run_mvp.py
```

Common alternatives:

```bash
python run_mvp.py --year 2025
python run_mvp.py --from-date 2025-07-01 --to-date 2026-06-30
python run_mvp.py --mapping-workers 4 --ai-timeout 30
python run_mvp.py --use-cache --no-payroll
```

Important options:

- `--mapping-workers`: concurrent mapping requests, 1-32; default is 4 or
  `AI_MAPPING_WORKERS`.
- `--ai-timeout`: per-request OpenAI timeout, 1-120 seconds; default is 30 or
  `OPENAI_TIMEOUT_SECONDS`.
- `--use-cache`: reuse `output/raw_*.json`. Only use caches created for the
  same tenant and reporting period.
- `--no-payroll`, `--no-manual-journals`, `--no-journals`: skip optional APIs.
- `--payments-only`: request the Xero P&L in payments-only mode.
- `--no-progress`: disable the live mapping progress page.

## Mapping safety

AI output must be one JSON object with:

- `category`: an exact configured category from `category_definitions.json`
- `confidence`: a finite JSON number between 0 and 1
- `reason`: a non-empty string

Invalid model output is rejected to `Unmapped` with confidence `0.0` and a
validation RuleID. Rejected output is not cached.

`mapping_memory.json` uses a versioned schema and includes account, transaction,
amount, model, and taxonomy context in each cache key. Writes are locked and
atomic so concurrent mapping workers cannot corrupt the cache. Version 1 cache
entries are preserved for audit during migration but are not reused without
their missing context.

## Main outputs

Files are written under `output/`. The main deliverables are:

- `pl_mapping_report.xlsx`: line-level P&L mapping and audit fields
- `pl_mapping_summary.xlsx`: totals by mapped category
- `income_mapping_report.xlsx` and `expense_mapping_report.xlsx`
- `total_summary.csv` and `total_summary.xlsx`
- `xero_vs_ai_diff.xlsx`: Xero category totals compared with mapped totals
- `xero_vs_ai_line_debug.xlsx`: line-level reconciliation diagnostics
- `balance_sheet_mapping_report.xlsx`: official Xero Balance Sheet structure
- `balance_sheet_evidence_report.xlsx`: transaction and synthetic BS evidence
- `balance_sheet_xero_vs_ai_rebuild_diff.xlsx`: opening plus movement analysis
- `wages_reconciliation_lines.xlsx` and `wages_reconciliation_summary.xlsx`
- `report_data.json`: machine-readable report payload
- `report.html`: interactive report using the generated payload
- `report_assistant.html`: local report Q&A page with optional OpenAI narrative
- `progress.html` and `progress.json`: live mapping progress

Raw API payloads, generated reports, OAuth tokens, and mapping memory are
excluded from Git.

## Frontend status

`frontend/` is a separate Next.js 16 demonstration dashboard. QuickBooks uses
the checked-in downloaded snapshot, while Xero uses demo data. The dashboard
does not automatically read Python's `output/report_data.json`. Refresh the
QuickBooks bundle with `python export_quickbooks_frontend_data.py` after running
its P&L and balance-sheet rebuild pipelines.

Run it with:

```bash
cd frontend
npm install
npm run dev
```

Temporary demo credentials are `admin` / `admin123`. They are client-side only
and are not production authentication.

### Reporting conventions and saved reviews

- Both balance-sheet adapters expose liabilities in their natural credit-positive
  direction. Working capital is **current assets minus current liabilities**;
  fixed assets and long-term debt are excluded. Current ratio uses the same
  current-only subtotals. Currency comes from the selected source.
- Income charts use configured income categories, or the imported line role for
  an unmapped line. QuickBooks account IDs are not Xero account codes; an ID
  starting with `2` does not imply income.
- The review gate is source `ReviewRequired`, `Unmapped`, or confidence
  **at or below** the configured threshold (default `0.70`). Export preserves
  `ReviewRequired`, `ReviewReason`, `AutoAcceptedCategory`, and the original AI
  proposal. Old bundles without source review metadata are conservatively
  flagged until regenerated or manually reviewed.
- P&L review edits are drafts until **Save review**. An approval applies the
  selected category to the dashboard, charts and export; rejection returns the
  line to `Unmapped`; `Needs changes` leaves the proposal unresolved. The AI
  proposal, score and amount remain unchanged for audit. Saved decisions reload
  after refreshing the page. Balance-sheet reviews are saved audit decisions,
  not edits to official ledger balances.
- The dashboard stores mapping decisions in browser IndexedDB, separated by
  source, dataset hash and date range. Stable line IDs, per-line revisions and
  atomic browser transactions protect against filtered-row mismatches and
  concurrent edits in multiple tabs. Changed datasets do not inherit approvals.
- Browser data is not synchronized to Python or the server. Use dashboard Excel
  export for the current reviewed result. Legacy Node filesystem review APIs
  remain available for local workflows (`output/reviews/`, optionally
  `QFR_REVIEW_STORE_DIR`), but the dashboard no longer calls those APIs.

To export a **legacy server-saved** P&L review result for Python without AI
(this does not read browser decisions):

```bash
python export_reviewed_reports.py --review-file output/reviews/quickbooks-<snapshot-hash>.json
```

This creates reviewed detail, category summary, audit history and JSON under
`output/reviewed/`. It does not overwrite the original AI or source reports.
Dashboard review exports include only saved decisions, not unsaved drafts.

### File intake, lineage and reconciliation review

- **Link to Data → Upload CSV / Excel** opens `/imports`. Uploads support CSV,
  XLSX and XLS (3 MB, 10,000 rows, 100 columns, 30 sheets maximum). The first
  row must contain unique, nonempty headers. Select a worksheet, map columns,
  choose ISO/DMY/MDY dates and validate before committing. Original bytes are
  archived unchanged with SHA-256, company, source, currency, document kind,
  batch ID and derived period. The upload path does not send files to an AI API.
- Required mapped fields are date, amount, account and description. Currency
  can use a batch default or a mapped column. Invalid dates, nonfinite amounts,
  bad grouping/precision, missing fields and mixed currencies block commit.
  Formula cells are not accepted as financial inputs; replace them with verified
  source values. Unknown categories are `Unmapped`, never guessed from account IDs.
- Duplicate rows block by default. Identical repeats can explicitly be excluded
  while retaining their original row numbers and raw bytes; suspected duplicates
  without source IDs can explicitly be kept. Conflicting source IDs always block.
  Committed source IDs are also checked across files within the same source,
  company, document kind and currency. Re-uploading the same bytes/context returns
  the existing batch; committed batches cannot be edited in place.
- The imported report is an **isolated category-sum batch summary**, not a full
  P&L or balance sheet. It preserves source signs and never merges invoice,
  bank and ledger imports or adds them to existing Xero/QuickBooks totals.
  Click a category amount for constituent rows and their original worksheet cells.
  Valid and intentionally invalid mock CSV samples are clearly labelled.
- P&L and Balance Sheet now open the separate **Report Explorer** (`/report-trace`)
  via **Explore the numbers**. The explorer retains incoming report filters and
  saved classifications, with visual category/account amounts, searchable
  transactions, invoice references and supporting-document previews. QuickBooks
  balances show opening snapshot plus downloaded movements; these movements do
  not currently include invoice references. Xero demo balances explicitly mark
  missing transaction evidence. Adapter calculations are unchanged.
- Attach original PDF, PNG or JPEG documents (up to 3 MB each) to an individual
  transaction in Report Explorer. Exact bytes and notes persist in browser
  IndexedDB, scoped to source, report, company, dataset snapshot and record.
  Refresh restores attachments; attaching a file is manual evidence collection,
  not verification, approval or an automatically inferred invoice match.
- Reconciliation runs archive the original extraction separately from decisions
  and original uploaded files. Set a materiality threshold in statement currency;
  amounts **at or above** it require a manager decision, even for high-confidence
  exact matches. The mock run uses a labelled UGX 26,000,000 threshold.
  Restore a saved run from the reconciliation page after refresh.
- Human review confirms/edits invoice fields, selects or rejects an assignment,
  and requires reviewer name, declared role and reason. Decisions retain before/
  after history, revisions and timestamps. Selected statement rows remain one-to-one.
  Nonzero amount differences or different IDs stay **approved variances**, not
  matches. Review is blocked until original files have been archived and their
  hashes verified. Audit JSON includes both immutable automated results and the
  effective reviewed results.
- Dashboard imports, reconciliation snapshots, original files, attachments and
  reviews now use browser IndexedDB (`qfr-browser-data-v1`), not Vercel disk.
  No database, cloud bucket, `QFR_DATA_STORE_DIR` or absolute file path is needed.
  Local files are stored as Blobs and served through temporary object URLs for
  preview/download. Hash verification, validation, materiality rules, immutable
  source extraction and revision checks are retained. IndexedDB transactions
  serialize duplicate checks and simultaneous review writes across tabs.
- Data is available only in the same browser profile **and origin**. Localhost,
  Vercel preview URLs and a production domain each have separate storage. Clearing
  site data, browser eviction or private browsing can remove it. There is no
  cloud backup or cross-device synchronization. Download important originals;
  export Excel reports and reconciliation audit JSON. Storage denial/full quota
  fails visibly. Existing server-side archives are not automatically migrated.
- AI/PDF analysis still uses `/api/reconciliation`, sends selected documents to
  the analysis provider, and needs the login-supplied API key or server key.
  Existing conservative request batching remains (3.75 MiB source-file budget;
  Vercel's function payload cap is 4.5 MB). Large source files may still require
  splitting. Saving results no longer makes a second server upload or writes to
  a nonexistent server directory. The existing pure-JavaScript statement PDF
  parser does not require `pdftotext`.
- Legacy filesystem APIs remain for local workflows only. They are not used by
  the dashboard and still require durable storage if called directly on Vercel.
- **Security limit:** existing demo authentication is not production identity or
  customer isolation. Reviewer names/roles are explicitly self-declared, not
  verified RBAC. Do not deploy this approval prototype for production financial
  authorization until server authentication, tenant isolation and role checks exist.

### Payroll mock register

- `/payroll` is integrated into the sidebar and floating AI assistant. It uses
  12 fictional employees, nine monthly pay runs (Jan–Sep 2026), and 108 stable
  employee/pay-run records. It is not downloaded Xero/QuickBooks payroll.
- Amounts are integer AUD cents. Gross = base + overtime + allowance + bonus;
  net = gross − withholding − deductions; employer cost = gross + super.
  Withholding/super rates and confidence scores are **illustrative fixtures**,
  not tax/award/leave calculations or real AI probabilities.
- Date, department, employee, payment-status and confidence filters feed cards,
  monthly chart, run summary, by-line register and Excel exports. A payslip view
  explains each calculation. Draft September runs are included unless filtered.
- Three mock low-confidence cases support notes and review decisions, saved to
  this browser with history and optimistic revisions. Approval never marks pay
  as paid or changes the original amounts. No payments are initiated and no mock
  amounts are added to existing P&L/Balance Sheet reports. The AI assistant is
  given the explicitly labelled full mock register, not the page's filters.

### Invoice reconciliation evidence

The reconciliation page uses OpenAI Responses with strict JSON Schema plus
runtime field/index validation. The model sees only invoices, never the master
statement. Printed fields, uploaded-byte SHA-256 hashes and local OCR evidence
are retained; statement candidates never overwrite invoice IDs or amounts.
Only globally unique exact ID + signed amount matches are automatic. Duplicate
invoices, OCR conflicts, missing fields, currency mismatches, same-amount and
fuzzy candidates require review. Exact IDs with different amounts retain both
values and the difference. Select the statement currency before uploading;
the default UGX dataset uses integer currency units, not universal absolute
amounts or a fixed one-shilling tolerance. Download **Export audit JSON** for
the original evidence and candidate decisions. This is an audit export, not
a persisted human reconciliation approval workflow.

The optional macOS Vision locator runs locally; Linux deployments still use
invoice-only model evidence, without local bounding-box highlights. A failed
local OCR locator does not turn statement candidates into OCR corrections.
An automatic match requires matching, non-weak independent local OCR for the
invoice ID (confidence ≥0.85); repeating the same model string in two fields
is not independent verification. Missing local OCR (including on Linux) keeps
IDs in manual review rather than silently accepting self-consistency.
Uploads preserve the user's original image bytes instead of lossy browser JPEG
compression. The extractor sends the full native-resolution page (bounded to
3200×4200) plus original-colour and enlarged channel crops of portrait header,
identifier, labelled totals and tight amount-digit regions, all with `detail: original`. The full page is
always retained; template crops are only readability aids, not additional
documents or guessed fields. Crop geometry, image hashes, requested/served
model, reasoning effort, provider response ID and token usage are audited.
The tested default is `gpt-6-astra` with high reasoning effort; override with
`OPENAI_RECONCILIATION_MODEL` and `OPENAI_RECONCILIATION_REASONING_EFFORT` in the
frontend server environment. This high-resolution workflow costs more image
tokens and takes longer; it does not guarantee faint printed IDs are correct.
Portrait invoices receive a bounded second read of the invoice's totals
crop only, without the first guess, baseline or statement. A reread can replace
the displayed total only when its directly transcribed gross string, final label,
net-plus-tax arithmetic and any available local OCR checks pass. Both readings
and provider traces remain in the audit; failed/timed-out rereads retain the first
reading for review. Disagreements are explicitly unverified even if either read
is internally arithmetically consistent. No amount is computed as a substitute
for missing pixels.
See [reconciliation-evidence-plan.md](docs/reconciliation-evidence-plan.md)
for implementation status and remaining human-review work.

To benchmark all original invoice images, explicitly consent to sending the
financial images to OpenAI, start the frontend server with its API Key on
port 3107, then run:

```bash
cd frontend
QFR_RUN_LIVE=1 npm test -- src/lib/reconciliation-live.test.ts
```

The PDF statement stays local. The benchmark compares against visual
transcriptions, records failures rather than silently dropping files, and
saves recognition and reconciliation counts separately under
`output/reconciliation/live-<timestamp>/`. It includes 10 Coca-Cola scans,
1 additional invoice screenshot, and 2 non-invoice negative controls. One
Coca-Cola scan lacks the final gross total; it must not receive an invented
statement-derived amount. Normal `npm test` skips this paid integration test.
For a selected-file diagnostic use `QFR_LIVE_FILES=name1.jpg,name2.jpg` with
the same opt-in flag. The visual transcription is a comparison baseline, not
authoritative ground truth for obscured characters (including amount digits): retain disagreements for
human source review rather than adapting expected answers to model output.
`frontend/scripts/probe-invoice-id.mjs` independently transcribes only a tight
portrait-header crop and explicitly allows `?` for ambiguous characters. Run
it from `frontend` with original image paths only after upload consent; it loads
the project API key and saves raw responses/crops under `output/reconciliation`.
It never loads the statement or the comparison baseline and does not silently
replace the main extraction.
The older `Cola_Reconciliation/reconcile.py` uses looser matching and is not
the dashboard's matching engine or an accuracy benchmark.

## Tests

### Upload test datasets

Upload-ready synthetic data is in [`test-data/uploads/`](test-data/uploads/README.md):
21 CSV files and 2 Excel workbooks, including 100/1,000/10,000-row valid batches,
invoice/bank data, date conventions, manual column mapping, invalid fields,
duplicates, cross-batch conflicts and parser limits. The guide lists upload
metadata and expected results. No customer records or paid AI calls are used.
`manifest.json` includes file hashes and validation expectations; run
`cd frontend && npm test -- src/lib/upload-fixtures.test.ts` to verify the
actual delivered files against the current importer.

```bash
python -m unittest -v test_ai_mapping.py
python -m unittest -v test_quickbooks.py
python -m unittest -v test_run_quickbooks.py
python -m unittest -v test_quickbooks_balance_sheet.py test_review_export.py
python test_mapping_consistency.py
cd frontend && npm test
cd frontend && npm run lint
cd frontend && npm run build
```

`test_mapping_consistency.py` verifies that the generated P&L detail and summary
agree arithmetically. It is not a substitute for reconciliation against Xero.
