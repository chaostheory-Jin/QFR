#!/usr/bin/env python3
"""Export the downloaded QuickBooks rebuild outputs for the frontend.

Only reporting fields are copied. OAuth credentials and company contact details
never enter the generated frontend bundle.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
QB = ROOT / "output" / "quickbooks"
DESTINATION = ROOT / "frontend" / "src" / "lib" / "quickbooks-report-data.generated.json"


def read_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def as_float(value: str | int | float | None) -> float:
    if value in (None, ""):
        return 0.0
    return float(value)


def quickbooks_account_name(report_path: str) -> str:
    """Convert report hierarchy (`Expenses > Rent`) to QBO FQN (`Rent`)."""
    parts = [part.strip() for part in report_path.split(" > ")]
    if len(parts) > 1 and parts[0] in {"Income", "Other Income", "Expenses", "Other Expenses", "Cost of Goods Sold"}:
        parts = parts[1:]
    return ":".join(parts)


def grand_total_buckets(report: dict) -> list[float]:
    rows = report.get("Rows", {}).get("Row", [])
    total = next(row for row in rows if row.get("group") == "GrandTotal")
    values = total["Summary"]["ColData"]
    # QuickBooks columns are Current, 1-30, 31-60, 61-90, 91+.
    # The existing QFR chart starts at 0-30, so current and 1-30 are combined.
    return [
        as_float(values[1].get("value")) + as_float(values[2].get("value")),
        as_float(values[3].get("value")),
        as_float(values[4].get("value")),
        as_float(values[5].get("value")),
    ]


def main() -> None:
    pl_summary = read_json(QB / "ai_rebuild" / "quickbooks_pl_blind_summary.json")
    bs_summary = read_json(QB / "balance_sheet_rebuild" / "quickbooks_bs_summary.json")
    company = read_json(QB / "company_info.json").get("CompanyInfo", {})
    accounts = read_json(QB / "entities" / "account.json")
    account_codes = {
        account.get("FullyQualifiedName", ""): account.get("AcctNum") or account.get("Id", "")
        for account in accounts
    }

    pl_lines = read_csv(QB / "ai_rebuild" / "quickbooks_pl_blind_line_mapping.csv")
    raw_data = []
    for line in pl_lines:
        source_account = line["SourceAccountForAudit"]
        raw_data.append(
            {
                "Type": line["TransactionType"],
                "InvoiceNumber": line["DocumentNumber"] or line["LineNumber"],
                "Date": line["Date"],
                "Contact": line["Contact"],
                "AccountCode": str(account_codes.get(quickbooks_account_name(source_account), "")),
                "AccountName": source_account,
                "Description": line["Description"] or line["AIInputDescription"],
                "Amount": as_float(line["Amount"]),
                "MappedCategory": line["MappedCategory"] or "Unmapped",
                "Confidence": as_float(line["Confidence"]),
                "Reason": line["Reason"],
                "RuleID": line["RuleID"] or None,
                "OriginalMappedCategory": source_account,
                "NormalizationRule": None,
            }
        )

    allowed_categories = sorted({row["MappedCategory"] for row in raw_data})
    income_categories = sorted(
        {
            line["MappedCategory"]
            for line in pl_lines
            if line["InferredRole"] == "income" and line["MappedCategory"]
        }
    )

    bs_accounts = read_csv(QB / "balance_sheet_rebuild" / "quickbooks_bs_rebuild_diff.csv")
    bs_movements = read_csv(QB / "balance_sheet_rebuild" / "quickbooks_bs_movement_lines.csv")

    payload = {
        "source": {
            "name": "QuickBooks",
            "company": company.get("CompanyName", "QuickBooks company"),
            "currency": bs_summary["report"]["currency"],
        },
        "profitLoss": {
            "meta": {
                "report_from": pl_summary["report"]["StartPeriod"],
                "report_to": pl_summary["report"]["EndPeriod"],
                "balance_sheet_date": bs_summary["report"]["ending_date"],
            },
            "raw_data": raw_data,
            "balance_sheet_data": [],
            "balance_sheet_summary": [],
            "income_categories": income_categories,
            "allowed_categories": allowed_categories,
            "review_threshold": pl_summary["classification"]["review_threshold"],
        },
        "balanceSheet": {
            "openingDate": bs_summary["report"]["opening_date"],
            "reportFrom": bs_summary["report"]["movement_from"],
            "reportTo": bs_summary["report"]["movement_to"],
            "accounts": [
                {
                    "key": row["ComparisonKey"],
                    "section": row["BalanceSheetSection"],
                    "category": row["BalanceSheetCategory"],
                    "name": row["AccountName"],
                    "opening": as_float(row["OpeningBalance"]),
                    "confidence": 1.0 if row["Status"] == "Match" else 0.0,
                    "reason": (
                        "Opening balance plus every line movement reconciles to the official QuickBooks ending balance."
                        if row["Status"] == "Match"
                        else f"Rebuilt ending balance differs from QuickBooks by {as_float(row['AbsDifference']):.2f}."
                    ),
                }
                for row in bs_accounts
            ],
            "movements": [
                {
                    "date": row["Date"],
                    "key": row["ComparisonKey"],
                    "amount": as_float(row["SignedMovement"]),
                }
                for row in bs_movements
            ],
            "aging": {
                "asAt": bs_summary["report"]["ending_date"],
                "receivables": grand_total_buckets(read_json(QB / "reports" / "aged_receivables.json")),
                "payables": grand_total_buckets(read_json(QB / "reports" / "aged_payables.json")),
            },
        },
    }

    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {DESTINATION.relative_to(ROOT)} ({len(raw_data)} P&L lines, {len(bs_movements)} balance movements)")


if __name__ == "__main__":
    main()
