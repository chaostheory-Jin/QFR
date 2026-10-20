# QuickBooks Online connector

Documentation reviewed: **2026-10-15T11:11:41+11:00** (AEDT), against `ec60f88`.
See the [technical milestones](../docs/technical-progress-2026-10-15.md) for
implementation timestamps and current integration boundaries.

This package is a separate, read-only QuickBooks Online (QBO) integration. It
does not change the existing Xero pipeline or feed QuickBooks rows into
`run_mvp.py` yet.

## Why this uses QBO, not QuickBooks Desktop

QuickBooks Desktop uses a locally installed Windows SDK or QuickBooks Web
Connector and exchanges qbXML. It does not provide the cloud REST/OAuth flow
used by Xero. Intuit's demo companies that can be connected to a REST API are
QuickBooks Online sandbox companies, so this connector targets QBO.

## 1. Create or select a sandbox

1. Sign in to the Intuit Developer portal.
2. Go to **My Hub > Sandboxes**. A developer profile normally starts with one
   sandbox; you can also add an AU QuickBooks Online Plus sandbox.
3. Go to **My Hub > App dashboard** and create/open a QuickBooks Online app.
4. In the app's development settings, register this redirect URI exactly:

   `http://localhost:51790/callback`

5. Copy the **Development** Client ID and Client Secret. Development keys must
   be used with sandbox companies.

## 2. Configure QFR

Add these values to the repository's `.env` file:

```dotenv
QUICKBOOKS_CLIENT_ID=your_development_client_id
QUICKBOOKS_CLIENT_SECRET=your_development_client_secret
QUICKBOOKS_REDIRECT_URI=http://localhost:51790/callback
QUICKBOOKS_ENVIRONMENT=sandbox
QUICKBOOKS_MINOR_VERSION=75
```

`QUICKBOOKS_REALM_ID` is optional because the login script stores the selected
company's realm ID with the local token.

## 3. Connect the demo company

```bash
python login_quickbooks.py
```

Open the printed URL, sign in, and choose the desired sandbox company. The
script validates the OAuth state, exchanges the one-time code, verifies the
company with the CompanyInfo API, and saves `quickbooks_token.json` locally.
That file is ignored by Git. To choose a different company, run:

```bash
python login_quickbooks.py --force
```

## 4. Download raw entities and reports

Download the default set for the current calendar year:

```bash
python download_quickbooks_data.py
```

Choose a reporting period or a smaller set of endpoints:

```bash
python download_quickbooks_data.py --from-date 2025-07-01 --to-date 2026-06-30
python download_quickbooks_data.py --opening-date 2025-06-30 --from-date 2025-07-01 --to-date 2026-06-30
python download_quickbooks_data.py --entities Account,Invoice,Bill,Purchase,JournalEntry --skip-reports
python download_quickbooks_data.py --reports ProfitAndLoss,BalanceSheet,GeneralLedger --skip-entities
python download_quickbooks_data.py --accounting-method Cash
```

JSON files are written to:

```text
output/quickbooks/
├── company_info.json
├── manifest.json
├── entities/
│   ├── account.json
│   ├── invoice.json
│   └── ...
└── reports/
    ├── profit_and_loss.json
    ├── balance_sheet.json
    └── ...
```

The default entity list includes accounts, customers, vendors, invoices,
bills, payments, purchases, bank deposits/transfers, credit documents,
journal entries, items, classes, and departments. The default reports include
P&L, detailed P&L, Balance Sheet, Cash Flow, Trial Balance, General Ledger,
account list, AR/AP aging, and customer/vendor balances.

List entities are requested with both active and inactive records. `Attachable`
downloads attachment metadata only; downloading the binary files can be added
later if the QFR evidence pipeline needs them.

Some entities and reports vary by sandbox country and QBO subscription. By
default, one unavailable endpoint is recorded in `manifest.json` and the rest
continue downloading. Pass `--strict` to stop on the first error.

QBO sandboxes do not support Payroll or linking a live bank account. The sample
banking transactions already present in the sandbox are still available through
the accounting entities and reports.

When `BalanceSheet` is included, the downloader writes two snapshots:

- `reports/opening_balance_sheet.json` at `--opening-date`, which must be the
  day before `--from-date` and defaults to that date;
- `reports/balance_sheet.json` at `--to-date`.

## 5. Blind P&L reconstruction experiment

After downloading `ProfitAndLoss`, `ProfitAndLossDetail`, `AccountList`,
`CompanyInfo`, and `Item`, run:

```bash
python run_quickbooks.py
```

This is an isolated research experiment. It:

1. extracts the QuickBooks P&L account hierarchy as the allowed classification
   taxonomy;
