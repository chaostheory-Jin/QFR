# QFR frontend

Documentation reviewed: **2026-10-15T11:11:41+11:00** (AEDT), code baseline `ec60f88`.
Latest feature commit: **2026-10-13T14:27:16+11:00**. These are review/commit
timestamps, not deployment timestamps.

See the [timestamped technical report](../docs/technical-progress-2026-10-15.md)
for AI, feature and security changes by major milestone.

## Run and verify

Use Node.js 22.x. From this directory:

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Demo login is `admin` / `admin123`;
it is not production authentication.

```bash
npm test
npx tsc --noEmit
npm run build
```

Live AI tests are opt-in and may send financial images to a paid service.
On **2026-10-15**, non-live tests passed: **27 files / 179 tests**, with **2 files /
2 tests skipped**; TypeScript also passed. Build, browser and production deployment
were not rechecked in this documentation-only update.

## Pages and data sources

| Page | Current behavior |
| --- | --- |
| `/`, `/link-data` | Root redirects to Link to Data; connector progress is simulated, not live OAuth; file intake leads to Imports |
| `/profit-loss`, `/balance-sheet` | Source selection, deterministic totals, confidence review, exports |
| `/report-trace` | Report Explorer: drill down to lines, journals, attachments and payroll evidence |
| `/imports` | CSV/XLSX/XLS validation, mapping, independent category summaries and original-file archive |
| `/payroll` | Fictional payroll register, payslips, review, ledger posting, simulated payments and bank matching |
| `/reconciliation` | Invoice extraction, full-statement candidates, evidence highlights where supported, human review |
| `/ai-insights` | Visual progress page, separate from the floating assistant's real AI requests |

QuickBooks uses an exported downloaded snapshot. To refresh it, run the Python
rebuilds and `python export_quickbooks_frontend_data.py` from the repository root.
Xero dashboard data is demo data, not a live view of `run_mvp.py` output.
Payroll Demo is a separate fictional AUD source: 12 employees, 9 months,
108 payslips. Its ledger feeds both financial reports without altering Xero or
QuickBooks totals. See [Payroll workflow](docs/payroll-demo.md).

## Browser storage and Vercel

Use `frontend` as the Vercel project root, Node.js 22.x and `npm run build`.
The dashboard saves uploads, Blob originals, import batches, attachments, review
history and payroll workflow in origin-scoped IndexedDB. No database or durable
server path is required for this dashboard path. Do not treat `/tmp` as durable
storage. Legacy filesystem APIs remain for local workflows, not dashboard storage.

Browser profiles and origins do not share records. Clearing site data, browser
eviction, a new preview URL or a new device can make prior records unavailable.
Export reports/audit JSON and download originals for backup; there is no cloud
sync or general audit re-import interface. Existing server archives are not
automatically migrated.

Statement text/coordinate parsing uses `unpdf`, without a system `pdftotext`
dependency. Supported text layouts are not equivalent to arbitrary scanned-PDF
OCR. Invoice bounding-box evidence uses optional macOS Vision; Linux/Vercel
cannot assume that locator is available. Missing independent OCR keeps invoice
IDs in human review.

AI analysis still uses server requests and sends selected invoice content to
the analysis provider. Browser storage does not remove upload/request budgets.

## AI keys and security boundaries

A key entered on login is submitted to `/api/session-key` and stored as an
HttpOnly, SameSite=Strict session cookie, with Secure enabled in production.
Server resolution is cookie → `OPENAI_API_KEY_QFR` → `OPENAI_API_KEY`.
Never put secrets in `NEXT_PUBLIC_` variables or commit them. HttpOnly does not
mean server-only storage: the browser still holds and transmits the cookie.

The floating assistant uses workflow-aware full-period Payroll Demo context.
Its non-payroll context still primarily comes from static demo data; do not
assume it reflects every QuickBooks source/filter. Errors are shown as AI
unavailable. Invoice extraction is separate: statement candidates never become
invoice ground truth, and review suggestions are not automatic approvals.

**Production blockers:** demo login is client-side, reviewer roles are
self-declared, and uniform API authentication, tenant isolation, rate/cost
limits and trusted audit storage are not implemented. The route proxy is not
a security boundary around every page/API. IndexedDB/hash/revision controls
protect consistency, not verified identity or encrypted multi-tenant storage.
See the [security milestone](../docs/technical-progress-2026-10-15.md#milestone-09-security-and-integrity---implemented-controls-and-gaps)
before using server-funded AI keys or real approval workflows.