2. validates that the detailed report reconstructs the official account totals;
3. removes the original P&L account and split account from the AI input;
4. enriches the allowed account paths with AccountList type, detail type, and
   description metadata;
5. gives the mapper non-contact CompanyInfo context such as industry, country,
   and fiscal year;
6. matches each P&L detail line to one raw transaction line using document
   number, date, contact, description, and amount;
7. provides only that line's matched Item/ProductService name, description,
   type, quantity, sales price, purchase cost, tax settings, and inventory
   metadata while removing every account reference;
8. determines Income, COGS, or Expense before account selection, including
   quantity-times-cost versus quantity-times-price handling for inventory;
9. applies visible-evidence leaf rules and keeps refunds in the matched Item's
   income family;
10. asks the existing OpenAI mapper to classify each remaining line in a
    separate request restricted to the inferred section;
11. sends low-confidence, historically ambiguous, or evidence-poor lines to a
    HITL queue; and
12. rebuilds account totals and compares them with the official QuickBooks P&L.

The source account is retained only in the output for post-mapping accuracy
measurement. It is not passed to the model. Company email, street address,
phone, IDs, and API metadata are also excluded because they do not help account
classification. Item `IncomeAccountRef`, `ExpenseAccountRef`,
`AssetAccountRef`, and any other account-reference fields are excluded to keep
the classification blind to the actual posting answer.

To validate parsing without making OpenAI requests:

```bash
python run_quickbooks.py --validate-only
```

Outputs are written to `output/quickbooks/ai_rebuild/`:

- `quickbooks_pl_source_parse_diff.csv` and `.xlsx`
- `quickbooks_pl_blind_line_mapping.csv` and `.xlsx`
- `quickbooks_pl_auto_accepted_lines.csv` and `.xlsx`
- `quickbooks_pl_hitl_queue.csv` and `.xlsx`
- `quickbooks_pl_official_vs_classified_accounts.csv` and `.xlsx`
- `quickbooks_pl_all_lines_human_audit.csv` and `.xlsx`
- `quickbooks_pl_misclassified_lines.csv` and `.xlsx`
- `quickbooks_pl_blind_rebuild_diff.csv` and `.xlsx`
- `quickbooks_pl_error_breakdown.csv` and `.xlsx`
- `quickbooks_pl_error_pairs.csv` and `.xlsx`
- `quickbooks_pl_blind_summary.json`

This experiment remains independent of `run_mvp.py`. Its reconstruction results,
together with the Balance Sheet rebuild, can be bundled for the frontend using
`python export_quickbooks_frontend_data.py`. The dashboard reads the generated
snapshot, not a live QuickBooks connection or the raw download directory.

## 6. Balance Sheet record-by-record rebuild

Run:

```bash
python run_quickbooks_balance_sheet.py
```

This deterministic runner uses the downloaded Account entity to identify
Asset, Liability, and Equity accounts. It takes each account's official opening
balance, applies the period's General Ledger records in date order, and stores
both the balance before and after every record. Asset movements use debit minus
credit; Liability and Equity movements use credit minus debit. If QuickBooks
supplies `subt_nat_amount`, that natural-balance amount is used directly.
Revenue and Expense ledger records are rolled into the calculated Balance Sheet
`Net Income` equity line, so the rebuild includes the period-profit bridge and
not only direct Balance Sheet account postings.

The rebuilt result for every account is compared with the official closing
Balance Sheet. Differences remain visible; the runner does not force the
endpoint to equal QuickBooks. Outputs are written to
`output/quickbooks/balance_sheet_rebuild/`:

- `quickbooks_bs_opening_balances.csv` and `.xlsx`
- `quickbooks_bs_official_ending_balances.csv` and `.xlsx`
- `quickbooks_bs_movement_lines.csv` and `.xlsx`
- `quickbooks_bs_rebuild_diff.csv` and `.xlsx`
- `quickbooks_bs_summary.json`

## Token behavior

QBO access tokens last one hour. The downloader refreshes an expired access
token and always stores the newest rotating refresh token. If the refresh token
has not been used for 100 days, reconnect with `python login_quickbooks.py
--force`.

## Using the modules directly

```python
from quickbooks.client import QuickBooksClient
from quickbooks.oauth import load_token
from quickbooks.reports import build_report_params

token = load_token()
client = QuickBooksClient(
    token["access_token"],
    token["realm_id"],
    environment="sandbox",
)

invoices = client.query_all("Invoice")
profit_and_loss = client.get_report(
    "ProfitAndLoss",
    build_report_params(
        "ProfitAndLoss",
        from_date="2026-01-01",
        to_date="2026-03-31",
        accounting_method="Accrual",
    ),
)
```
