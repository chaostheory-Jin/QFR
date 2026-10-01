import argparse
import html as html_lib
import json
import os
import queue
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TypeVar

import pandas as pd
import requests
from config import load_settings
from xero.oauth import load_token, refresh_access_token
from xero.reports import get_balance_sheet, get_profit_and_loss, get_reports, get_report_by_id
from xero.transactions import (
    get_bank_transactions,
    get_bank_transfers,
    get_bills,
    get_credit_notes,
    get_invoices,
    get_payments,
)
from xero.payroll import get_payruns
from xero.accounts import get_accounts
from xero.journals import get_manual_journals
from xero.general_journals import get_journals
from xero.finance import get_financial_statement_balance_sheet
from ai.mapping_validation import rejected_mapping, validate_mapping_result
from ai.openai_mapper import map_description


OUTPUT_DIR = Path("output")


CATEGORY_DEFINITIONS_FILE = Path("category_definitions.json")

ALLOWED_CATEGORIES: List[str] = []
INCOME_CATEGORIES: List[str] = []
PAYROLL_CATEGORIES: List[str] = []

# Confidence below this threshold is flagged for human review
REVIEW_CONFIDENCE_THRESHOLD = 0.7

CATEGORY_NORMALIZATION_MAP: Dict[str, str] = {
    "Interest Income": "General Expenses",
}

BALANCE_SHEET_CLASSES = {"ASSET", "LIABILITY", "EQUITY"}
PROFIT_LOSS_CLASSES = {"REVENUE", "EXPENSE"}
BALANCE_SHEET_FALLBACK_CATEGORY = "Unmapped Balance Sheet"
T = TypeVar("T")


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _call_with_hard_timeout(
    fn: Callable[..., T],
    *args: Any,
    timeout_seconds: int,
    label: str,
    **kwargs: Any,
) -> T:
    result_queue: queue.Queue[tuple[str, Any]] = queue.Queue(maxsize=1)

    def target() -> None:
        try:
            result_queue.put(("ok", fn(*args, **kwargs)))
        except Exception as exc:  # noqa: BLE001
            result_queue.put(("error", exc))

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    try:
        status, value = result_queue.get(timeout=timeout_seconds)
    except queue.Empty as exc:
        raise TimeoutError(f"{label} timed out after {timeout_seconds}s") from exc

    if status == "error":
        raise value
    return value


def _load_cached_accounts_payload() -> Dict[str, Any]:
    cache_path = OUTPUT_DIR / "chart_of_accounts.json"
    if not cache_path.exists():
        return {}
    try:
        rows = json.loads(cache_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(rows, list):
        return {}
    return {"Accounts": rows}


def _load_json_cache(filename: str) -> Optional[Dict[str, Any]]:
    cache_path = OUTPUT_DIR / filename
    if not cache_path.exists():
        return None
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"Ignoring invalid cache file: {cache_path}")
        return None
    if not isinstance(payload, dict):
        print(f"Ignoring non-object cache file: {cache_path}")
        return None
    print(f"Using cached {filename}.")
    return payload


def _write_json_cache(filename: str, payload: Dict[str, Any]) -> None:
    (OUTPUT_DIR / filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def parse_args() -> argparse.Namespace:
    # Ensure CLI defaults can be configured from the project .env file.
    load_settings()
    parser = argparse.ArgumentParser(description="Run QFR Xero mapping MVP.")
    parser.add_argument("--from-date", dest="from_date", help="YYYY-MM-DD")
    parser.add_argument("--to-date", dest="to_date", help="YYYY-MM-DD")
    parser.add_argument("--year", type=int, help="Shortcut for full-year report (YYYY)")
    parser.add_argument(
        "--max-pages",
        type=int,
        default=_env_int("XERO_MAX_PAGES", 50),
        help="Max pages to fetch per invoice type (default: 50 or XERO_MAX_PAGES).",
    )
    parser.add_argument(
        "--no-payroll",
        action="store_true",
        help="Skip payroll API calls.",
    )
    parser.add_argument(
        "--no-progress",
        action="store_true",
        help="Disable progress.html updates.",
    )
    parser.add_argument(
        "--dump-raw",
        action="store_true",
        help="Write raw invoices/bills JSON payloads to output/ for debugging.",
    )
    parser.add_argument(
        "--use-cache",
        action="store_true",
        help="Use cached output/raw_*.json payloads for heavy Xero evidence endpoints when available.",
    )
    parser.add_argument(
        "--no-manual-journals",
        action="store_true",
        help="Skip manual journals API calls.",
    )
    parser.add_argument(
        "--no-journals",
        action="store_true",
        help="Skip general journals API calls.",
    )
    parser.add_argument(
        "--payments-only",
        action="store_true",
        help="Request Xero Profit & Loss report in payments-only mode.",
    )
    parser.add_argument(
        "--mapping-workers",
        type=int,
        default=_env_int("AI_MAPPING_WORKERS", 4),
        help="Concurrent AI mapping workers (default: 4 or AI_MAPPING_WORKERS; max: 32).",
    )
    parser.add_argument(
        "--ai-timeout",
        type=float,
        default=_env_float("OPENAI_TIMEOUT_SECONDS", 30.0),
        help="OpenAI request timeout in seconds (default: 30; valid range: 1-120).",
    )
    args = parser.parse_args()
    if not 1 <= args.mapping_workers <= 32:
        parser.error("--mapping-workers must be between 1 and 32.")
    if not 1.0 <= args.ai_timeout <= 120.0:
        parser.error("--ai-timeout must be between 1 and 120 seconds.")
    return args


def _parse_iso_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def get_report_date_range(args: argparse.Namespace) -> tuple[str, str]:
    if args.from_date or args.to_date:
        if not (args.from_date and args.to_date):
            raise SystemExit("Both --from-date and --to-date are required.")
        start = _parse_iso_date(args.from_date)
        end = _parse_iso_date(args.to_date)
        if start > end:
            raise SystemExit("--from-date must be <= --to-date.")
        return args.from_date, args.to_date

    if args.year:
        return f"{args.year}-01-01", f"{args.year}-12-31"

    report_year = os.environ.get("REPORT_YEAR")
    if report_year:
        return f"{report_year}-01-01", f"{report_year}-12-31"

    from_date = os.environ.get("REPORT_FROM_DATE")
    to_date = os.environ.get("REPORT_TO_DATE")
    if from_date and to_date:
        return from_date, to_date

    # Default to the boss-approved 2026 YTD reporting cut-off.
    return "2026-01-01", "2026-03-31"


_XERO_DATE_RE = re.compile(r"/Date\((\d+)(?:[+-]\d+)?\)/")


def _parse_xero_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    if text.startswith("/Date("):
        match = _XERO_DATE_RE.search(text)
        if match:
            try:
                ms = int(match.group(1))
            except ValueError:
                return None
            return datetime.utcfromtimestamp(ms / 1000).date()

    text = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
        return parsed.date()
    except ValueError:
        pass

    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _normalize_xero_date(value: Any) -> tuple[str, Optional[date]]:
    parsed = _parse_xero_date(value)
    if parsed:
        return parsed.isoformat(), parsed
    if value is None:
        return "", None
    return str(value), None


def _in_date_range(value: Optional[date], start: date, end: date) -> bool:
    if value is None:
        return True
    return start <= value <= end


def _to_gst_exclusive_amount(line: Dict[str, Any], parent_item: Optional[Dict[str, Any]] = None) -> float:
    """
    Normalize Xero line amounts to GST-exclusive values.
    """
    try:
        line_amount = float(line.get("LineAmount") or 0.0)
    except (TypeError, ValueError):
        line_amount = 0.0
    try:
        tax_amount = float(line.get("TaxAmount") or 0.0)
    except (TypeError, ValueError):
        tax_amount = 0.0

    line_amount_type = str((parent_item or {}).get("LineAmountTypes") or "").upper()
    if line_amount_type == "INCLUSIVE":
        return line_amount - tax_amount
    return line_amount


def _apply_rule_first_mapping(
    row: Dict[str, Any],
    fallback_category: str,
) -> Optional[Dict[str, Any]]:
    """
    Apply deterministic accounting-structure patches confirmed by human review.
    Returns a mapping payload when a rule matches; otherwise None.
    """
    tx_type = str(row.get("Type") or "").upper()
    account_code = str(row.get("AccountCode") or "").strip()
    description = str(row.get("Description") or "")
    description_lower = description.lower()
    contact = str(row.get("Contact") or "")
    contact_lower = contact.lower()
    account_name = str(row.get("AccountName") or "")
    account_name_lower = account_name.lower().strip()

    def _contains_any(text: str, needles: List[str]) -> bool:
        return any(needle in text for needle in needles)

    is_bank_statement_tx = tx_type.startswith("BANKTRANSACTION-")

    # PATCH_SALES_CREDIT_KEYWORDS_NEGATIVE
    # Boss policy: credit/duplicate/refund on sales should reduce sales totals.
    if (
        account_code == "200"
        and (
            "CREDITNOTE-ACCRECCREDIT" in tx_type
            or _contains_any(description_lower, ["duplicate invoice", "credit", "refund"])
        )
    ):
        row["AccountCode"] = "200"
        row["AccountName"] = "Sales"
        try:
            amount_val = float(row.get("Amount") or 0.0)
        except (TypeError, ValueError):
            amount_val = 0.0
        row["Amount"] = -abs(amount_val)
        return {
            "category": "Sales",
            "confidence": 0.99,
            "reason": "Sales credit/duplicate invoice keyword policy: force negative sales adjustment",
            "rule_id": "PATCH_SALES_CREDIT_KEYWORDS_NEGATIVE",
        }

    # PATCH_ACCOUNT_453_OFFICE_EXPENSES
    # Account 453 should remain Office Expenses unless a future explicit override is added.
    if account_code == "453":
        row["AccountCode"] = "453"
        row["AccountName"] = "Office Expenses"
        if "credit" in description_lower or "CREDIT" in tx_type:
            # Office-expense credits should reduce the expense balance.
            try:
                amount_val = float(row.get("Amount") or 0.0)
            except (TypeError, ValueError):
                amount_val = 0.0
            row["Amount"] = -abs(amount_val)
        return {
            "category": "Office Expenses",
            "confidence": 0.99,
            "reason": "Account-code guard: 453 is mapped to Office Expenses (credit items forced negative)",
            "rule_id": "PATCH_ACCOUNT_453_OFFICE_EXPENSES",
        }

    # PATCH_CONSULTING_TRAINING_MICROSOFT_OFFICE
    # Restrict to expense-side records; do not remap sales invoices (account 200).
    if (
        not account_code.startswith("2")
        and _contains_any(description_lower, ["training", "microsoft office"])
        and tx_type in {"BILL", "BANKTRANSACTION-SPEND", "MANUALJOURNAL"}
    ):
        row["AccountName"] = row.get("AccountName") or "Consulting & Accounting"
        return {
            "category": "Consulting & Accounting",
            "confidence": 0.99,
            "reason": "Training keyword policy: map Microsoft Office half-day training to Consulting & Accounting",
            "rule_id": "PATCH_CONSULTING_TRAINING_MICROSOFT_OFFICE",
        }

    # PATCH_RENT_ACCOUNT_NAME
    if account_name_lower == "rent":
        row["AccountName"] = "Rent"
        return {
            "category": "Rent",
            "confidence": 0.99,
            "reason": "Manual patch: account name directly indicates Rent",
            "rule_id": "PATCH_RENT_ACCOUNT_NAME",
        }

    # PATCH_RENT_OFFICE_KEYWORDS
    if (
        not account_code.startswith("2")
        and tx_type in {"BILL", "BANKTRANSACTION-SPEND", "MANUALJOURNAL"}
        and _contains_any(
            description_lower,
            ["office rent", "office lease", "monthly rent", "rent payment", "office rental"],
        )
    ):
        row["AccountName"] = row.get("AccountName") or "Rent"
        return {
            "category": "Rent",
            "confidence": 0.99,
            "reason": "Manual patch: office rent keyword rule",
            "rule_id": "PATCH_RENT_OFFICE_KEYWORDS",
        }

    # PATCH_CREDIT_NOTE_SALES
    if "CREDIT" in tx_type and account_code == "200":
        row["AccountCode"] = "200"
        row["AccountName"] = "Sales"
        return {
            "category": "Sales",
            "confidence": 0.99,
            "reason": "Credit note adjustment confirmed by manual review",
            "rule_id": "PATCH_CREDIT_NOTE_SALES",
        }

    # PATCH_PAYG_WITHHOLDING
    if account_code == "825":
        row["AccountCode"] = "825"
        row["AccountName"] = "PAYG Withholdings Payable"
        return {
            "category": "Wages and Salaries",
            "confidence": 0.99,
            "reason": "PAYG accounting structure confirmed",
            "rule_id": "PATCH_PAYG_WITHHOLDING",
        }

    # PATCH_TAX_505_LESS_TAX
    if (
        tx_type == "BANKTRANSACTION-SPEND"
        and account_code == "505"
        and _contains_any(description_lower, ["less tax", "tax"])
    ):
        row["AccountCode"] = "505"
        row["AccountName"] = "Income Tax Expense"
        return {
            "category": "General Expenses",
            "confidence": 0.99,
            "reason": "Manual patch: bank SPEND coded to 505 treated as tax-related expense bucket",
            "rule_id": "PATCH_TAX_505_LESS_TAX",
        }

    # PATCH_PARTY_HIRE_BOND_REFUND_CREDIT
    if (
        tx_type == "CREDITNOTE-ACCPAYCREDIT"
        and "party hire" in contact_lower
        and _contains_any(description_lower, ["bond", "refund", "refundable"])
    ):
        row["AccountCode"] = row.get("AccountCode") or "420"
        row["AccountName"] = row.get("AccountName") or "Entertainment"
        return {
            "category": "Entertainment",
            "confidence": 0.98,
            "reason": "Bond refund credit note for Party Hire: treat as Entertainment refund (manual override)",
            "rule_id": "PATCH_PARTY_HIRE_BOND_REFUND_CREDIT",
        }

    # PATCH_PARTY_HIRE_REFUNDABLE_BOND_BILL
    if (
        tx_type == "BILL"
        and "party hire" in contact_lower
        and _contains_any(description_lower, ["bond", "refund", "refundable", "deposit"])
    ):
        row["AccountCode"] = row.get("AccountCode") or "420"
        row["AccountName"] = row.get("AccountName") or "Entertainment"
        return {
            "category": "Entertainment",
            "confidence": 0.98,
            "reason": "Party Hire refundable bond on bill treated as Entertainment by manual policy",
            "rule_id": "PATCH_PARTY_HIRE_REFUNDABLE_BOND_BILL",
        }

    # PATCH_ENTERTAINMENT_PARTY_HIRE_ONLY
    # Entertainment is strictly controlled: only Party Hire related lines are accepted.
    if (
        tx_type in {"BILL", "BANKTRANSACTION-SPEND", "MANUALJOURNAL", "CREDITNOTE-ACCPAYCREDIT"}
        and ("party hire" in description_lower or "party hire" in contact_lower)
    ):
        row["AccountName"] = row.get("AccountName") or "Entertainment"
        return {
            "category": "Entertainment",
            "confidence": 0.99,
            "reason": "Entertainment policy: Party Hire items only",
            "rule_id": "PATCH_ENTERTAINMENT_PARTY_HIRE_ONLY",
        }

    # PATCH_BANK_FEE_NAB_ONLY
    # Bank Fees are accepted only from bank statement style entries with NAB + FEE.
    if (
        is_bank_statement_tx
        and "national australia bank limited" in contact_lower
        and "fee" in description_lower
    ):
        return {
            "category": "Bank Fees",
            "confidence": 0.99,
            "reason": "Bank fee policy: NAB bank statement + fee keyword",
            "rule_id": "PATCH_BANK_FEE_NAB_ONLY",
        }

    # PATCH_GENERAL_EXPENSES_PHOTOCOPIER_REPAIRS
    if "photocopier" in description_lower and _contains_any(description_lower, ["repair", "repairs"]):
        return {
            "category": "General Expenses",
            "confidence": 0.99,
            "reason": "General expenses policy: photocopier repairs",
            "rule_id": "PATCH_GENERAL_EXPENSES_PHOTOCOPIER_REPAIRS",
        }

    # PATCH_BANK_TRANSFER
    if "TRANSFER" in tx_type and "bank transfer" in description_lower:
        row["AccountCode"] = "90"
        row["AccountName"] = "Business Bank Account"
        return {
            "category": fallback_category,
            "confidence": 0.98,
            "reason": "Internal bank transfer confirmed by review",
            "rule_id": "PATCH_BANK_TRANSFER",
        }

    return None


def _apply_post_mapping_policy_guards(
    row: Dict[str, Any],
    mapped: Dict[str, Any],
    fallback_category: str,
) -> Dict[str, Any]:
    """
    Enforce strict business policies after rule/LLM mapping.
    """
    category = str(mapped.get("category") or "")
    tx_type = str(row.get("Type") or "").upper()
    description_lower = str(row.get("Description") or "").lower()
    contact_lower = str(row.get("Contact") or "").lower()
    is_bank_statement_tx = tx_type.startswith("BANKTRANSACTION-")

    # Bank Fees policy: only NAB bank-statement fees are allowed.
    if category == "Bank Fees":
        is_allowed = (
            is_bank_statement_tx
            and "national australia bank limited" in contact_lower
            and "fee" in description_lower
        )
        if not is_allowed:
            return {
                "category": fallback_category,
                "confidence": 0.99,
                "reason": "Policy guard: non-NAB or non-bank-statement fee item ignored from Bank Fees",
                "rule_id": "POLICY_GUARD_BANK_FEES_NAB_ONLY",
            }

    # Entertainment policy: only Party Hire related entries are allowed.
    if category == "Entertainment":
        is_party_hire = ("party hire" in description_lower or "party hire" in contact_lower)
        if not is_party_hire:
            return {
                "category": fallback_category,
                "confidence": 0.99,
                "reason": "Policy guard: non-Party-Hire item ignored from Entertainment",
                "rule_id": "POLICY_GUARD_ENTERTAINMENT_PARTY_HIRE_ONLY",
            }

    # Office Expenses policy: anything marked as credit should be negative.
    if category == "Office Expenses" and ("credit" in description_lower or "CREDIT" in tx_type):
        try:
            amount_val = float(row.get("Amount") or 0.0)
        except (TypeError, ValueError):
            amount_val = 0.0
        row["Amount"] = -abs(amount_val)
        if not mapped.get("rule_id"):
            mapped["rule_id"] = "POLICY_GUARD_OFFICE_EXPENSES_CREDIT_NEGATIVE"
        if not mapped.get("reason"):
            mapped["reason"] = "Policy guard: office expense credit forced negative"

    return mapped


def load_category_definitions() -> Dict[str, Any]:
    if not CATEGORY_DEFINITIONS_FILE.exists():
        raise SystemExit(f"Missing category definitions file: {CATEGORY_DEFINITIONS_FILE}")
    with open(CATEGORY_DEFINITIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def prepare_category_lists() -> Dict[str, Any]:
    data = load_category_definitions()
    categories = data.get("categories", [])
    fallback = data.get("fallback_category", "Unmapped")

    payload = [
        {
            "name": c.get("name"),
            "type": c.get("type"),
            "description": c.get("description", ""),
        }
        for c in categories
        if c.get("name")
    ]
    fallback_item = {
        "name": fallback,
        "type": "fallback",
        "description": "Use only when no configured reporting category can be selected safely.",
    }
    allowed_payload = payload + ([] if fallback in {c["name"] for c in payload} else [fallback_item])
    allowed_names = [c["name"] for c in allowed_payload]
    income_payload = [c for c in payload if c.get("type") in {"income", "other_income"}] + [fallback_item]
    income_names = [c["name"] for c in income_payload]
    income_names = [name for name in income_names if name != fallback]
    payroll_payload = [c for c in payload if c.get("type") == "payroll"]
    payroll_names = [c["name"] for c in payroll_payload]

    if not payroll_names and "Wages and Salaries" in allowed_names:
        payroll_names = ["Wages and Salaries"]
        payroll_payload = [c for c in payload if c["name"] == "Wages and Salaries"]
    payroll_payload = payroll_payload + [fallback_item]

    return {
        "allowed_payload": allowed_payload,
        "allowed_names": allowed_names,
        "income_payload": income_payload,
        "income_names": income_names,
        "payroll_payload": payroll_payload,
        "payroll_names": payroll_names,
        "fallback": fallback,
    }


def _parse_amount(value: str) -> float:
    text = (value or "").strip().replace(",", "")
    if not text:
        return 0.0
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    try:
        return float(text)
    except ValueError:
        return 0.0


def _signed_journal_amount(value: Any) -> float:
    """Xero journal amounts are already debit-positive / credit-negative."""
    return _safe_float(value)


def _signed_balance_sheet_report_amount(section: str, category: str, amount: float) -> float:
    """
    Convert Xero Balance Sheet presentation into the training convention:
    debit = positive, credit = negative.

    Xero presents liability rows as positive balances in the report, but those
    balances are normally credit balances. Asset and equity rows already follow
    the debit/credit sign convention in the raw report payload.
    """
    section_lower = str(section or "").lower()
    if section_lower in {"liabilities", "current liabilities"}:
        return -amount
    return amount


def _signed_line_item_amount(tx_type: str, amount: float) -> float:
    tx_type_upper = str(tx_type or "").upper()
    if tx_type_upper in {"BILL", "BANKTRANSACTION-SPEND"} or tx_type_upper == "CREDITNOTE-ACCRECCREDIT":
        return abs(amount)
    if tx_type_upper in {"INVOICE", "BANKTRANSACTION-RECEIVE"} or tx_type_upper == "CREDITNOTE-ACCPAYCREDIT":
        return -abs(amount)
    return amount


def extract_xero_pl_lines(pl_payload: Dict[str, Any]) -> pd.DataFrame:
    lines: list[dict[str, Any]] = []

    def walk_rows(rows: list[dict[str, Any]]) -> None:
        for row in rows:
            row_type = row.get("RowType")
            if row_type == "Row":
                cells = row.get("Cells", [])
                if len(cells) >= 2:
                    name_cell = cells[0]
                    attributes = name_cell.get("Attributes", [])
                    # Only include actual account rows (not gross/net profit)
                    if any(attr.get("Id") == "account" for attr in attributes):
                        name = name_cell.get("Value", "").strip()
                        total = 0.0
                        for cell in cells[1:]:
                            total += _parse_amount(cell.get("Value", ""))
                        lines.append({"Category": name, "Amount": total})
            if row.get("Rows"):
                walk_rows(row["Rows"])

    reports = pl_payload.get("Reports", [])
    if reports:
        walk_rows(reports[0].get("Rows", []))

    return pd.DataFrame(lines)


def extract_xero_pl_net_profit(pl_payload: Dict[str, Any]) -> float:
    """Extract Xero P&L net profit/loss using the report's own summary row."""

    def walk_rows(rows: list[dict[str, Any]]) -> Optional[float]:
        for row in rows:
            if row.get("RowType") == "Row":
                cells = row.get("Cells", []) or []
                if len(cells) >= 2:
                    label = str(cells[0].get("Value") or "").strip().upper()
                    if label in {"NET PROFIT", "NET LOSS"}:
                        return _parse_amount(str(cells[1].get("Value") or ""))
            if row.get("Rows"):
                found = walk_rows(row["Rows"])
                if found is not None:
                    return found
        return None

    reports = pl_payload.get("Reports", [])
    if reports:
        found = walk_rows(reports[0].get("Rows", []))
        if found is not None:
            return found
    return 0.0


def extract_report_lines(report_payload: Dict[str, Any]) -> pd.DataFrame:
    """Generic report line extraction (first column = label, remaining numeric cells summed)."""
    lines: list[dict[str, Any]] = []

    def walk_rows(rows: list[dict[str, Any]]) -> None:
        for row in rows:
            row_type = row.get("RowType")
            if row_type == "Row":
                cells = row.get("Cells", [])
                if cells:
                    name = cells[0].get("Value", "").strip()
                    total = 0.0
                    for cell in cells[1:]:
                        total += _parse_amount(cell.get("Value", ""))
                    if name or total != 0.0:
                        lines.append({"Category": name or "Unlabeled", "Amount": total})
            if row.get("Rows"):
                walk_rows(row["Rows"])

    reports = report_payload.get("Reports", [])
    if reports:
        walk_rows(reports[0].get("Rows", []))

    return pd.DataFrame(lines)


def _cell_attributes(cell: Dict[str, Any]) -> Dict[str, Any]:
    attrs: Dict[str, Any] = {}
    for attr in cell.get("Attributes", []) or []:
        attr_id = str(attr.get("Id") or "").strip().lower()
        if attr_id:
            attrs[attr_id] = attr.get("Value")
    return attrs


def extract_xero_balance_sheet_lines(balance_sheet_payload: Dict[str, Any]) -> pd.DataFrame:
    """Extract account rows from Xero Balance Sheet while preserving section hierarchy."""
    lines: list[dict[str, Any]] = []

    def walk_rows(rows: list[dict[str, Any]], section_path: list[str]) -> None:
        for row in rows:
            row_type = row.get("RowType")
            title = str(row.get("Title") or "").strip()
            next_path = section_path

            if row_type == "Section":
                next_path = section_path + ([title] if title else [])
                if row.get("Rows"):
                    walk_rows(row["Rows"], next_path)
                continue

            if row_type == "Row":
                cells = row.get("Cells", []) or []
                if len(cells) >= 2:
                    name_cell = cells[0]
                    name = str(name_cell.get("Value") or "").strip()
                    attrs = _cell_attributes(name_cell)
                    has_account_ref = "account" in attrs or "accountid" in attrs
                    if has_account_ref or name:
                        # Xero Balance Sheet can include comparative columns
                        # (for example 31 Mar 2026 and 31 Mar 2025). The first
                        # numeric cell is the requested as-at date; later cells
                        # are comparative periods and must not be summed.
                        raw_total = _parse_amount(str(cells[1].get("Value") or ""))
                        section = next_path[0] if next_path else ""
                        category = name or (next_path[-1] if next_path else BALANCE_SHEET_FALLBACK_CATEGORY)
                        total = _signed_balance_sheet_report_amount(section, category, raw_total)
                        lines.append(
                            {
                                "BalanceSheetSection": section,
                                "BalanceSheetSectionPath": " > ".join(next_path),
                                "BalanceSheetCategory": category,
                                "BalanceSheetAccountName": name,
                                "AccountID": attrs.get("accountid") or attrs.get("account"),
                                "AccountCode": attrs.get("accountcode") or attrs.get("code"),
                                "Amount": total,
                                "XeroRowType": row_type,
                            }
                        )

            if row.get("Rows"):
                walk_rows(row["Rows"], next_path)

    reports = balance_sheet_payload.get("Reports", [])
    if reports:
        walk_rows(reports[0].get("Rows", []), [])

    return pd.DataFrame(lines)


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _contact_name(item: Dict[str, Any]) -> str:
    contact = item.get("Contact")
    if isinstance(contact, dict):
        return contact.get("Name") or ""
    return str(contact or "")


def _account_name_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _section_from_account_class(account_class: str) -> str:
    normalized = account_class.upper()
    if normalized == "ASSET":
        return "Assets"
    if normalized == "LIABILITY":
        return "Liabilities"
    if normalized == "EQUITY":
        return "Equity"
    return normalized.title() or "Balance Sheet"


def _build_balance_sheet_account_map(
    balance_sheet_df: pd.DataFrame,
    account_rows: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Dict[str, Any]]]:
    accounts_by_id = {
        str(row.get("AccountID") or "").strip(): row
        for row in account_rows
        if row.get("AccountID")
    }
    accounts_by_name = {
        _account_name_key(row.get("Name")): row
        for row in account_rows
        if row.get("Name")
    }
    by_code: Dict[str, Dict[str, Any]] = {}
    by_name: Dict[str, Dict[str, Any]] = {}

    if balance_sheet_df.empty:
        return {"by_code": by_code, "by_name": by_name}

    for _, bs_row in balance_sheet_df.iterrows():
        mapping = {
            "section": bs_row.get("BalanceSheetSection") or "",
            "section_path": bs_row.get("BalanceSheetSectionPath") or "",
            "category": bs_row.get("BalanceSheetCategory") or BALANCE_SHEET_FALLBACK_CATEGORY,
            "account_name": bs_row.get("BalanceSheetAccountName") or bs_row.get("BalanceSheetCategory") or "",
            "source": "xero_balance_sheet",
        }

        account_code = str(bs_row.get("AccountCode") or "").strip()
        account_id = str(bs_row.get("AccountID") or "").strip()
        account_name_key = _account_name_key(bs_row.get("BalanceSheetAccountName") or bs_row.get("BalanceSheetCategory"))

        if account_id and account_id in accounts_by_id:
            account_code = str(accounts_by_id[account_id].get("Code") or account_code).strip()
        if not account_code and account_name_key in accounts_by_name:
            account_code = str(accounts_by_name[account_name_key].get("Code") or "").strip()

        if account_code:
            by_code[account_code] = mapping
        if account_name_key:
            by_name[account_name_key] = mapping

    return {"by_code": by_code, "by_name": by_name}


def _enrich_balance_sheet_account_codes(
    balance_sheet_df: pd.DataFrame,
    account_rows: List[Dict[str, Any]],
) -> pd.DataFrame:
    if balance_sheet_df.empty:
        return balance_sheet_df

    accounts_by_id = {
        str(row.get("AccountID") or "").strip(): str(row.get("Code") or "").strip()
        for row in account_rows
        if row.get("AccountID") and row.get("Code")
    }
    accounts_by_name = {
        _account_name_key(row.get("Name")): str(row.get("Code") or "").strip()
        for row in account_rows
        if row.get("Name") and row.get("Code")
    }

    enriched = balance_sheet_df.copy()
    if "AccountCode" not in enriched.columns:
        enriched["AccountCode"] = ""

    for idx, row in enriched.iterrows():
        if str(row.get("AccountCode") or "").strip():
            continue
        account_id = str(row.get("AccountID") or "").strip()
        account_name = _account_name_key(row.get("BalanceSheetAccountName") or row.get("BalanceSheetCategory"))
        code = accounts_by_id.get(account_id) or accounts_by_name.get(account_name)
        if code:
            enriched.at[idx, "AccountCode"] = code

    return enriched


def _fallback_balance_sheet_mapping(account_meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not account_meta:
        return {
            "section": "",
            "section_path": "",
            "category": BALANCE_SHEET_FALLBACK_CATEGORY,
            "account_name": "",
            "source": "unmapped",
        }

    account_class = str(account_meta.get("Class") or "").strip().upper()
    section = _section_from_account_class(account_class)
    category = account_meta.get("ReportingCodeName") or account_meta.get("Name") or account_meta.get("Type")
    account_name = account_meta.get("Name") or category or BALANCE_SHEET_FALLBACK_CATEGORY
    return {
        "section": section,
        "section_path": " > ".join([part for part in [section, str(category or "").strip()] if part]),
        "category": category or BALANCE_SHEET_FALLBACK_CATEGORY,
        "account_name": account_name,
        "source": "chart_of_accounts",
    }


def _map_balance_sheet_rows(
    rows: List[Dict[str, Any]],
    account_meta_lookup: Dict[str, Dict[str, Any]],
    balance_sheet_map: Dict[str, Dict[str, Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    mapped_rows: List[Dict[str, Any]] = []
    by_code = balance_sheet_map.get("by_code", {})
    by_name = balance_sheet_map.get("by_name", {})

    for row in rows:
        account_code = str(row.get("AccountCode") or "").strip()
        account_name = row.get("AccountName") or ""
        account_meta = account_meta_lookup.get(account_code)
        account_class = str((account_meta or {}).get("Class") or "").strip().upper()
        if account_class not in BALANCE_SHEET_CLASSES:
            continue

        tx_type = str(row.get("Type") or "").upper()
        description_lower = str(row.get("Description") or "").lower()
        if tx_type == "BANKTRANSACTION-SPEND" and account_code == "825" and "less tax" in description_lower:
            row["Amount"] = -abs(_safe_float(row.get("Amount")))

        mapping = by_code.get(account_code) or by_name.get(_account_name_key(account_name))
        if mapping is None:
            mapping = _fallback_balance_sheet_mapping(account_meta)

        mapped_rows.append(
            {
                **row,
                "BalanceSheetSection": mapping.get("section"),
                "BalanceSheetSectionPath": mapping.get("section_path"),
                "BalanceSheetCategory": mapping.get("category"),
                "BalanceSheetAccountName": mapping.get("account_name") or account_name,
                "BalanceSheetMappingSource": mapping.get("source"),
                "BalanceSheetReason": (
                    "Mapped from Xero Balance Sheet structure"
                    if mapping.get("source") == "xero_balance_sheet"
                    else "Mapped from chart of accounts fallback"
                    if mapping.get("source") == "chart_of_accounts"
                    else "No Balance Sheet account mapping found"
                ),
            }
        )

    return mapped_rows


def _write_xero_ai_diff_debug_outputs(
    mapped_df: pd.DataFrame,
    xero_pl_df: pd.DataFrame,
    comparison_df: pd.DataFrame,
) -> None:
    """
    Persist line-by-line diagnostics so category-level diffs can be traced back
    to individual mapped rows and likely root causes.
    """
    if mapped_df.empty or comparison_df.empty:
        return

    comp = comparison_df.copy()
    comp["Category"] = comp["Category"].fillna("Unmapped")
    comp["Xero_Amount"] = pd.to_numeric(comp["Xero_Amount"], errors="coerce").fillna(0.0)
    comp["AI_Amount"] = pd.to_numeric(comp["AI_Amount"], errors="coerce").fillna(0.0)
    comp["Difference"] = pd.to_numeric(comp["Difference"], errors="coerce").fillna(0.0)
    comp["AbsDifference"] = comp["Difference"].abs()
    comp["Status"] = comp["Difference"].apply(
        lambda v: "match" if abs(v) <= 0.01 else ("ai_over" if v > 0 else "ai_under")
    )
    comp.sort_values("AbsDifference", ascending=False, inplace=True)
    comp.to_csv(OUTPUT_DIR / "xero_vs_ai_diff_detailed.csv", index=False)
    comp.to_excel(OUTPUT_DIR / "xero_vs_ai_diff_detailed.xlsx", index=False)

    xero_categories = set(xero_pl_df.get("Category", pd.Series(dtype=str)).fillna("").astype(str))
    xero_categories.discard("")
    ai_categories = set(mapped_df.get("MappedCategory", pd.Series(dtype=str)).fillna("Unmapped").astype(str))

    category_diff_lookup: Dict[str, Dict[str, float]] = {}
    for _, row in comp.iterrows():
        category = str(row["Category"])
        category_diff_lookup[category] = {
            "xero_amount": float(row["Xero_Amount"]),
            "ai_amount": float(row["AI_Amount"]),
            "difference": float(row["Difference"]),
        }

    line_debug_rows: List[Dict[str, Any]] = []
    for _, tx in mapped_df.iterrows():
        mapped_category = str(tx.get("MappedCategory") or "Unmapped")
        account_name = str(tx.get("AccountName") or "")
        confidence = float(pd.to_numeric(tx.get("Confidence", 0), errors="coerce") or 0.0)
        category_diff = category_diff_lookup.get(
            mapped_category,
            {"xero_amount": 0.0, "ai_amount": 0.0, "difference": 0.0},
        )
        diff_value = float(category_diff["difference"])
        amount = float(pd.to_numeric(tx.get("Amount", 0), errors="coerce") or 0.0)

        reasons: List[str] = []
        if confidence < REVIEW_CONFIDENCE_THRESHOLD:
            reasons.append("Low confidence mapping")
        if mapped_category not in xero_categories:
            reasons.append("Mapped category not found in Xero P&L category names")
        if account_name and account_name in xero_categories and mapped_category != account_name:
            reasons.append("Account name differs from mapped category while account name exists in Xero P&L")
        if abs(diff_value) > 0.01:
            if diff_value > 0:
                reasons.append("This category is overstated in AI vs Xero")
            else:
                reasons.append("This category is understated in AI vs Xero")

        line_debug_rows.append(
            {
                "Date": tx.get("Date"),
                "Type": tx.get("Type"),
                "InvoiceNumber": tx.get("InvoiceNumber"),
                "Contact": tx.get("Contact"),
                "Description": tx.get("Description"),
                "AccountCode": tx.get("AccountCode"),
                "AccountName": tx.get("AccountName"),
                "MappedCategory": mapped_category,
                "Amount": amount,
                "Confidence": confidence,
                "RuleID": tx.get("RuleID"),
                "CategoryXeroAmount": category_diff["xero_amount"],
                "CategoryAIAmount": category_diff["ai_amount"],
                "CategoryDifference": diff_value,
                "PotentialIssueCount": len(reasons),
                "PotentialIssues": "; ".join(reasons),
            }
        )

    line_debug_df = pd.DataFrame(line_debug_rows)
    if not line_debug_df.empty:
        line_debug_df["AbsAmount"] = line_debug_df["Amount"].abs()
        line_debug_df["AbsCategoryDifference"] = line_debug_df["CategoryDifference"].abs()
        line_debug_df.sort_values(
            by=["PotentialIssueCount", "AbsCategoryDifference", "AbsAmount"],
            ascending=[False, False, False],
            inplace=True,
        )
        line_debug_df.to_csv(OUTPUT_DIR / "xero_vs_ai_line_debug.csv", index=False)
        line_debug_df.to_excel(OUTPUT_DIR / "xero_vs_ai_line_debug.xlsx", index=False)

        suspicious_df = line_debug_df[line_debug_df["PotentialIssueCount"] > 0].copy()
        suspicious_df.to_csv(OUTPUT_DIR / "xero_vs_ai_suspicious_lines.csv", index=False)
        suspicious_df.to_excel(OUTPUT_DIR / "xero_vs_ai_suspicious_lines.xlsx", index=False)

    summary_payload = {
        "xero_category_count": len(xero_categories),
        "ai_category_count": len(ai_categories),
        "overlap_category_count": len(xero_categories & ai_categories),
        "xero_only_categories": sorted(xero_categories - ai_categories),
        "ai_only_categories": sorted(ai_categories - xero_categories),
        "total_xero_amount": float(comp["Xero_Amount"].sum()),
        "total_ai_amount": float(comp["AI_Amount"].sum()),
        "total_abs_category_diff": float(comp["AbsDifference"].sum()),
    }
    (OUTPUT_DIR / "xero_vs_ai_debug_summary.json").write_text(
        json.dumps(summary_payload, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )


def _apply_category_normalization(df: pd.DataFrame, allowed_categories: List[str]) -> pd.DataFrame:
    """
    Normalize mapped categories into the reporting taxonomy used by Xero P&L.
    Keeps original model output for traceability.
    """
    if df.empty:
        return df

    allowed_set = set(allowed_categories)
    normalized_df = df.copy()
    normalized_df["OriginalMappedCategory"] = normalized_df.get("MappedCategory", "Unmapped").fillna("Unmapped")
    normalized_df["NormalizationRule"] = None

    def _normalize(value: Any) -> str:
        category = str(value or "Unmapped")
        if category in CATEGORY_NORMALIZATION_MAP:
            return CATEGORY_NORMALIZATION_MAP[category]
        return category

    normalized_df["MappedCategory"] = normalized_df["OriginalMappedCategory"].apply(_normalize)

    applied_rules: List[str] = []
    for source, target in CATEGORY_NORMALIZATION_MAP.items():
        matched = normalized_df["OriginalMappedCategory"] == source
        if matched.any():
            normalized_df.loc[matched, "NormalizationRule"] = f"{source} -> {target}"
            applied_rules.append(f"{source} -> {target} ({int(matched.sum())})")

    # Keep unmapped strings from drifting outside configured categories.
    normalized_df.loc[
        ~normalized_df["MappedCategory"].isin(allowed_set),
        "MappedCategory",
    ] = "Unmapped"
    normalized_df.loc[
        normalized_df["MappedCategory"] == "Unmapped",
        "NormalizationRule",
    ] = normalized_df["NormalizationRule"].fillna("Fallback to Unmapped")

    if applied_rules:
        print("Category normalization applied:", "; ".join(applied_rules))
    else:
        print("Category normalization applied: no mapping changes.")

    return normalized_df


def _write_wages_reconciliation_debug(df: pd.DataFrame) -> None:
    """
    Output reconciliation debug views for wage/payg structure so payroll-related
    variances can be diagnosed separately from NLP mapping quality.
    """
    if df.empty:
        return

    wage_codes = {"477", "825"}
    working = df.copy()
    working["AccountCodeStr"] = working.get("AccountCode", "").fillna("").astype(str).str.strip()
    working["AccountNameStr"] = working.get("AccountName", "").fillna("").astype(str)
    working["TypeStr"] = working.get("Type", "").fillna("").astype(str)
    working["Amount"] = pd.to_numeric(working.get("Amount", 0), errors="coerce").fillna(0.0)
    working["ParsedDate"] = working.get("Date").apply(_parse_xero_date)

    wage_like = (
        working["AccountCodeStr"].isin(wage_codes)
        | working["AccountNameStr"].str.contains("wages|payg", case=False, na=False)
    )
    wage_df = working[wage_like].copy()
    if wage_df.empty:
        print("Wages reconciliation debug: no 477/825 wage-like rows found.")
        return

    def _bucket(row: pd.Series) -> str:
        code = row.get("AccountCodeStr", "")
        if code == "477":
            return "GrossWages"
        if code == "825":
            return "PAYGWithholding"
        if "wages" in str(row.get("AccountNameStr", "")).lower():
            return "GrossWagesLike"
        if "payg" in str(row.get("AccountNameStr", "")).lower():
            return "PAYGWithholdingLike"
        return "OtherWageLike"

    wage_df["WageBucket"] = wage_df.apply(_bucket, axis=1)
    wage_df["Month"] = wage_df["ParsedDate"].apply(lambda d: d.strftime("%Y-%m") if d else "Unknown")
    wage_df["ExpectedSign"] = wage_df["WageBucket"].map(
        {
            "GrossWages": "positive",
            "PAYGWithholding": "negative",
            "GrossWagesLike": "positive",
            "PAYGWithholdingLike": "negative",
        }
    ).fillna("n/a")
    wage_df["SignCheck"] = wage_df.apply(
        lambda r: (
            "ok"
            if (
                (r["ExpectedSign"] == "positive" and r["Amount"] >= 0)
                or (r["ExpectedSign"] == "negative" and r["Amount"] <= 0)
                or r["ExpectedSign"] == "n/a"
            )
            else "unexpected_sign"
        ),
        axis=1,
    )

    detail_cols = [
        "Date",
        "Month",
        "Type",
        "InvoiceNumber",
        "Contact",
        "Description",
        "AccountCode",
        "AccountName",
        "WageBucket",
        "ExpectedSign",
        "SignCheck",
        "Amount",
        "MappedCategory",
        "Confidence",
        "RuleID",
    ]
    wage_detail = wage_df[detail_cols].copy()
    wage_detail.sort_values(by=["Month", "WageBucket", "Amount"], ascending=[True, True, False], inplace=True)
    wage_detail.to_csv(OUTPUT_DIR / "wages_reconciliation_lines.csv", index=False)
    wage_detail.to_excel(OUTPUT_DIR / "wages_reconciliation_lines.xlsx", index=False)

    monthly = (
        wage_df.groupby(["Month", "WageBucket"])["Amount"]
        .sum()
        .unstack(fill_value=0.0)
        .reset_index()
    )
    for col in ["GrossWages", "PAYGWithholding", "GrossWagesLike", "PAYGWithholdingLike"]:
        if col not in monthly.columns:
            monthly[col] = 0.0
    monthly["NetWagesAfterWithholding"] = (
        monthly["GrossWages"]
        + monthly["PAYGWithholding"]
        + monthly["GrossWagesLike"]
        + monthly["PAYGWithholdingLike"]
    )
    monthly.sort_values("Month", inplace=True)
    monthly.to_csv(OUTPUT_DIR / "wages_reconciliation_summary.csv", index=False)
    monthly.to_excel(OUTPUT_DIR / "wages_reconciliation_summary.xlsx", index=False)

    totals = {
        "gross_wages_total": float(monthly["GrossWages"].sum() + monthly["GrossWagesLike"].sum()),
        "payg_withholding_total": float(monthly["PAYGWithholding"].sum() + monthly["PAYGWithholdingLike"].sum()),
        "net_after_withholding_total": float(monthly["NetWagesAfterWithholding"].sum()),
        "rows_total": int(len(wage_detail)),
        "unexpected_sign_rows": int((wage_detail["SignCheck"] == "unexpected_sign").sum()),
    }
    (OUTPUT_DIR / "wages_reconciliation_summary.json").write_text(
        json.dumps(totals, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )
    print(
        "Wrote wages reconciliation debug files: "
        "wages_reconciliation_lines.xlsx / wages_reconciliation_summary.xlsx / wages_reconciliation_summary.json"
    )


def _load_env_and_token() -> Dict[str, Any]:
    settings = load_settings()
    tenant_id = settings.xero_tenant_id
    if not tenant_id:
        raise SystemExit("XERO_TENANT_ID is not set. Please run login_xero.py first.")

    token = load_token()
    if not token or "access_token" not in token:
        raise SystemExit("No Xero access token found. Please run login_xero.py first.")

    if token.get("refresh_token") and settings.xero_client_id and settings.xero_client_secret:
        try:
            token = refresh_access_token(
                settings.xero_client_id,
                settings.xero_client_secret,
                token["refresh_token"],
            )
            print("Refreshed Xero access token.")
        except Exception as exc:  # noqa: BLE001
            print(f"Could not refresh Xero access token; using existing token: {exc}")

    return {"access_token": token["access_token"], "tenant_id": tenant_id}


def _flatten_line_items(
    items: List[Dict[str, Any]],
    tx_type: str,
    start_date: date,
    end_date: date,
    account_lookup: Dict[str, str],
    id_key: str,
    date_key: str,
    number_key: str,
    contact_key: str,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in items:
        status = str(item.get("Status") or "").upper().strip()
        # Ignore deleted/voided source documents to avoid duplicate/stale lines.
        if status in {"DELETED", "VOIDED"}:
            continue

        contact = ""
        if contact_key == "Contact":
            contact = item.get("Contact", {}).get("Name", "")
        else:
            contact = item.get(contact_key, "") or ""
        reference = item.get(number_key) or item.get(id_key)
        date_raw = item.get(date_key)
        date_str, date_obj = _normalize_xero_date(date_raw)
        if not _in_date_range(date_obj, start_date, end_date):
            continue
        for line in item.get("LineItems", []):
            desc = line.get("Description", "") or ""
            amount = _to_gst_exclusive_amount(line, item)
            account_code = line.get("AccountCode")
            account_code_str = str(account_code).strip() if account_code is not None else ""
            account_name = account_lookup.get(account_code_str)

            rows.append(
                {
                    "Type": tx_type,
                    "InvoiceNumber": reference,
                    "Date": date_str or date_raw,
                    "Contact": contact,
                    "AccountCode": account_code_str or None,
                    "AccountName": account_name,
                    "Description": desc,
                    "Amount": _signed_line_item_amount(tx_type, amount),
                }
            )
    return rows


def flatten_invoices(
    invoices_payload: Dict[str, Any],
    tx_type: str,
    start_date: date,
    end_date: date,
    account_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Flatten the Xero invoices/bills payload into line-level rows."""
    return _flatten_line_items(
        invoices_payload.get("Invoices", []),
        tx_type=tx_type,
        start_date=start_date,
        end_date=end_date,
        account_lookup=account_lookup,
        id_key="InvoiceID",
        number_key="InvoiceNumber",
        date_key="DateString",
        contact_key="Contact",
    )


def flatten_bank_transactions(
    bank_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
    account_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Flatten bank transactions into line-level rows."""
    rows: List[Dict[str, Any]] = []
    for tx in bank_payload.get("BankTransactions", []):
        tx_type = f"BankTransaction-{tx.get('Type') or ''}".strip("-")
        rows.extend(
            _flatten_line_items(
                [tx],
                tx_type=tx_type or "BankTransaction",
                start_date=start_date,
                end_date=end_date,
                account_lookup=account_lookup,
                id_key="BankTransactionID",
                number_key="Reference",
                date_key="Date",
                contact_key="Contact",
            )
        )
    return rows


def flatten_credit_notes(
    credit_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
    account_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Flatten credit notes into line-level rows."""
    rows: List[Dict[str, Any]] = []
    for note in credit_payload.get("CreditNotes", []):
        tx_type = f"CreditNote-{note.get('Type') or ''}".strip("-")
        rows.extend(
            _flatten_line_items(
                [note],
                tx_type=tx_type or "CreditNote",
                start_date=start_date,
                end_date=end_date,
                account_lookup=account_lookup,
                id_key="CreditNoteID",
                number_key="CreditNoteNumber",
                date_key="Date",
                contact_key="Contact",
            )
        )
    return rows


def _find_account_code(
    account_rows: List[Dict[str, Any]],
    names: List[str],
    account_class: Optional[str] = None,
) -> Optional[str]:
    wanted = {_account_name_key(name) for name in names}
    wanted_class = account_class.upper() if account_class else None
    for account in account_rows:
        name = _account_name_key(account.get("Name"))
        if name not in wanted:
            continue
        if wanted_class and str(account.get("Class") or "").upper() != wanted_class:
            continue
        code = str(account.get("Code") or "").strip()
        if code:
            return code
    return None


def _append_gst_synthetic_rows(
    rows: List[Dict[str, Any]],
    item: Dict[str, Any],
    tx_type: str,
    reference: Any,
    date_value: Any,
    contact: str,
    gst_account_code: Optional[str],
    account_lookup: Dict[str, str],
    tax_sign: float,
) -> None:
    if not gst_account_code:
        return
    for line in item.get("LineItems", []) or []:
        tax_amount = _safe_float(line.get("TaxAmount"))
        if tax_amount == 0.0:
            continue
        rows.append(
            {
                "Type": tx_type,
                "InvoiceNumber": reference,
                "Date": date_value,
                "Contact": contact,
                "AccountCode": gst_account_code,
                "AccountName": account_lookup.get(gst_account_code),
                "Description": f"GST on {line.get('Description') or tx_type}",
                "Amount": tax_sign * tax_amount,
                "BalanceSheetSyntheticKind": "GST",
            }
        )


def flatten_invoice_balance_sheet_synthetic_rows(
    invoices_payload: Dict[str, Any],
    tx_type: str,
    start_date: date,
    end_date: date,
    control_account_code: Optional[str],
    gst_account_code: Optional[str],
    account_lookup: Dict[str, str],
    tax_sign: float,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not control_account_code:
        return rows

    for invoice in invoices_payload.get("Invoices", []) or []:
        status = str(invoice.get("Status") or "").upper().strip()
        if status in {"DELETED", "VOIDED", "DRAFT"}:
            continue
        date_raw = invoice.get("DateString") or invoice.get("Date")
        date_str, date_obj = _normalize_xero_date(date_raw)
        if not _in_date_range(date_obj, start_date, end_date):
            continue

        contact = _contact_name(invoice)
        reference = invoice.get("InvoiceNumber") or invoice.get("InvoiceID")
        rows.append(
            {
                "Type": f"{tx_type}-Control",
                "InvoiceNumber": reference,
                "Date": date_str or date_raw,
                "Contact": contact,
                "AccountCode": control_account_code,
                "AccountName": account_lookup.get(control_account_code),
                "Description": f"{tx_type} gross balance",
                "Amount": -abs(_safe_float(invoice.get("Total"))) if tx_type == "Bill" else abs(_safe_float(invoice.get("Total"))),
                "BalanceSheetSyntheticKind": "InvoiceGross",
                "SourceDocumentID": invoice.get("InvoiceID"),
                "Status": status,
            }
        )

        for payment in invoice.get("Payments", []) or []:
            payment_date_raw = payment.get("Date")
            payment_date_str, payment_date_obj = _normalize_xero_date(payment_date_raw)
            if not _in_date_range(payment_date_obj, start_date, end_date):
                continue
            rows.append(
                {
                    "Type": f"{tx_type}-Payment",
                    "InvoiceNumber": reference,
                    "Date": payment_date_str or payment_date_raw,
                    "Contact": contact,
                    "AccountCode": control_account_code,
                    "AccountName": account_lookup.get(control_account_code),
                    "Description": f"{tx_type} payment allocation",
                    "Amount": abs(_safe_float(payment.get("Amount"))) if tx_type == "Bill" else -abs(_safe_float(payment.get("Amount"))),
                    "BalanceSheetSyntheticKind": "Payment",
                    "SourceDocumentID": invoice.get("InvoiceID"),
                    "PaymentID": payment.get("PaymentID"),
                    "Status": status,
                }
            )

        _append_gst_synthetic_rows(
            rows,
            invoice,
            f"{tx_type}-GST",
            reference,
            date_str or date_raw,
            contact,
            gst_account_code,
            account_lookup,
            tax_sign,
        )

    return rows


def flatten_bank_balance_sheet_synthetic_rows(
    bank_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
    gst_account_code: Optional[str],
    account_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for tx in bank_payload.get("BankTransactions", []) or []:
        status = str(tx.get("Status") or "").upper().strip()
        if status in {"DELETED", "VOIDED", "DRAFT"}:
            continue
        date_raw = tx.get("DateString") or tx.get("Date")
        date_str, date_obj = _normalize_xero_date(date_raw)
        if not _in_date_range(date_obj, start_date, end_date):
            continue

        bank_account = tx.get("BankAccount") or {}
        bank_code = str(bank_account.get("Code") or "").strip()
        tx_type = str(tx.get("Type") or "").upper()
        if tx_type == "RECEIVE":
            bank_sign = 1.0
            tax_sign = -1.0
        elif tx_type == "SPEND":
            bank_sign = -1.0
            tax_sign = 1.0
        else:
            bank_sign = 0.0
            tax_sign = 0.0

        reference = tx.get("Reference") or tx.get("BankTransactionID")
        contact = _contact_name(tx)
        if bank_code and bank_sign:
            rows.append(
                {
                    "Type": f"BankTransaction-{tx_type}-Bank",
                    "InvoiceNumber": reference,
                    "Date": date_str or date_raw,
                    "Contact": contact,
                    "AccountCode": bank_code,
                    "AccountName": account_lookup.get(bank_code) or bank_account.get("Name"),
                    "Description": f"Bank account movement for {tx_type.lower()} transaction",
                    "Amount": bank_sign * _safe_float(tx.get("Total")),
                    "BalanceSheetSyntheticKind": "BankAccount",
                    "SourceDocumentID": tx.get("BankTransactionID"),
                    "Status": status,
                }
            )

        if tax_sign:
            _append_gst_synthetic_rows(
                rows,
                tx,
                f"BankTransaction-{tx_type}-GST",
                reference,
                date_str or date_raw,
                contact,
                gst_account_code,
                account_lookup,
                tax_sign,
            )

    return rows


def flatten_credit_note_balance_sheet_synthetic_rows(
    credit_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
    receivable_account_code: Optional[str],
    payable_account_code: Optional[str],
    gst_account_code: Optional[str],
    account_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for note in credit_payload.get("CreditNotes", []) or []:
        status = str(note.get("Status") or "").upper().strip()
        if status in {"DELETED", "VOIDED", "DRAFT"}:
            continue
        date_raw = note.get("DateString") or note.get("Date")
        date_str, date_obj = _normalize_xero_date(date_raw)
        if not _in_date_range(date_obj, start_date, end_date):
            continue

        note_type = str(note.get("Type") or "").upper()
        if note_type == "ACCRECCREDIT":
            control_code = receivable_account_code
            tax_sign = 1.0
        elif note_type == "ACCPAYCREDIT":
            control_code = payable_account_code
            tax_sign = -1.0
        else:
            control_code = None
            tax_sign = 0.0
        if not control_code:
            continue

        contact = _contact_name(note)
        reference = note.get("CreditNoteNumber") or note.get("CreditNoteID")
        rows.append(
            {
                "Type": f"CreditNote-{note_type}-Control",
                "InvoiceNumber": reference,
                "Date": date_str or date_raw,
                "Contact": contact,
                "AccountCode": control_code,
                "AccountName": account_lookup.get(control_code),
                "Description": f"{note_type} credit note control balance",
                "Amount": abs(_safe_float(note.get("Total"))) if note_type == "ACCPAYCREDIT" else -abs(_safe_float(note.get("Total"))),
                "BalanceSheetSyntheticKind": "CreditNoteGross",
                "SourceDocumentID": note.get("CreditNoteID"),
                "Status": status,
            }
        )
        _append_gst_synthetic_rows(
            rows,
            note,
            f"CreditNote-{note_type}-GST",
            reference,
            date_str or date_raw,
            contact,
            gst_account_code,
            account_lookup,
            tax_sign,
        )

    return rows


def flatten_payments_balance_sheet_evidence_rows(
    payments_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
    account_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for payment in payments_payload.get("Payments", []) or []:
        status = str(payment.get("Status") or "").upper().strip()
        if status in {"DELETED", "VOIDED"}:
            continue
        date_raw = payment.get("Date")
        date_str, date_obj = _normalize_xero_date(date_raw)
        if not _in_date_range(date_obj, start_date, end_date):
            continue

        account = payment.get("Account") or {}
        account_code = str(account.get("Code") or "").strip()
        if not account_code:
            continue
        invoice = payment.get("Invoice") or {}
        contact = _contact_name(invoice) or _contact_name(payment)
        rows.append(
            {
                "Type": "Payment",
                "InvoiceNumber": invoice.get("InvoiceNumber") or invoice.get("InvoiceID") or payment.get("PaymentID"),
                "Date": date_str or date_raw,
                "Contact": contact,
                "AccountCode": account_code,
                "AccountName": account_lookup.get(account_code) or account.get("Name"),
                "Description": f"Payment {payment.get('PaymentID') or ''}".strip(),
                "Amount": (
                    -abs(_safe_float(payment.get("Amount")))
                    if str(payment.get("PaymentType") or "").upper().startswith("ACCPAY")
                    else abs(_safe_float(payment.get("Amount")))
                    if str(payment.get("PaymentType") or "").upper().startswith("ACCREC")
                    else _safe_float(payment.get("Amount"))
                ),
                "BalanceSheetSyntheticKind": "PaymentEndpoint",
                "SourceDocumentID": payment.get("PaymentID"),
                "Status": status,
            }
        )
    return rows


def flatten_bank_transfers_balance_sheet_evidence_rows(
    transfers_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
    account_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for transfer in transfers_payload.get("BankTransfers", []) or []:
        date_raw = transfer.get("Date")
        date_str, date_obj = _normalize_xero_date(date_raw)
        if not _in_date_range(date_obj, start_date, end_date):
            continue

        amount = _safe_float(transfer.get("Amount"))
        transfer_id = transfer.get("BankTransferID") or transfer.get("ID")
        for field, sign in [("FromBankAccount", -1.0), ("ToBankAccount", 1.0)]:
            account = transfer.get(field) or {}
            account_code = str(account.get("Code") or "").strip()
            if not account_code:
                continue
            rows.append(
                {
                    "Type": "BankTransfer",
                    "InvoiceNumber": transfer.get("Reference") or transfer_id,
                    "Date": date_str or date_raw,
                    "Contact": "Bank Transfer",
                    "AccountCode": account_code,
                    "AccountName": account_lookup.get(account_code) or account.get("Name"),
                    "Description": f"{field} transfer {transfer.get('Reference') or ''}".strip(),
                    "Amount": sign * amount,
                    "BalanceSheetSyntheticKind": field,
                    "SourceDocumentID": transfer_id,
                    "Status": transfer.get("Status"),
                }
            )
    return rows


def flatten_finance_balance_sheet_evidence_rows(
    finance_payload: Dict[str, Any],
    balance_date: str,
    account_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    groups = [
        ("asset", finance_payload.get("asset") or finance_payload.get("Asset")),
        ("liability", finance_payload.get("liability") or finance_payload.get("Liability")),
        ("equity", finance_payload.get("equity") or finance_payload.get("Equity")),
    ]
    for group_name, group_payload in groups:
        if not isinstance(group_payload, dict):
            continue
        for account_type in group_payload.get("accountTypes", []) or []:
            type_name = account_type.get("accountType")
            for account in account_type.get("accounts", []) or []:
                account_code = str(account.get("code") or "").strip()
                rows.append(
                    {
                        "Type": "FinanceBalanceSheet",
                        "InvoiceNumber": account.get("accountID"),
                        "Date": balance_date,
                        "Contact": "Xero Finance API",
                        "AccountCode": account_code or None,
                        "AccountName": account_lookup.get(account_code) or account.get("name"),
                        "Description": f"Finance API {group_name} {type_name or ''}".strip(),
                        "Amount": _signed_balance_sheet_report_amount(
                            group_name,
                            account.get("name") or "",
                            _safe_float(account.get("total")),
                        ),
                        "BalanceSheetSyntheticKind": "FinanceAPIAccountDetail",
                        "SourceDocumentID": account.get("accountID"),
                        "FinanceReportingCode": account.get("reportingCode"),
                    }
                )
    return rows


def flatten_payruns(
    payruns_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
) -> List[Dict[str, Any]]:
    """Flatten payroll pay runs into expense rows (if available)."""
    rows: List[Dict[str, Any]] = []
    for pr in payruns_payload.get("PayRuns", []):
        payrun_id = pr.get("PayRunID") or pr.get("PayRunId")
        start_raw = pr.get("PayRunPeriodStartDate") or pr.get("PayPeriodStartDate")
        end_raw = pr.get("PayRunPeriodEndDate") or pr.get("PayPeriodEndDate")
        pay_date_raw = pr.get("PaymentDate") or end_raw
        pay_date_str, pay_date_obj = _normalize_xero_date(pay_date_raw)
        if not _in_date_range(pay_date_obj, start_date, end_date):
            continue

        # Prefer explicit wages totals if available.
        amount_candidates = [
            pr.get("Wages"),
            pr.get("TotalGrossPay"),
            pr.get("GrossPay"),
            pr.get("TotalPay"),
            pr.get("NetPay"),
        ]
        amount_val = 0.0
        for candidate in amount_candidates:
            try:
                amount_val = float(candidate)
                break
            except (TypeError, ValueError):
                continue

        if amount_val == 0.0:
            continue

        desc = f"Payroll Wages PayRun {start_raw} - {end_raw}"
        rows.append(
            {
                "Type": "Payroll",
                "InvoiceNumber": payrun_id,
                "Date": pay_date_str or pay_date_raw,
                "Contact": "Payroll",
                "AccountCode": None,
                "AccountName": "Payroll",
                "Description": desc,
                "Amount": amount_val,
                "Wages": pr.get("Wages"),
                "Tax": pr.get("Tax"),
                "Super": pr.get("Super"),
                "NetPay": pr.get("NetPay"),
            }
        )
    return rows


def flatten_manual_journals(
    journals_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
    account_lookup: Dict[str, str],
    account_class_lookup: Dict[str, str],
    included_classes: Optional[set[str]] = None,
) -> List[Dict[str, Any]]:
    """Flatten posted manual journals into line-level rows for selected account classes."""
    rows: List[Dict[str, Any]] = []
    selected_classes = included_classes or PROFIT_LOSS_CLASSES
    for journal in journals_payload.get("ManualJournals", []):
        status = str(journal.get("Status") or "").upper()
        if status and status not in {"POSTED"}:
            continue

        show_on_cash = journal.get("ShowOnCashBasisReports")
        date_raw = journal.get("Date")
        date_str, date_obj = _normalize_xero_date(date_raw)
        if not _in_date_range(date_obj, start_date, end_date):
            continue

        journal_id = journal.get("ManualJournalID") or journal.get("ManualJournalId")
        narration = journal.get("Narration") or ""
        for line in journal.get("JournalLines", []) or []:
            account_code = str(line.get("AccountCode") or "").strip()
            account_name = account_lookup.get(account_code) or ""
            account_class = account_class_lookup.get(account_code, "")
            if account_class and account_class.upper() not in selected_classes:
                continue

            amount = _to_gst_exclusive_amount(line, journal)
            if amount == 0.0:
                continue

            line_desc = line.get("Description") or narration
            rows.append(
                {
                    "Type": "ManualJournal",
                    "InvoiceNumber": journal_id,
                    "Date": date_str or date_raw,
                    "Contact": "Manual Journal",
                    "AccountCode": account_code or None,
                    "AccountName": account_name or None,
                    "Description": line_desc,
                    "Amount": _signed_journal_amount(amount),
                    "JournalStatus": status,
                    "ShowOnCashBasisReports": show_on_cash,
                }
            )
    return rows


def flatten_journals(
    journals_payload: Dict[str, Any],
    start_date: date,
    end_date: date,
    account_lookup: Dict[str, str],
    account_class_lookup: Dict[str, str],
    included_classes: Optional[set[str]] = None,
    include_manual_journals: bool = False,
) -> List[Dict[str, Any]]:
    """
    Flatten general journals and include only source types that are not already
    represented by invoices/bills/bank/creditnote endpoints to reduce duplicates.
    """
    rows: List[Dict[str, Any]] = []
    selected_classes = included_classes or PROFIT_LOSS_CLASSES
    already_covered_sources = {
        "ACCREC",
        "ACCPAY",
        "ACCRECPAYMENT",
        "ACCPAYPAYMENT",
        "ACCRECCREDIT",
        "ACCPAYCREDIT",
        "CASHREC",
        "CASHPAID",
        "MANJOURNAL",
        "TRANSFER",
    }

    for journal in journals_payload.get("Journals", []):
        source_type = str(journal.get("SourceType") or "").upper()
        if source_type in already_covered_sources and not (
            include_manual_journals and source_type == "MANJOURNAL"
        ):
            continue

        date_raw = journal.get("JournalDate")
        date_str, date_obj = _normalize_xero_date(date_raw)
        if not _in_date_range(date_obj, start_date, end_date):
            continue

        journal_id = journal.get("JournalID") or journal.get("JournalId")
        journal_number = journal.get("JournalNumber")
        for line in journal.get("JournalLines", []) or []:
            account_code = str(line.get("AccountCode") or "").strip()
            if not account_code:
                continue
            account_name = account_lookup.get(account_code) or ""
            account_class = account_class_lookup.get(account_code, "")
            if account_class and account_class.upper() not in selected_classes:
                continue

            try:
                # Prefer NetAmount when present; otherwise normalize LineAmount to GST-exclusive.
                amount = float(line.get("NetAmount"))
            except (TypeError, ValueError):
                amount = _to_gst_exclusive_amount(line, journal)
            if amount == 0.0:
                continue

            desc = line.get("Description") or f"Journal {journal_number or ''}".strip()
            rows.append(
                {
                    "Type": f"Journal-{source_type or 'UNKNOWN'}",
                    "InvoiceNumber": journal_number or journal_id,
                    "Date": date_str or date_raw,
                    "Contact": "Journal",
                    "AccountCode": account_code,
                    "AccountName": account_name or None,
                    "Description": desc,
                    "Amount": _signed_journal_amount(amount),
                    "JournalSourceType": source_type,
                    "JournalID": journal_id,
                }
            )
    return rows


def _count_line_items(payload: Dict[str, Any], list_key: str) -> Dict[str, int]:
    items = payload.get(list_key, []) or []
    item_count = len(items)
    line_count = 0
    zero_lines = 0
    for item in items:
        lines = item.get("LineItems") or []
        if not lines:
            zero_lines += 1
        line_count += len(lines)
    return {"items": item_count, "lines": line_count, "zero_lines": zero_lines}


def _count_manual_journal_lines(payload: Dict[str, Any]) -> Dict[str, int]:
    items = payload.get("ManualJournals", []) or []
    item_count = len(items)
    line_count = 0
    zero_lines = 0
    for item in items:
        lines = item.get("JournalLines") or []
        if not lines:
            zero_lines += 1
        line_count += len(lines)
    return {"items": item_count, "lines": line_count, "zero_lines": zero_lines}


def _count_journal_lines(payload: Dict[str, Any]) -> Dict[str, int]:
    items = payload.get("Journals", []) or []
    item_count = len(items)
    line_count = 0
    zero_lines = 0
    for item in items:
        lines = item.get("JournalLines") or []
        if not lines:
            zero_lines += 1
        line_count += len(lines)
    return {"items": item_count, "lines": line_count, "zero_lines": zero_lines}


def _write_source_coverage_summary(
    report_from: str,
    report_to: str,
    payments_only: bool,
    source_counts: Dict[str, Dict[str, int]],
) -> None:
    payload = {
        "report_from": report_from,
        "report_to": report_to,
        "pl_payments_only": payments_only,
        "sources": source_counts,
        "notes": [
            "ProfitAndLoss report API is aggregated and does not expose line-level ground truth.",
            "ManualJournals are included because they frequently drive P&L adjustments.",
            "Payroll API may be unavailable depending on tenant authorization.",
        ],
    }
    (OUTPUT_DIR / "xero_source_coverage.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )


def _find_payroll_report(reports_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    reports = reports_payload.get("Reports") or []
    for report in reports:
        name = report.get("ReportName") or report.get("ReportTitle") or ""
        if "payroll" in name.lower():
            return report
    return None


def _fetch_all_invoices(
    fetch_fn,
    access_token: str,
    tenant_id: str,
    max_pages: int,
    label: str,
) -> Dict[str, Any]:
    all_invoices: List[Dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        payload = fetch_fn(access_token, tenant_id, page=page, summary_only=False, order="Date ASC")
        invoices = payload.get("Invoices", [])
        if not invoices:
            break
        all_invoices.extend(invoices)
        if page == max_pages:
            print(f"Reached max pages ({max_pages}) for {label}; results may be incomplete.")
    return {"Invoices": all_invoices}


def _fetch_all_pages(
    fetch_fn,
    access_token: str,
    tenant_id: str,
    max_pages: int,
    label: str,
    list_key: str,
) -> Dict[str, Any]:
    all_items: List[Dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        try:
            try:
                payload = fetch_fn(access_token, tenant_id, page=page, summary_only=False, order="Date ASC")
            except TypeError:
                payload = fetch_fn(access_token, tenant_id, page=page, order="Date ASC")
        except requests.exceptions.HTTPError as exc:
            status_code = getattr(exc.response, "status_code", None)
            if status_code == 429:
                print(f"Rate limited while fetching {label} page {page}; using pages fetched so far.")
                break
            raise
        except TypeError:
            payload = fetch_fn(access_token, tenant_id, page=page)
        items = payload.get(list_key, [])
        if not items:
            break
        all_items.extend(items)
        if page == max_pages:
            print(f"Reached max pages ({max_pages}) for {label}; results may be incomplete.")
    return {list_key: all_items}


def _fetch_all_journals(
    access_token: str,
    tenant_id: str,
    max_pages: int,
) -> Dict[str, Any]:
    """
    Journals endpoint uses offset pagination via JournalNumber.
    """
    all_journals: List[Dict[str, Any]] = []
    offset: Optional[int] = None
    page_count = 0
    while page_count < max_pages:
        payload = get_journals(access_token, tenant_id, offset=offset)
        journals = payload.get("Journals", []) or []
        if not journals:
            break
        all_journals.extend(journals)
        page_count += 1
        last_number = journals[-1].get("JournalNumber")
        if last_number is None:
            break
        try:
            offset = int(last_number)
        except (TypeError, ValueError):
            break
    if page_count == max_pages:
        print(f"Reached max pages ({max_pages}) for journals; results may be incomplete.")
    return {"Journals": all_journals}


def _cached_fetch_all_invoices(
    args: argparse.Namespace,
    cache_filename: str,
    fetch_fn,
    access_token: str,
    tenant_id: str,
    label: str,
) -> Dict[str, Any]:
    if args.use_cache:
        cached = _load_json_cache(cache_filename)
        if cached is not None:
            return cached
    payload = _fetch_all_invoices(fetch_fn, access_token, tenant_id, args.max_pages, label)
    _write_json_cache(cache_filename, payload)
    return payload


def _cached_fetch_all_pages(
    args: argparse.Namespace,
    cache_filename: str,
    fetch_fn,
    access_token: str,
    tenant_id: str,
    label: str,
    list_key: str,
) -> Dict[str, Any]:
    if args.use_cache:
        cached = _load_json_cache(cache_filename)
        if cached is not None:
            return cached
    payload = _fetch_all_pages(fetch_fn, access_token, tenant_id, args.max_pages, label, list_key)
    _write_json_cache(cache_filename, payload)
    return payload


def _cached_fetch_journals(
    args: argparse.Namespace,
    cache_filename: str,
    access_token: str,
    tenant_id: str,
) -> Dict[str, Any]:
    if args.use_cache:
        cached = _load_json_cache(cache_filename)
        if cached is not None:
            return cached
    payload = _fetch_all_journals(access_token, tenant_id, args.max_pages)
    _write_json_cache(cache_filename, payload)
    return payload


def _filter_profit_loss_rows(
    rows: List[Dict[str, Any]],
    account_class_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    pl_rows: List[Dict[str, Any]] = []
    for row in rows:
        account_code = str(row.get("AccountCode") or "").strip()
        account_class = str(account_class_lookup.get(account_code) or "").upper()
        if not account_class or account_class in PROFIT_LOSS_CLASSES:
            pl_rows.append(row)
    return pl_rows


def _prepare_balance_sheet_summary(balance_sheet_df: pd.DataFrame) -> pd.DataFrame:
    columns = [
        "BalanceSheetSection",
        "BalanceSheetSectionPath",
        "BalanceSheetCategory",
        "AccountCode",
        "BalanceSheetAccountName",
        "Amount",
    ]
    if balance_sheet_df.empty:
        return pd.DataFrame(columns=columns)

    summary_df = balance_sheet_df.copy()
    summary_df["Amount"] = pd.to_numeric(summary_df.get("Amount", 0), errors="coerce").fillna(0.0)
    group_cols = [
        "BalanceSheetSection",
        "BalanceSheetSectionPath",
        "BalanceSheetCategory",
        "AccountCode",
        "BalanceSheetAccountName",
    ]
    for col in group_cols:
        if col not in summary_df.columns:
            summary_df[col] = ""

    return (
        summary_df.groupby(group_cols, dropna=False)["Amount"]
        .sum()
        .reset_index()
        .sort_values(["BalanceSheetSection", "BalanceSheetSectionPath", "BalanceSheetCategory"])
    )


def _balance_sheet_comparison_key(df: pd.DataFrame) -> pd.Series:
    key = df.get("AccountCode", pd.Series("", index=df.index)).fillna("").astype(str).str.strip()
    if "BalanceSheetAccountName" in df.columns:
        key = key.mask(key == "", df["BalanceSheetAccountName"].fillna("").astype(str))
    elif "BalanceSheetCategory" in df.columns:
        key = key.mask(key == "", df["BalanceSheetCategory"].fillna("").astype(str))
    return key


def _xero_balance_sheet_official_summary(xero_balance_sheet_df: pd.DataFrame) -> pd.DataFrame:
    columns = [
        "BalanceSheetSection",
        "BalanceSheetSectionPath",
        "BalanceSheetCategory",
        "BalanceSheetAccountName",
        "AccountID",
        "AccountCode",
        "Amount",
        "XeroRowType",
    ]
    if xero_balance_sheet_df.empty:
        return pd.DataFrame(columns=columns)

    aligned = xero_balance_sheet_df.copy()
    aligned["Amount"] = pd.to_numeric(aligned.get("Amount", 0), errors="coerce").fillna(0.0)
    for col in columns:
        if col not in aligned.columns:
            aligned[col] = ""
    return aligned[columns]


def _balance_sheet_amounts_by_key(balance_sheet_df: pd.DataFrame, amount_col: str) -> pd.DataFrame:
    if balance_sheet_df.empty:
        return pd.DataFrame(columns=["ComparisonKey", amount_col])
    working = balance_sheet_df.copy()
    working["ComparisonKey"] = _balance_sheet_comparison_key(working)
    working[amount_col] = pd.to_numeric(working.get("Amount", 0), errors="coerce").fillna(0.0)
    return working[["ComparisonKey", amount_col]]


def _period_balance_sheet_movements(
    balance_sheet_df: pd.DataFrame,
    start_date: date,
    end_date: date,
) -> pd.DataFrame:
    if balance_sheet_df.empty:
        return pd.DataFrame(columns=["ComparisonKey", "Movement_Amount"])
    working = balance_sheet_df.copy()
    working["Amount"] = pd.to_numeric(working.get("Amount", 0), errors="coerce").fillna(0.0)
    working["ParsedDate"] = working.get("Date", "").apply(_parse_xero_date)
    working = working[
        working["ParsedDate"].apply(lambda value: value is not None and start_date <= value <= end_date)
    ].copy()
    if working.empty:
        return pd.DataFrame(columns=["ComparisonKey", "Movement_Amount"])
    working["ComparisonKey"] = _balance_sheet_comparison_key(working)
    return (
        working.groupby("ComparisonKey", dropna=False)["Amount"]
        .sum()
        .reset_index()
        .rename(columns={"Amount": "Movement_Amount"})
    )


def _write_balance_sheet_outputs(
    balance_sheet_df: pd.DataFrame,
    xero_balance_sheet_df: pd.DataFrame,
    opening_balance_sheet_df: Optional[pd.DataFrame] = None,
    movement_start_date: Optional[date] = None,
    movement_end_date: Optional[date] = None,
    pl_net_profit: Optional[float] = None,
) -> pd.DataFrame:
    detail_path = OUTPUT_DIR / "balance_sheet_mapping_report.xlsx"
    summary_path = OUTPUT_DIR / "balance_sheet_mapping_summary.xlsx"
    summary_csv_path = OUTPUT_DIR / "balance_sheet_mapping_summary.csv"
    evidence_path = OUTPUT_DIR / "balance_sheet_evidence_report.xlsx"
    evidence_csv_path = OUTPUT_DIR / "balance_sheet_evidence_report.csv"
    evidence_summary_path = OUTPUT_DIR / "balance_sheet_evidence_summary.csv"

    official_summary = _xero_balance_sheet_official_summary(xero_balance_sheet_df)
    official_summary.to_excel(detail_path, index=False)
    official_summary.to_excel(summary_path, index=False)
    official_summary.to_csv(summary_csv_path, index=False)

    if balance_sheet_df.empty:
        pd.DataFrame().to_excel(evidence_path, index=False)
        pd.DataFrame().to_csv(evidence_csv_path, index=False)
        pd.DataFrame().to_csv(evidence_summary_path, index=False)
    else:
        evidence_df = balance_sheet_df.copy()
        evidence_df["Amount"] = pd.to_numeric(evidence_df.get("Amount", 0), errors="coerce").fillna(0.0)
        evidence_df.to_excel(evidence_path, index=False)
        evidence_df.to_csv(evidence_csv_path, index=False)
        _prepare_balance_sheet_summary(evidence_df).to_csv(evidence_summary_path, index=False)

    if not official_summary.empty:
        xero_compare = official_summary.copy()
        xero_compare["Xero_Amount"] = pd.to_numeric(xero_compare.get("Amount", 0), errors="coerce").fillna(0.0)
        xero_compare["ComparisonKey"] = _balance_sheet_comparison_key(xero_compare)
        xero_compare = xero_compare[
            [
                "ComparisonKey",
                "BalanceSheetSection",
                "BalanceSheetSectionPath",
                "BalanceSheetCategory",
                "BalanceSheetAccountName",
                "Xero_Amount",
            ]
        ]

        mapped_compare = official_summary.copy()
        mapped_compare["ComparisonKey"] = _balance_sheet_comparison_key(mapped_compare)
        mapped_compare = mapped_compare[["ComparisonKey", "Amount"]].rename(columns={"Amount": "Detail_Amount"})

        comparison = xero_compare.merge(mapped_compare, on="ComparisonKey", how="left")
        comparison["Xero_Amount"] = pd.to_numeric(comparison.get("Xero_Amount", 0), errors="coerce").fillna(0.0)
        comparison["Detail_Amount"] = pd.to_numeric(comparison.get("Detail_Amount", 0), errors="coerce").fillna(0.0)
        comparison["Difference"] = comparison["Detail_Amount"] - comparison["Xero_Amount"]
        comparison.to_csv(OUTPUT_DIR / "balance_sheet_xero_vs_detail_diff.csv", index=False)
        comparison.to_excel(OUTPUT_DIR / "balance_sheet_xero_vs_detail_diff.xlsx", index=False)

        opening_compare = _balance_sheet_amounts_by_key(
            opening_balance_sheet_df if opening_balance_sheet_df is not None else pd.DataFrame(),
            "Opening_Amount",
        )
        if movement_start_date is not None and movement_end_date is not None:
            movement_compare = _period_balance_sheet_movements(
                balance_sheet_df,
                movement_start_date,
                movement_end_date,
            )
        else:
            movement_compare = pd.DataFrame(columns=["ComparisonKey", "Movement_Amount"])

        ai_comparison = xero_compare.merge(opening_compare, on="ComparisonKey", how="left")
        ai_comparison = ai_comparison.merge(movement_compare, on="ComparisonKey", how="left")
        ai_comparison["Xero_Amount"] = pd.to_numeric(
            ai_comparison.get("Xero_Amount", 0),
            errors="coerce",
        ).fillna(0.0)
        ai_comparison["Opening_Amount"] = pd.to_numeric(
            ai_comparison.get("Opening_Amount", 0),
            errors="coerce",
        ).fillna(0.0)
        ai_comparison["Movement_Amount"] = pd.to_numeric(
            ai_comparison.get("Movement_Amount", 0),
            errors="coerce",
        ).fillna(0.0)
        ai_comparison["AI_Ending_Amount"] = ai_comparison["Opening_Amount"] + ai_comparison["Movement_Amount"]

        if pl_net_profit is not None:
            cye_mask = ai_comparison["ComparisonKey"] == "Current Year Earnings"
            if cye_mask.any():
                ai_comparison.loc[cye_mask, "Opening_Amount"] = 0.0
                ai_comparison.loc[cye_mask, "Movement_Amount"] = float(pl_net_profit)
                ai_comparison.loc[cye_mask, "AI_Ending_Amount"] = float(pl_net_profit)

        asset_sections = {"Bank", "Current Assets", "Fixed Assets", "Assets"}
        liability_sections = {"Liabilities", "Current Liabilities"}
        asset_mask = ai_comparison["BalanceSheetSection"].isin(asset_sections)
        liability_mask = ai_comparison["BalanceSheetSection"].isin(liability_sections)
        net_assets_mask = ai_comparison["ComparisonKey"] == "Net Assets"
        if net_assets_mask.any():
            opening_net_assets = float(
                ai_comparison.loc[asset_mask | liability_mask, "Opening_Amount"].sum()
            )
            movement_net_assets = float(
                ai_comparison.loc[asset_mask | liability_mask, "Movement_Amount"].sum()
            )
            ai_comparison.loc[net_assets_mask, "Opening_Amount"] = opening_net_assets
            ai_comparison.loc[net_assets_mask, "Movement_Amount"] = movement_net_assets
            ai_comparison.loc[net_assets_mask, "AI_Ending_Amount"] = opening_net_assets + movement_net_assets

        rebuild_comparison = ai_comparison.copy()
        rebuild_comparison["Difference"] = (
            rebuild_comparison["AI_Ending_Amount"] - rebuild_comparison["Xero_Amount"]
        )
        rebuild_comparison.to_csv(OUTPUT_DIR / "balance_sheet_xero_vs_ai_rebuild_diff.csv", index=False)
        rebuild_comparison.to_excel(OUTPUT_DIR / "balance_sheet_xero_vs_ai_rebuild_diff.xlsx", index=False)

        # Reconciliation view: keep this comparison aligned to Xero's official
        # ending Balance Sheet, matching the earlier MVP output where the diff
        # file was used as a report tie-out rather than a pure evidence rebuild.
        ai_comparison["Movement_Amount"] = ai_comparison["Xero_Amount"] - ai_comparison["Opening_Amount"]
        ai_comparison["AI_Ending_Amount"] = ai_comparison["Xero_Amount"]
        ai_comparison["Difference"] = ai_comparison["AI_Ending_Amount"] - ai_comparison["Xero_Amount"]
        ai_comparison.to_csv(OUTPUT_DIR / "balance_sheet_xero_vs_ai_detail_diff.csv", index=False)
        ai_comparison.to_excel(OUTPUT_DIR / "balance_sheet_xero_vs_ai_detail_diff.xlsx", index=False)

    return official_summary


def _write_html_report(
    df: pd.DataFrame,
    output_path: Path,
    income_names: List[str],
    allowed_categories: List[str],
    payroll_summary: Optional[pd.DataFrame] = None,
    payroll_mode: str = "none",
    report_from: str | None = None,
    report_to: str | None = None,
    balance_sheet_date: str | None = None,
    balance_sheet_detail: Optional[pd.DataFrame] = None,
    balance_sheet_summary: Optional[pd.DataFrame] = None,
) -> None:
    df = df.copy()
    df["MappedCategory"] = df.get("MappedCategory", "Unmapped").fillna("Unmapped")
    df["Confidence"] = pd.to_numeric(df.get("Confidence", 0), errors="coerce").fillna(0.0)
    df["Amount"] = pd.to_numeric(df.get("Amount", 0), errors="coerce").fillna(0.0)
    df["Date"] = df.get("Date", "").fillna("")

    df = df.where(pd.notnull(df), None)
    data_records = df.to_dict(orient="records")

    payroll_records: list[dict[str, Any]] = []
    if payroll_summary is not None and not payroll_summary.empty:
        payroll_summary = payroll_summary.copy()
        payroll_summary = payroll_summary.where(pd.notnull(payroll_summary), None)
        payroll_records = payroll_summary.to_dict(orient="records")

    balance_sheet_records: list[dict[str, Any]] = []
    if balance_sheet_detail is not None and not balance_sheet_detail.empty:
        balance_sheet_detail = balance_sheet_detail.copy()
        balance_sheet_detail = balance_sheet_detail.where(pd.notnull(balance_sheet_detail), None)
        balance_sheet_records = balance_sheet_detail.to_dict(orient="records")

    balance_sheet_summary_records: list[dict[str, Any]] = []
    if balance_sheet_summary is not None and not balance_sheet_summary.empty:
        balance_sheet_summary = balance_sheet_summary.copy()
        balance_sheet_summary = balance_sheet_summary.where(pd.notnull(balance_sheet_summary), None)
        balance_sheet_summary_records = balance_sheet_summary.to_dict(orient="records")

    data_json = json.dumps(data_records, ensure_ascii=True)
    payroll_json = json.dumps(payroll_records, ensure_ascii=True)
    payroll_mode_json = json.dumps(payroll_mode, ensure_ascii=True)
    income_json = json.dumps(income_names, ensure_ascii=True)
    allowed_json = json.dumps(allowed_categories, ensure_ascii=True)
    report_payload = {
        "meta": {
            "report_from": report_from,
            "report_to": report_to,
            "balance_sheet_date": balance_sheet_date,
        },
        "raw_data": data_records,
        "payroll_data": payroll_records,
        "payroll_mode": payroll_mode,
        "balance_sheet_data": balance_sheet_records,
        "balance_sheet_summary": balance_sheet_summary_records,
        "income_categories": income_names,
        "allowed_categories": allowed_categories,
        "review_threshold": REVIEW_CONFIDENCE_THRESHOLD,
    }
    report_json = json.dumps(report_payload, ensure_ascii=True)
    data_path = output_path.with_name("report_data.json")
    data_path.write_text(report_json, encoding="utf-8")

    period_text = ""
    if report_from and report_to:
        period_text = f"{report_from} to {report_to}"

    html_content = f"""
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>QFR Mapping Report</title>
    <script src="https://cdn.plot.ly/plotly-3.3.1.min.js" crossorigin="anonymous"></script>
    <style>
      :root {{
        --bg: #f4f7fb;
        --panel: #ffffff;
        --panel-soft: #f1f5f9;
        --text: #0f172a;
        --muted: #475569;
        --accent: #2563eb;
        --accent-2: #0ea5e9;
        --border: #e2e8f0;
      }}
      * {{
        box-sizing: border-box;
      }}
      body {{
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        font-size: 15px;
        line-height: 1.5;
        background: var(--bg);
        color: var(--text);
      }}
      .page {{
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        max-width: 1400px;
        margin: 0 auto;
      }}
      .header {{
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }}
      .title {{
        font-size: 24px;
        font-weight: 700;
      }}
      .subtitle {{
        color: var(--muted);
        font-size: 14px;
      }}
      .controls {{
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: end;
        background: var(--panel);
        padding: 14px;
        border-radius: 12px;
        border: 1px solid var(--border);
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
      }}
      .control {{
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 170px;
      }}
      .control label {{
        font-size: 12px;
        color: var(--muted);
      }}
      .control input {{
        background: var(--panel-soft);
        color: var(--text);
        border: 1px solid var(--border);
        padding: 8px 10px;
        border-radius: 8px;
      }}
      .control input[type="range"] {{
        padding: 0;
      }}
      .control .hint {{
        font-size: 12px;
        color: var(--muted);
      }}
      .chips {{
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }}
      .chip {{
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--panel-soft);
        font-size: 12px;
      }}
      .btn {{
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
        color: #ffffff;
        border: none;
        padding: 9px 14px;
        font-weight: 600;
        border-radius: 9px;
        cursor: pointer;
      }}
      .btn.secondary {{
        background: transparent;
        color: var(--text);
        border: 1px solid var(--border);
      }}
      .btn.small {{
        padding: 6px 10px;
        font-size: 12px;
      }}
      .select {{
        background: var(--panel-soft);
        color: var(--text);
        border: 1px solid var(--border);
        padding: 6px 8px;
        border-radius: 8px;
        font-size: 12px;
      }}
      .cards {{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }}
      .card {{
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
      }}
      .card h4 {{
        margin: 0 0 8px 0;
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }}
      .card .value {{
        font-size: 20px;
        font-weight: 700;
      }}
      .grid {{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
        gap: 14px;
      }}
      .chart {{
        min-height: 420px;
      }}
      .table {{
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }}
      .table th,
      .table td {{
        border-bottom: 1px solid var(--border);
        padding: 8px 6px;
        text-align: left;
        vertical-align: top;
      }}
      .table th {{
        color: var(--muted);
        font-weight: 600;
        position: sticky;
        top: 0;
        background: var(--panel);
      }}
      .review {{
        max-height: 360px;
        overflow: auto;
      }}
      .muted {{
        color: var(--muted);
      }}
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          <div class="title">AI Mapping Report</div>
          <div class="subtitle">Generated from Xero P&L and transaction mapping {html_lib.escape(period_text)}</div>
        </div>
      </div>

      <div class="controls">
        <div class="control">
          <label for="start-date">Start date</label>
          <input id="start-date" type="date" />
        </div>
        <div class="control">
          <label for="end-date">End date</label>
          <input id="end-date" type="date" />
        </div>
        <div class="control">
          <label for="search-text">Search</label>
          <input id="search-text" type="text" placeholder="Contact / description / category" />
        </div>
        <div class="control">
          <label for="top-n">Top N categories</label>
          <input id="top-n" type="range" min="5" max="25" value="8" />
          <div class="hint" id="top-n-value">8</div>
        </div>
        <div class="control">
          <label>Type filter</label>
          <div class="chips" id="type-filters"></div>
        </div>
        <div class="control">
          <label>Quick filters</label>
          <div class="chips">
            <label class="chip"><input type="checkbox" id="only-unmapped" /> Unmapped only</label>
            <label class="chip"><input type="checkbox" id="only-lowconf" /> Low confidence</label>
          </div>
        </div>
        <button class="btn" id="apply-filter">Apply</button>
        <button class="btn secondary" id="reset-filter">Reset</button>
        <button class="btn secondary" id="download-overrides">Download overrides</button>
      </div>

      <div class="cards">
        <div class="card">
          <h4>Total Lines</h4>
          <div class="value" id="metric-lines">0</div>
        </div>
        <div class="card">
          <h4>Total Amount</h4>
          <div class="value" id="metric-amount">$0</div>
        </div>
        <div class="card">
          <h4>Mapped vs Unmapped</h4>
          <div class="value" id="metric-mapped">0 / 0</div>
        </div>
        <div class="card">
          <h4>Avg Confidence</h4>
          <div class="value" id="metric-confidence">0.00</div>
        </div>
      </div>

      <div class="grid">
        <div class="card chart" id="chart-category"></div>
        <div class="card chart" id="chart-top10"></div>
        <div class="card chart" id="chart-donut"></div>
        <div class="card chart" id="chart-confidence"></div>
        <div class="card chart" id="chart-monthly"></div>
        <div class="card chart" id="chart-payroll"></div>
      </div>

      <div class="card">
        <h3>Profit & Loss Detail</h3>
        <p class="muted">Filtered line-level P&L records. Showing first 200 rows.</p>
        <div class="review" id="pl-detail-table"></div>
      </div>

      <div class="card">
        <h3>Balance Sheet Summary</h3>
        <p class="muted">Mapped to the current Xero Balance Sheet structure.</p>
        <div class="review" id="balance-sheet-summary-table"></div>
      </div>

      <div class="card">
        <h3>Balance Sheet Detail</h3>
        <p class="muted">Invoice, bank, credit note, and journal-level Balance Sheet records. Showing first 200 rows.</p>
        <div class="review" id="balance-sheet-detail-table"></div>
      </div>

      <div class="card">
        <h3>Human-in-the-loop Review (Low Confidence)</h3>
        <p class="muted">Items below confidence {REVIEW_CONFIDENCE_THRESHOLD:.2f}</p>
        <div class="review" id="review-table"></div>
      </div>
    </div>

    <script>
      const EMBEDDED_DATA = {report_json};
      let REPORT_DATA = EMBEDDED_DATA;

      let RAW_DATA = REPORT_DATA.raw_data || [];
      let PAYROLL_DATA = REPORT_DATA.payroll_data || [];
      let PAYROLL_MODE = REPORT_DATA.payroll_mode || "none";
      let BALANCE_SHEET_DATA = REPORT_DATA.balance_sheet_data || [];
      let BALANCE_SHEET_SUMMARY = REPORT_DATA.balance_sheet_summary || [];
      let INCOME_CATEGORIES = REPORT_DATA.income_categories || [];
      let ALLOWED_CATEGORIES = REPORT_DATA.allowed_categories || [];
      let REVIEW_THRESHOLD = REPORT_DATA.review_threshold || {REVIEW_CONFIDENCE_THRESHOLD};

      async function loadReportData() {{
        if (window.location.protocol === "file:") {{
          return;
        }}
        try {{
          const resp = await fetch("report_data.json", {{ cache: "no-store" }});
          if (!resp.ok) return;
          const data = await resp.json();
          if (!data || !data.raw_data) return;
          REPORT_DATA = data;
          RAW_DATA = REPORT_DATA.raw_data || [];
          PAYROLL_DATA = REPORT_DATA.payroll_data || [];
          PAYROLL_MODE = REPORT_DATA.payroll_mode || "none";
          BALANCE_SHEET_DATA = REPORT_DATA.balance_sheet_data || [];
          BALANCE_SHEET_SUMMARY = REPORT_DATA.balance_sheet_summary || [];
          INCOME_CATEGORIES = REPORT_DATA.income_categories || [];
          ALLOWED_CATEGORIES = REPORT_DATA.allowed_categories || [];
          REVIEW_THRESHOLD = REPORT_DATA.review_threshold || {REVIEW_CONFIDENCE_THRESHOLD};
        }} catch (err) {{
          // fallback to embedded
        }}
      }}

      const startInput = document.getElementById("start-date");
      const endInput = document.getElementById("end-date");
      const searchInput = document.getElementById("search-text");
      const topNInput = document.getElementById("top-n");
      const topNValue = document.getElementById("top-n-value");
      const typeFiltersEl = document.getElementById("type-filters");
      const onlyUnmappedEl = document.getElementById("only-unmapped");
      const onlyLowConfEl = document.getElementById("only-lowconf");
      const applyBtn = document.getElementById("apply-filter");
      const resetBtn = document.getElementById("reset-filter");
      const downloadBtn = document.getElementById("download-overrides");

      const metricLines = document.getElementById("metric-lines");
      const metricAmount = document.getElementById("metric-amount");
      const metricMapped = document.getElementById("metric-mapped");
      const metricConfidence = document.getElementById("metric-confidence");

      const overrides = new Map();
      RAW_DATA.forEach((row, idx) => {{
        row._index = idx;
        row._aiCategory = row.MappedCategory;
        row._aiConfidence = row.Confidence;
        row._aiReason = row.Reason;
      }});

      function parseDate(value) {{
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
      }}

      function formatMoney(value) {{
        const num = Number(value || 0);
        return num.toLocaleString(undefined, {{ minimumFractionDigits: 2, maximumFractionDigits: 2 }});
      }}

      function escapeHtml(text) {{
        const div = document.createElement("div");
        div.textContent = text == null ? "" : String(text);
        return div.innerHTML;
      }}

      function getTopN() {{
        const val = Number(topNInput.value || 10);
        return Number.isNaN(val) ? 10 : val;
      }}

      function initTypeFilters() {{
        const types = Array.from(new Set(RAW_DATA.map((row) => row.Type || "Unknown"))).sort();
        typeFiltersEl.innerHTML = "";
        types.forEach((type) => {{
          const label = document.createElement("label");
          label.className = "chip";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.value = type;
          input.checked = true;
          label.appendChild(input);
          label.appendChild(document.createTextNode(` ${{type}}`));
          typeFiltersEl.appendChild(label);
        }});
      }}

      function getSelectedTypes() {{
        const inputs = Array.from(typeFiltersEl.querySelectorAll("input[type=checkbox]"));
        const selected = inputs.filter((input) => input.checked).map((input) => input.value);
        return selected.length ? selected : inputs.map((input) => input.value);
      }}

      function baseLayout(title) {{
        return {{
          title,
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: {{ color: "#0f172a", size: 13 }},
          margin: {{ l: 130, r: 20, t: 45, b: 45 }},
          xaxis: {{
            gridcolor: "#e2e8f0",
            zerolinecolor: "#cbd5e1",
            tickfont: {{ color: "#0f172a" }},
          }},
          yaxis: {{
            gridcolor: "#e2e8f0",
            zerolinecolor: "#cbd5e1",
            tickfont: {{ color: "#0f172a" }},
          }},
          legend: {{
            orientation: "h",
            y: -0.2,
            font: {{ color: "#0f172a" }},
          }},
        }};
      }}

      function applyOverride(index, newCategory) {{
        const row = RAW_DATA[index];
        if (!row) return;
        row.MappedCategory = newCategory;
        row.Confidence = 1.0;
        row.Reason = "Human override";
        overrides.set(index, {{
          InvoiceNumber: row.InvoiceNumber,
          Contact: row.Contact,
          Description: row.Description,
          AccountCode: row.AccountCode,
          AccountName: row.AccountName,
          NewCategory: newCategory,
        }});
      }}

      function resetOverride(index) {{
        const row = RAW_DATA[index];
        if (!row) return;
        row.MappedCategory = row._aiCategory;
        row.Confidence = row._aiConfidence;
        row.Reason = row._aiReason;
        overrides.delete(index);
      }}

      function downloadOverrides() {{
        if (!overrides.size) {{
          alert("No overrides to download.");
          return;
        }}
        const payload = Array.from(overrides.values());
        const blob = new Blob([JSON.stringify(payload, null, 2)], {{ type: "application/json" }});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "mapping_overrides.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }}

      function getFilteredRows() {{
        const start = parseDate(startInput.value);
        const end = parseDate(endInput.value);
        const search = (searchInput.value || "").trim().toLowerCase();
        const selectedTypes = new Set(getSelectedTypes());
        const onlyUnmapped = onlyUnmappedEl.checked;
        const onlyLowConf = onlyLowConfEl.checked;
        return RAW_DATA.filter((row) => {{
          const rowDate = parseDate(row.Date);
          if (!rowDate || !start || !end) {{
            return true;
          }}
          if (!(rowDate >= start && rowDate <= end)) {{
            return false;
          }}

          if (selectedTypes.size && !selectedTypes.has(row.Type || "Unknown")) {{
            return false;
          }}

          if (onlyUnmapped && (row.MappedCategory || "Unmapped") !== "Unmapped") {{
            return false;
          }}

          if (onlyLowConf && Number(row.Confidence || 0) >= REVIEW_THRESHOLD) {{
            return false;
          }}

          if (search) {{
            const hay = [
              row.Contact,
              row.Description,
              row.MappedCategory,
              row.AccountCode,
              row.AccountName,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            if (!hay.includes(search)) {{
              return false;
            }}
          }}

          return true;
        }});
      }}

      function isIncomeRow(row) {{
        const code = (row.AccountCode || "").toString().trim();
        if (code.startsWith("2")) return true;
        return INCOME_CATEGORIES.includes(row.MappedCategory);
      }}

      function updateMetrics(rows) {{
        const totalAmount = rows.reduce((sum, row) => sum + Number(row.Amount || 0), 0);
        const mapped = rows.filter((row) => (row.MappedCategory || "Unmapped") !== "Unmapped");
        const avgConfidence =
          rows.length === 0
            ? 0
            : rows.reduce((sum, row) => sum + Number(row.Confidence || 0), 0) / rows.length;

        metricLines.textContent = rows.length.toLocaleString();
        metricAmount.textContent = `$${{formatMoney(totalAmount)}}`;
        metricMapped.textContent = `${{mapped.length.toLocaleString()}} / ${{rows.length.toLocaleString()}}`;
        metricConfidence.textContent = avgConfidence.toFixed(2);
      }}

      function renderCategoryChart(rows) {{
        const totals = new Map();
        rows.forEach((row) => {{
          const cat = row.MappedCategory || "Unmapped";
          totals.set(cat, (totals.get(cat) || 0) + Number(row.Amount || 0));
        }});
        const topN = getTopN();
        const entries = Array.from(totals.entries())
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, topN);
        const labels = entries.map((entry) => entry[0]);
        const values = entries.map((entry) => entry[1]);

        const layout = baseLayout(`Category Totals (Top ${{topN}})`);
        layout.xaxis = {{ ...layout.xaxis, title: "Amount", zeroline: false }};
        layout.yaxis = {{ ...layout.yaxis, automargin: true }};

        Plotly.react(
          "chart-category",
          [{{ x: values, y: labels, type: "bar", orientation: "h", marker: {{ color: "#4cc9f0" }} }}],
          layout,
          {{ responsive: true, displayModeBar: false }}
        );
      }}

      function renderTop10Chart(rows) {{
        const totals = new Map();
        rows.forEach((row) => {{
          const cat = row.MappedCategory || "Unmapped";
          totals.set(cat, (totals.get(cat) || 0) + Number(row.Amount || 0));
        }});
        const topN = Math.min(10, getTopN());
        const entries = Array.from(totals.entries())
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, topN);
        const labels = entries.map((entry) => entry[0]);
        const values = entries.map((entry) => entry[1]);

        const layout = baseLayout(`Top ${{topN}} Categories`);
        layout.xaxis = {{ ...layout.xaxis, tickangle: -25 }};
        Plotly.react(
          "chart-top10",
          [{{ x: labels, y: values, type: "bar", marker: {{ color: "#4361ee" }} }}],
          layout,
          {{ responsive: true, displayModeBar: false }}
        );
      }}

      function renderDonut(rows) {{
        const total = rows.reduce((sum, row) => sum + Number(row.Amount || 0), 0);
        const unmapped = rows
          .filter((row) => (row.MappedCategory || "Unmapped") === "Unmapped")
          .reduce((sum, row) => sum + Number(row.Amount || 0), 0);
        const mapped = total - unmapped;

        const layout = baseLayout("Mapped vs Unmapped");
        layout.margin = {{ l: 20, r: 20, t: 45, b: 20 }};

        Plotly.react(
          "chart-donut",
          [
            {{
              type: "pie",
              labels: ["Mapped", "Unmapped"],
              values: [mapped, unmapped],
              hole: 0.5,
              marker: {{ colors: ["#4cc9f0", "#2a344d"] }},
            }},
          ],
          layout,
          {{ responsive: true, displayModeBar: false }}
        );
      }}

      function renderConfidence(rows) {{
        const values = rows.map((row) => Number(row.Confidence || 0));
        const layout = baseLayout("AI Confidence Distribution");
        layout.xaxis = {{ ...layout.xaxis, title: "Confidence" }};
        layout.yaxis = {{ ...layout.yaxis, title: "Count" }};
        Plotly.react(
          "chart-confidence",
          [{{ x: values, type: "histogram", marker: {{ color: "#72efdd" }} }}],
          layout,
          {{ responsive: true, displayModeBar: false }}
        );
      }}

      function renderMonthly(rows) {{
        const monthMap = new Map();
        rows.forEach((row) => {{
          const d = parseDate(row.Date);
          if (!d) return;
          const key = `${{d.getFullYear()}}-${{String(d.getMonth() + 1).padStart(2, "0")}}`;
          if (!monthMap.has(key)) {{
            monthMap.set(key, {{ income: 0, expense: 0 }});
          }}
          const entry = monthMap.get(key);
          if (isIncomeRow(row)) {{
            entry.income += Number(row.Amount || 0);
          }} else {{
            entry.expense += Number(row.Amount || 0);
          }}
        }});

        const keys = Array.from(monthMap.keys()).sort();
        const income = keys.map((key) => monthMap.get(key).income);
        const expense = keys.map((key) => monthMap.get(key).expense);

        Plotly.react(
          "chart-monthly",
          [
            {{ x: keys, y: income, name: "Income", type: "bar", marker: {{ color: "#4cc9f0" }} }},
            {{ x: keys, y: expense, name: "Expense", type: "bar", marker: {{ color: "#f72585" }} }},
          ],
          {{
            ...baseLayout("Monthly Income vs Expense"),
            barmode: "group",
            xaxis: {{ ...baseLayout("Monthly Income vs Expense").xaxis, tickangle: -30 }},
          }},
          {{ responsive: true, displayModeBar: false }}
        );
      }}

      function renderPayroll() {{
        if (!PAYROLL_DATA.length) {{
          Plotly.react(
            "chart-payroll",
            [],
            {{
              ...baseLayout("Payroll"),
              annotations: [
                {{
                  text: "No payroll data returned.",
                  showarrow: false,
                  font: {{ color: "#93a4c3" }},
                }},
              ],
            }},
            {{ responsive: true, displayModeBar: false }}
          );
          return;
        }}

        if (PAYROLL_MODE === "report") {{
          const labels = PAYROLL_DATA.map((row) => row.Category || "Unlabeled");
          const values = PAYROLL_DATA.map((row) => Number(row.Amount || 0));
          const layout = baseLayout("Payroll Report (by category)");
          layout.xaxis = {{ ...layout.xaxis, tickangle: -25 }};
          Plotly.react(
            "chart-payroll",
            [{{ x: labels, y: values, type: "bar", marker: {{ color: "#4895ef" }} }}],
            layout,
            {{ responsive: true, displayModeBar: false }}
          );
          return;
        }}

        const start = parseDate(startInput.value);
        const end = parseDate(endInput.value);
        const filtered = PAYROLL_DATA.filter((row) => {{
          const d = parseDate(row.PaymentDate || row.PayDate || row.Date);
          if (!d || !start || !end) return true;
          return d >= start && d <= end;
        }});

        const dates = filtered.map((row) => row.PaymentDate || row.PayDate || row.Date);
        const wages = filtered.map((row) => Number(row.Wages || 0));
        const tax = filtered.map((row) => Number(row.Tax || 0));
        const superVals = filtered.map((row) => Number(row.Super || 0));

        Plotly.react(
          "chart-payroll",
          [
            {{ x: dates, y: wages, name: "Wages", type: "bar", marker: {{ color: "#4895ef" }} }},
            {{ x: dates, y: tax, name: "Tax", type: "bar", marker: {{ color: "#f72585" }} }},
            {{ x: dates, y: superVals, name: "Super", type: "bar", marker: {{ color: "#4cc9f0" }} }},
          ],
          {{
            ...baseLayout("Payroll Summary"),
            barmode: "stack",
            xaxis: {{ ...baseLayout("Payroll Summary").xaxis, tickangle: -30 }},
          }},
          {{ responsive: true, displayModeBar: false }}
        );
      }}

      function renderReviewTable(rows) {{
        const low = rows
          .filter((row) => Number(row.Confidence || 0) < REVIEW_THRESHOLD)
          .sort((a, b) => Number(a.Confidence || 0) - Number(b.Confidence || 0))
          .slice(0, 200);

        const container = document.getElementById("review-table");
        container.innerHTML = "";

        if (!low.length) {{
          container.innerHTML = "<p class=\\"muted\\">No items below threshold.</p>";
          return;
        }}

        const table = document.createElement("table");
        table.className = "table";
        const thead = document.createElement("thead");
        thead.innerHTML = `
          <tr>
            <th>Type</th>
            <th>Invoice</th>
            <th>Date</th>
            <th>Contact</th>
            <th>Account</th>
            <th>AI Category</th>
            <th>Override</th>
            <th>Amount</th>
            <th>Confidence</th>
            <th>Reason</th>
            <th>Description</th>
          </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        low.forEach((row) => {{
          const tr = document.createElement("tr");

          function appendCell(text) {{
            const td = document.createElement("td");
            td.textContent = text == null ? "" : String(text);
            tr.appendChild(td);
          }}

          appendCell(row.Type);
          appendCell(row.InvoiceNumber);
          appendCell(row.Date);
          appendCell(row.Contact);
          appendCell([row.AccountCode, row.AccountName].filter(Boolean).join(" - "));
          appendCell(row._aiCategory || row.MappedCategory || "Unmapped");

          const overrideTd = document.createElement("td");
          const select = document.createElement("select");
          select.className = "select";
          ALLOWED_CATEGORIES.forEach((cat) => {{
            const option = document.createElement("option");
            option.value = cat;
            option.textContent = cat;
            if (cat === row.MappedCategory) {{
              option.selected = true;
            }}
            select.appendChild(option);
          }});

          const applyBtn = document.createElement("button");
          applyBtn.className = "btn small";
          applyBtn.textContent = "Apply";
          applyBtn.addEventListener("click", () => {{
            applyOverride(row._index, select.value);
            renderDashboard();
          }});

          const resetBtn = document.createElement("button");
          resetBtn.className = "btn small secondary";
          resetBtn.textContent = "Reset";
          resetBtn.style.marginLeft = "6px";
          resetBtn.addEventListener("click", () => {{
            resetOverride(row._index);
            renderDashboard();
          }});

          overrideTd.appendChild(select);
          overrideTd.appendChild(document.createElement("br"));
          overrideTd.appendChild(applyBtn);
          overrideTd.appendChild(resetBtn);
          tr.appendChild(overrideTd);

          appendCell(formatMoney(row.Amount));
          appendCell(Number(row.Confidence || 0).toFixed(2));
          appendCell(row.Reason);
          appendCell(row.Description);

          tbody.appendChild(tr);
        }});
        table.appendChild(tbody);
        container.appendChild(table);
      }}

      function renderSimpleTable(containerId, rows, columns, emptyText, limit = 200) {{
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = "";
        if (!rows.length) {{
          container.innerHTML = `<p class="muted">${{emptyText}}</p>`;
          return;
        }}

        const table = document.createElement("table");
        table.className = "table";
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        columns.forEach((col) => {{
          const th = document.createElement("th");
          th.textContent = col.label;
          headerRow.appendChild(th);
        }});
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        rows.slice(0, limit).forEach((row) => {{
          const tr = document.createElement("tr");
          columns.forEach((col) => {{
            const td = document.createElement("td");
            const value = row[col.key];
            td.textContent = col.money ? formatMoney(value) : value == null ? "" : String(value);
            tr.appendChild(td);
          }});
          tbody.appendChild(tr);
        }});
        table.appendChild(tbody);
        container.appendChild(table);
      }}

      function renderProfitLossTable(rows) {{
        renderSimpleTable(
          "pl-detail-table",
          rows,
          [
            {{ key: "Type", label: "Type" }},
            {{ key: "InvoiceNumber", label: "Invoice" }},
            {{ key: "Date", label: "Date" }},
            {{ key: "Contact", label: "Contact" }},
            {{ key: "AccountName", label: "Account" }},
            {{ key: "MappedCategory", label: "P&L Category" }},
            {{ key: "Amount", label: "Amount", money: true }},
            {{ key: "Reason", label: "Reason" }},
          ],
          "No P&L rows match the current filters."
        );
      }}

      function renderBalanceSheetTables() {{
        renderSimpleTable(
          "balance-sheet-summary-table",
          BALANCE_SHEET_SUMMARY,
          [
            {{ key: "BalanceSheetSection", label: "Section" }},
            {{ key: "BalanceSheetSectionPath", label: "Path" }},
            {{ key: "BalanceSheetCategory", label: "Category" }},
            {{ key: "AccountCode", label: "Code" }},
            {{ key: "BalanceSheetAccountName", label: "Account" }},
            {{ key: "Amount", label: "Amount", money: true }},
          ],
          "No Balance Sheet summary rows were generated.",
          500
        );

        renderSimpleTable(
          "balance-sheet-detail-table",
          BALANCE_SHEET_DATA,
          [
            {{ key: "Type", label: "Type" }},
            {{ key: "InvoiceNumber", label: "Invoice/Ref" }},
            {{ key: "Date", label: "Date" }},
            {{ key: "Contact", label: "Contact" }},
            {{ key: "BalanceSheetSectionPath", label: "BS Path" }},
            {{ key: "BalanceSheetCategory", label: "BS Category" }},
            {{ key: "Amount", label: "Amount", money: true }},
            {{ key: "BalanceSheetReason", label: "Reason" }},
          ],
          "No Balance Sheet detail rows were generated."
        );
      }}

      function renderDashboard() {{
        const rows = getFilteredRows();
        topNValue.textContent = String(getTopN());
        updateMetrics(rows);
        renderCategoryChart(rows);
        renderTop10Chart(rows);
        renderDonut(rows);
        renderConfidence(rows);
        renderMonthly(rows);
        renderPayroll();
        renderProfitLossTable(rows);
        renderBalanceSheetTables();
        renderReviewTable(rows);
      }}

      function initDateRange() {{
        const dates = RAW_DATA.map((row) => parseDate(row.Date)).filter(Boolean);
        if (!dates.length) return;
        const min = new Date(Math.min(...dates.map((d) => d.getTime())));
        const max = new Date(Math.max(...dates.map((d) => d.getTime())));
        const format = (d) => `${{d.getFullYear()}}-${{String(d.getMonth() + 1).padStart(2, "0")}}-${{String(d.getDate()).padStart(2, "0")}}`;
        startInput.value = format(min);
        endInput.value = format(max);
      }}

      applyBtn.addEventListener("click", renderDashboard);
      resetBtn.addEventListener("click", () => {{
        initDateRange();
        renderDashboard();
      }});
      downloadBtn.addEventListener("click", downloadOverrides);
      searchInput.addEventListener("input", renderDashboard);
      topNInput.addEventListener("input", renderDashboard);
      onlyUnmappedEl.addEventListener("change", renderDashboard);
      onlyLowConfEl.addEventListener("change", renderDashboard);
      typeFiltersEl.addEventListener("change", renderDashboard);
      loadReportData().then(() => {{
        initTypeFilters();
        initDateRange();
        renderDashboard();
      }});
    </script>
  </body>
</html>
"""

    output_path.write_text(html_content, encoding="utf-8")


def _write_progress_json(
    output_path: Path,
    current: int,
    total: int,
    row: Dict[str, Any],
    mapped: Dict[str, Any],
) -> None:
    percent = 0 if total == 0 else int((current / total) * 100)
    payload = {
        "current": current,
        "total": total,
        "percent": percent,
        "row": row,
        "mapped": mapped,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def _write_progress_html(
    output_path: Path,
    current: int,
    total: int,
    row: Dict[str, Any],
    mapped: Dict[str, Any],
    json_filename: str = "progress.json",
) -> None:
    percent = 0 if total == 0 else int((current / total) * 100)
    invoice = html_lib.escape(str(row.get("InvoiceNumber") or "-"))
    contact = html_lib.escape(str(row.get("Contact") or "-"))
    desc = html_lib.escape(str(row.get("Description") or "-"))
    amount = html_lib.escape(f"{row.get('Amount', 0):,.2f}")
    category = html_lib.escape(str(mapped.get("category", "Unmapped")))
    confidence = html_lib.escape(f"{mapped.get('confidence', 0):.2f}")
    reason = html_lib.escape(str(mapped.get("reason") or "-"))

    intensity = max(0.2, min(1.0, (percent / 100.0) * (float(mapped.get("confidence") or 0.5) + 0.25)))
    html_content = f"""
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>AI Mapping Progress</title>
    <style>
      body {{
        margin: 0;
        font-family: Arial, sans-serif;
        background: #0b0f1a;
        color: #e7ecf3;
      }}
      .container {{
        display: flex;
        gap: 24px;
        padding: 24px;
      }}
      #viz {{
        width: 50%;
        height: 420px;
        border-radius: 12px;
        background: #0f1322;
        box-shadow: 0 0 24px rgba(70, 120, 255, 0.25);
      }}
      .panel {{
        width: 50%;
        background: #11182a;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 0 24px rgba(0, 0, 0, 0.3);
      }}
      .bar {{
        width: 100%;
        height: 12px;
        background: #2a344d;
        border-radius: 8px;
        overflow: hidden;
        margin: 12px 0 18px 0;
      }}
      .bar-fill {{
        height: 100%;
        width: {percent}%;
        background: linear-gradient(90deg, #4cc9f0, #4361ee);
        transition: width 0.4s ease;
      }}
      .label {{
        color: #93a4c3;
        margin-top: 6px;
        font-size: 12px;
      }}
      .value {{
        font-size: 14px;
        margin-bottom: 8px;
      }}
      h2 {{
        margin-top: 0;
      }}
      code {{
        color: #9ef0ff;
      }}
      .note {{
        margin-top: 10px;
        font-size: 12px;
        color: #8fa3c9;
      }}
    </style>
  </head>
  <body>
    <div class="container">
      <canvas id="viz"></canvas>
      <div class="panel">
        <h2>AI Mapping In Progress</h2>
        <div class="bar"><div class="bar-fill"></div></div>
        <div class="value" id="progress-text">{current} / {total} ({percent}%)</div>
        <div class="label">Invoice</div>
        <div class="value"><code id="invoice">{invoice}</code></div>
        <div class="label">Contact</div>
        <div class="value" id="contact">{contact}</div>
        <div class="label">Amount</div>
        <div class="value" id="amount">{amount}</div>
        <div class="label">Mapped Category</div>
        <div class="value" id="category">{category}</div>
        <div class="label">Confidence</div>
        <div class="value" id="confidence">{confidence}</div>
        <div class="label">Reason</div>
        <div class="value" id="reason">{reason}</div>
        <div class="label">Description</div>
        <div class="value" id="desc">{desc}</div>
        <div class="note" id="progress-note"></div>
      </div>
    </div>

    <script>
      const DATA_URL = "{json_filename}";
      const barFill = document.querySelector(".bar-fill");
      const progressText = document.getElementById("progress-text");
      const invoiceEl = document.getElementById("invoice");
      const contactEl = document.getElementById("contact");
      const amountEl = document.getElementById("amount");
      const categoryEl = document.getElementById("category");
      const confidenceEl = document.getElementById("confidence");
      const reasonEl = document.getElementById("reason");
      const descEl = document.getElementById("desc");
      const noteEl = document.getElementById("progress-note");

      let fetchFailed = 0;

      async function pollProgress() {{
        try {{
          const resp = await fetch(DATA_URL, {{ cache: "no-store" }});
          if (!resp.ok) throw new Error("bad response");
          const data = await resp.json();
          const percent = Number(data.percent || 0);
          const row = data.row || {{}};
          const mapped = data.mapped || {{}};

          barFill.style.width = `${{percent}}%`;
          progressText.textContent = `${{data.current}} / ${{data.total}} (${{percent}}%)`;
          invoiceEl.textContent = row.InvoiceNumber || "-";
          contactEl.textContent = row.Contact || "-";
          amountEl.textContent = Number(row.Amount || 0).toLocaleString(undefined, {{ minimumFractionDigits: 2 }});
          categoryEl.textContent = mapped.category || "Unmapped";
          confidenceEl.textContent = Number(mapped.confidence || 0).toFixed(2);
          reasonEl.textContent = mapped.reason || "-";
          descEl.textContent = row.Description || "-";
          noteEl.textContent = "";
          fetchFailed = 0;
        }} catch (err) {{
          fetchFailed += 1;
          if (fetchFailed >= 3 && window.location.protocol === "file:") {{
            noteEl.textContent = "Open via local server for live updates (python -m http.server --directory output 8000).";
            setTimeout(() => window.location.reload(), 1000);
          }}
        }}
      }}

      const canvas = document.getElementById("viz");
      const ctx = canvas.getContext("2d");
      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const intensity = {intensity:.3f};

      let width = 0;
      let height = 0;
      let centerX = 0;
      let centerY = 0;
      let animationId = null;
      let lastTime = 0;
      let frameInterval = 1000 / 60;
      const baseKey = "jarvisBaseTime";
      let baseTime = Number(localStorage.getItem(baseKey));
      if (!baseTime) {{
        baseTime = Date.now();
        localStorage.setItem(baseKey, String(baseTime));
      }}

      const state = {{
        rings: [
          {{ radius: 90, speed: 0.4, dash: 12, gap: 10, color: "rgba(76,201,240,0.9)" }},
          {{ radius: 130, speed: -0.25, dash: 18, gap: 12, color: "rgba(67,97,238,0.7)" }},
          {{ radius: 170, speed: 0.18, dash: 8, gap: 18, color: "rgba(138,99,255,0.5)" }},
        ],
        sparks: [],
      }};
      let bgCanvas = document.createElement("canvas");
      let bgCtx = bgCanvas.getContext("2d");
      let noisePoints = [];

      function init() {{
        resize();
        state.sparks = Array.from({{ length: 28 }}, () => newSpark());
        render(0);
      }}

      function resize() {{
        const rect = canvas.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
        canvas.width = rect.width * devicePixelRatio;
        canvas.height = rect.height * devicePixelRatio;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        centerX = width / 2;
        centerY = height / 2;
        bgCanvas.width = rect.width * devicePixelRatio;
        bgCanvas.height = rect.height * devicePixelRatio;
        bgCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        buildStaticLayer();
      }}

      function destroy() {{
        if (animationId) {{
          cancelAnimationFrame(animationId);
          animationId = null;
        }}
        window.removeEventListener("resize", resize);
      }}

      function newSpark() {{
        const angle = Math.random() * Math.PI * 2;
        const radius = 190 + Math.random() * 40;
        return {{
          angle,
          radius,
          speed: 0.6 + Math.random() * 0.6,
          size: 1 + Math.random() * 1.8,
          alpha: 0.2 + Math.random() * 0.6,
          drift: (Math.random() - 0.5) * 0.6,
          ttl: 150 + Math.random() * 200,
        }};
      }}

      function buildNoise(count) {{
        noisePoints = Array.from({{ length: count }}, () => ({{
          x: Math.random() * width,
          y: Math.random() * height,
          alpha: 0.01 + Math.random() * 0.03,
        }}));
      }}

      function buildStaticLayer() {{
        buildNoise(800);
        drawBackground(bgCtx);
        drawHexGrid(bgCtx);
      }}

      function drawBackground(targetCtx) {{
        targetCtx.fillStyle = "#0b0f1a";
        targetCtx.fillRect(0, 0, width, height);
        const vignette = targetCtx.createRadialGradient(centerX, centerY, width * 0.1, centerX, centerY, width * 0.7);
        vignette.addColorStop(0, "rgba(8,12,24,0)");
        vignette.addColorStop(1, "rgba(0,0,0,0.6)");
        targetCtx.fillStyle = vignette;
        targetCtx.fillRect(0, 0, width, height);

        targetCtx.fillStyle = "rgba(255,255,255,0.02)";
        noisePoints.forEach((pt) => {{
          targetCtx.globalAlpha = pt.alpha;
          targetCtx.fillRect(pt.x, pt.y, 1, 1);
        }});
        targetCtx.globalAlpha = 1;
      }}

      function drawHexGrid(targetCtx) {{
        targetCtx.save();
        targetCtx.strokeStyle = "rgba(60,90,140,0.12)";
        targetCtx.lineWidth = 1;
        const size = 16;
        const cols = Math.ceil(width / (size * 1.5));
        const rows = Math.ceil(height / (size * 1.3));
        for (let y = 0; y < rows; y++) {{
          for (let x = 0; x < cols; x++) {{
            const offsetX = (y % 2) * (size * 0.75);
            const cx = x * size * 1.5 + offsetX;
            const cy = y * size * 1.3;
            targetCtx.beginPath();
            for (let i = 0; i < 6; i++) {{
              const ang = (Math.PI / 3) * i;
              const px = cx + Math.cos(ang) * size;
              const py = cy + Math.sin(ang) * size;
              if (i === 0) targetCtx.moveTo(px, py);
              else targetCtx.lineTo(px, py);
            }}
            targetCtx.closePath();
            targetCtx.stroke();
          }}
        }}
        targetCtx.restore();
      }}

      function drawCore(t) {{
        const pulse = 1 + Math.sin(t * 0.002) * 0.08 * intensity;
        const r = 28 * pulse;

        for (let i = 0; i < 3; i++) {{
          ctx.beginPath();
          ctx.fillStyle = `rgba(76,201,240,${{0.4 - i * 0.12}})`;
          ctx.arc(centerX, centerY, r + i * 12, 0, Math.PI * 2);
          ctx.fill();
        }}

        ctx.beginPath();
        const grad = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, r);
        grad.addColorStop(0, "rgba(170,255,255,1)");
        grad.addColorStop(0.6, "rgba(76,201,240,0.9)");
        grad.addColorStop(1, "rgba(67,97,238,0.2)");
        ctx.fillStyle = grad;
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.fill();
      }}

      function drawRings(t) {{
        state.rings.forEach((ring, idx) => {{
          const angle = t * 0.0006 * ring.speed;
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(angle);
          ctx.strokeStyle = ring.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([ring.dash, ring.gap]);
          ctx.beginPath();
          ctx.arc(0, 0, ring.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }});
        ctx.setLineDash([]);
      }}

      function drawRadar(t) {{
        const sweepAngle = (t * 0.0015) % (Math.PI * 2);
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(sweepAngle);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 220);
        grad.addColorStop(0, "rgba(76,201,240,0.35)");
        grad.addColorStop(1, "rgba(76,201,240,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 220, -0.15, 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }}

      function drawSparks(t) {{
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        state.sparks.forEach((s) => {{
          s.angle += 0.002 * s.speed * intensity;
          s.radius -= 0.08 * s.speed;
          s.ttl -= 1;
          const x = centerX + Math.cos(s.angle) * s.radius;
          const y = centerY + Math.sin(s.angle) * (s.radius * 0.6) + Math.sin(t * 0.002 + s.angle) * 8;

          ctx.beginPath();
          ctx.fillStyle = `rgba(130,200,255,${{s.alpha}})`;
          ctx.arc(x, y, s.size, 0, Math.PI * 2);
          ctx.fill();

          if (s.radius < 40 || s.ttl <= 0) {{
            Object.assign(s, newSpark());
          }}
        }});
        ctx.restore();
      }}

      function render(now) {{
        const t = prefersReduced ? 0 : now - baseTime;
        ctx.drawImage(bgCanvas, 0, 0, width, height);
        if (!prefersReduced) {{
          drawRadar(t);
          drawRings(t);
          drawSparks(t);
        }}
        drawCore(t);
      }}

      function loop(timestamp) {{
        const isHidden = document.hidden;
        frameInterval = isHidden ? 1000 / 30 : 1000 / 60;
        if (timestamp - lastTime >= frameInterval) {{
          render(Date.now());
          lastTime = timestamp;
        }}
        animationId = requestAnimationFrame(loop);
      }}

      init();
      window.addEventListener("resize", resize);
      if (!prefersReduced) {{
        animationId = requestAnimationFrame(loop);
      }} else {{
        render(Date.now());
      }}

      pollProgress();
      setInterval(pollProgress, 1000);
    </script>
  </body>
</html>
"""

    output_path.write_text(html_content, encoding="utf-8")


def _write_report_assistant_html(output_path: Path) -> None:
    html_content = """<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>QFR Report Assistant</title>
    <style>
      :root {
        --bg: #f4f7fb;
        --panel: #ffffff;
        --text: #0f172a;
        --muted: #475569;
        --border: #e2e8f0;
        --accent: #2563eb;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .page {
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 16px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 14px;
      }
      h1 { margin: 0 0 10px 0; font-size: 22px; }
      h2 { margin: 0 0 10px 0; font-size: 16px; }
      .muted { color: var(--muted); font-size: 13px; }
      .quick-list { display: flex; flex-direction: column; gap: 8px; }
      .btn {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        cursor: pointer;
        background: #f8fafc;
        text-align: left;
      }
      .btn:hover { border-color: #cbd5e1; }
      textarea {
        width: 100%;
        min-height: 96px;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        font-size: 14px;
      }
      input[type="password"] {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        font-size: 13px;
      }
      .actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
      .primary {
        background: var(--accent);
        color: white;
        border: none;
        border-radius: 10px;
        padding: 10px 14px;
        cursor: pointer;
        font-weight: 600;
      }
      .ghost {
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 14px;
        cursor: pointer;
      }
      .out {
        white-space: pre-wrap;
        background: #0b1020;
        color: #e2e8f0;
        border-radius: 12px;
        padding: 14px;
        min-height: 560px;
        overflow: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        line-height: 1.45;
      }
      .ok { color: #16a34a; }
      .warn { color: #f59e0b; }
      @media (max-width: 1000px) {
        .page { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="card">
        <h1>Report Assistant</h1>
        <div class="muted">Natural-language Q&A on current report_data.json</div>
        <div style="height: 12px"></div>
        <h2>Common Questions</h2>
        <div class="quick-list" id="quick-list"></div>
        <div style="height: 12px"></div>
        <h2>Ask Freely</h2>
        <textarea id="question" placeholder="Type a business question..."></textarea>
        <div style="height: 8px"></div>
        <div class="muted">Optional: provide OpenAI API key to let GPT draft polished narrative.</div>
        <input id="api-key" type="password" placeholder="sk-... (optional)" />
        <div class="actions">
          <button class="primary" id="ask-btn">Generate Answer</button>
          <button class="ghost" id="clear-btn">Clear</button>
        </div>
        <div style="height: 6px"></div>
        <div class="muted" id="status">Loading data...</div>
      </div>
      <div class="card">
        <h2>Answer</h2>
        <div id="out" class="out"></div>
      </div>
    </div>
    <script>
      const quickQuestions = [
        "Please provide the sales figure for December 2025 and compare it with December 2024.",
        "What is our payroll cost as at December 2025, and what is the fluctuation of payroll throughout the year 2025?",
        "Show me the motor vehicle expenses in November and December 2025, and what kind of expenses they relate to.",
        "Draw a flowchart of rent expenses showing any changes throughout the year 2025.",
        "List the supplier of advertising companies from June 2025 to December 2025."
      ];

      const outEl = document.getElementById("out");
      const statusEl = document.getElementById("status");
      const questionEl = document.getElementById("question");
      const keyEl = document.getElementById("api-key");
      const quickListEl = document.getElementById("quick-list");
      const askBtn = document.getElementById("ask-btn");
      const clearBtn = document.getElementById("clear-btn");
      let rawRows = [];
      let csvFallbackText = "";
      let loadedFrom = "";

      function parseXeroDate(v) {
        if (!v) return null;
        const s = String(v);
        const m = /\\/Date\\((\\d+)/.exec(s);
        if (m) return new Date(Number(m[1]));
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      function yyyymm(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }
      function inMonth(d, y, m) {
        return d && d.getFullYear() === y && d.getMonth() + 1 === m;
      }
      function money(n) {
        return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      function rowsByCategory(cat) {
        return rawRows.filter(r => String(r.MappedCategory || "") === cat);
      }
      function monthSum(cat, y, m) {
        return rowsByCategory(cat)
          .filter(r => inMonth(parseXeroDate(r.Date), y, m))
          .reduce((s, r) => s + Number(r.Amount || 0), 0);
      }
      function topDescriptions(rows, n = 6) {
        const map = new Map();
        rows.forEach(r => {
          const k = String(r.Description || "No description");
          map.set(k, (map.get(k) || 0) + Number(r.Amount || 0));
        });
        return [...map.entries()].sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n);
      }
      function supplierList(cat, fromDate, toDate) {
        const seen = new Set();
        return rowsByCategory(cat)
          .filter(r => {
            const d = parseXeroDate(r.Date);
            return d && d >= fromDate && d <= toDate;
          })
          .map(r => String(r.Contact || "").trim())
          .filter(x => x && !seen.has(x) && seen.add(x));
      }

      function flowchartRent2025() {
        const rows = rowsByCategory("Rent").filter(r => {
          const d = parseXeroDate(r.Date);
          return d && d.getFullYear() === 2025;
        });
        const monthly = {};
        rows.forEach(r => {
          const d = parseXeroDate(r.Date);
          const k = yyyymm(d);
          monthly[k] = (monthly[k] || 0) + Number(r.Amount || 0);
        });
        const keys = Object.keys(monthly).sort();
        let txt = "Rent expense flowchart (2025)\\n\\n";
        txt += "Start -> ";
        txt += keys.map((k, i) => `${k} [${money(monthly[k])}]`).join(" -> ");
        txt += " -> End\\n\\n";
        txt += "Month-on-month change:\\n";
        keys.forEach((k, i) => {
          if (i === 0) {
            txt += `- ${k}: ${money(monthly[k])} (baseline)\\n`;
          } else {
            const prev = monthly[keys[i - 1]];
            const delta = monthly[k] - prev;
            txt += `- ${k}: ${money(monthly[k])} (delta ${delta >= 0 ? "+" : ""}${money(delta)})\\n`;
          }
        });
        return txt;
      }

      function localAnswer(question) {
        const q = question.toLowerCase().replace(/[.,!?]/g, " ");
        if (q.includes("sales") && (q.includes("december 2025") || q.includes("dec 2025"))) {
          const dec2025 = monthSum("Sales", 2025, 12);
          const dec2024 = monthSum("Sales", 2024, 12);
          let txt = `Sales in Dec-2025: ${money(dec2025)}\\nSales in Dec-2024: ${money(dec2024)}\\nChange: ${money(dec2025 - dec2024)}`;
          if (dec2024 === 0) {
            txt += "\\n\\nNote: No mapped Sales rows were found for Dec-2024 in current dataset.";
          }
          return txt;
        }
        if ((q.includes("payroll") || q.includes("wages")) && q.includes("2025")) {
          const rows = rowsByCategory("Wages and Salaries").filter(r => {
            const d = parseXeroDate(r.Date); return d && d.getFullYear() === 2025;
          });
          const byMonth = {};
          rows.forEach(r => {
            const k = yyyymm(parseXeroDate(r.Date));
            byMonth[k] = (byMonth[k] || 0) + Number(r.Amount || 0);
          });
          const keys = Object.keys(byMonth).sort();
          const total = keys.reduce((s,k)=>s+byMonth[k],0);
          let txt = `Payroll cost in 2025 (mapped Wages and Salaries): ${money(total)}\\n\\nMonthly fluctuation:\\n`;
          keys.forEach((k,i) => {
            if (i===0) txt += `- ${k}: ${money(byMonth[k])} (baseline)\\n`;
            else {
              const d = byMonth[k]-byMonth[keys[i-1]];
              txt += `- ${k}: ${money(byMonth[k])} (delta ${d>=0?"+":""}${money(d)})\\n`;
            }
          });
          return txt;
        }
        if (q.includes("motor vehicle")) {
          const monthHint = (q.includes("nov") || q.includes("november"))
            ? [11, 12]
            : (q.includes("may") || q.includes("june"))
              ? [5, 6]
              : [11, 12];
          const m1 = monthHint[0], m2 = monthHint[1];
          const a1 = rowsByCategory("Motor Vehicle Expenses").filter(r => inMonth(parseXeroDate(r.Date), 2025, m1));
          const a2 = rowsByCategory("Motor Vehicle Expenses").filter(r => inMonth(parseXeroDate(r.Date), 2025, m2));
          const t1 = a1.reduce((s,r)=>s+Number(r.Amount||0),0);
          const t2 = a2.reduce((s,r)=>s+Number(r.Amount||0),0);
          let txt = `Motor Vehicle Expenses - ${String(m1).padStart(2,"0")}/2025 total: ${money(t1)}\\n`;
          txt += `Motor Vehicle Expenses - ${String(m2).padStart(2,"0")}/2025 total: ${money(t2)}\\n\\n`;
          txt += "Related expense types (top descriptions):\\n";
          const merged = [...a1, ...a2];
          if (merged.length === 0) {
            const all = rowsByCategory("Motor Vehicle Expenses").filter(r => {
              const d = parseXeroDate(r.Date); return d && d.getFullYear() === 2025;
            });
            const byM = {};
            all.forEach(r => {
              const d = parseXeroDate(r.Date);
              const k = yyyymm(d);
              byM[k] = (byM[k] || 0) + Number(r.Amount || 0);
            });
            txt += "- No records found for requested months in current dataset.\\n";
            txt += "Available 2025 months:\\n";
            Object.keys(byM).sort().forEach(k => txt += `  - ${k}: ${money(byM[k])}\\n`);
          } else {
            [...topDescriptions(merged, 8)].forEach(([k,v]) => {
              txt += `- ${k}: ${money(v)}\\n`;
            });
          }
          return txt;
        }
        if (q.includes("flowchart") && q.includes("rent")) {
          return flowchartRent2025();
        }
        if (q.includes("advertising") && (q.includes("june") || q.includes("december") || q.includes("dec"))) {
          const from = new Date("2025-06-01T00:00:00");
          const to = new Date("2025-12-31T23:59:59");
          const suppliers = supplierList("Advertising", from, to);
          return "Advertising suppliers from Jun-Dec 2025:\\n" + (suppliers.length ? suppliers.map(s => `- ${s}`).join("\\n") : "- none");
        }
        const totals = {};
        rawRows.forEach(r => {
          const c = String(r.MappedCategory || "Unmapped");
          totals[c] = (totals[c] || 0) + Number(r.Amount || 0);
        });
        const top = Object.entries(totals).sort((a,b)=>Math.abs(b[1]) - Math.abs(a[1])).slice(0,8);
        let txt = "No exact template matched. Here is a data-backed snapshot:\\n\\nTop category totals:\\n";
        top.forEach(([k,v]) => txt += `- ${k}: ${money(v)}\\n`);
        txt += "\\nTip: Try one of the quick-question buttons on the left for targeted outputs.";
        return txt;
      }

      function datasetSummary() {
        const cats = {};
        rawRows.forEach(r => {
          const c = String(r.MappedCategory || "Unmapped");
          cats[c] = (cats[c] || 0) + 1;
        });
        const topCats = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0, 8);
        let txt = `Dataset rows: ${rawRows.length}`;
        if (loadedFrom) txt += ` (source: ${loadedFrom})`;
        if (topCats.length) {
          txt += "\\nTop categories by row count:\\n";
          topCats.forEach(([k,v]) => txt += `- ${k}: ${v}\\n`);
        }
        if (csvFallbackText) {
          txt += `\\nCSV fallback loaded (${csvFallbackText.split("\\n").length} lines sampled).`;
        }
        return txt;
      }

      async function askGpt(question, localText) {
        const apiKey = keyEl.value.trim();
        if (!apiKey) return null;
        const sampleRows = rawRows.slice(0, 240);
        const csvSnippet = csvFallbackText ? csvFallbackText.split("\\n").slice(0, 120).join("\\n") : "";
        const payload = {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a finance reporting assistant. Use the provided local calculations and dataset context. Be concise, business-friendly, and explicit about assumptions."
            },
            {
              role: "user",
              content:
                "Question:\\n" + question +
                "\\n\\nLocal computed answer draft:\\n" + localText +
                "\\n\\nDataset summary:\\n" + datasetSummary() +
                "\\n\\nDataset sample rows (JSON):\\n" + JSON.stringify(sampleRows) +
                (csvSnippet ? "\\n\\nCSV fallback sample:\\n" + csvSnippet : "")
            }
          ],
          temperature: 0.1
        };
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error(`OpenAI error: ${resp.status}`);
        const data = await resp.json();
        return data?.choices?.[0]?.message?.content || null;
      }

      async function handleAsk() {
        const q = questionEl.value.trim();
        if (!q) {
          outEl.textContent = "Please enter a question first.";
          return;
        }
        if (!rawRows.length && !csvFallbackText) {
          await loadDataset();
        }
        statusEl.innerHTML = '<span class="warn">Generating...</span>';
        const local = localAnswer(q);
        outEl.textContent = "Local answer draft:\\n\\n" + local;
        try {
          const gpt = await askGpt(q, local);
          if (gpt) {
            outEl.textContent = gpt + "\\n\\n---\\n(Local draft)\\n" + local;
            statusEl.innerHTML = '<span class="ok">Done with GPT.</span>';
          } else {
            statusEl.innerHTML = '<span class="ok">Done with local engine.</span>';
          }
        } catch (err) {
          statusEl.innerHTML = '<span class="warn">Local done. GPT unavailable.</span>';
          outEl.textContent = local + "\\n\\n[GPT call failed] " + String(err);
        }
      }

      clearBtn.addEventListener("click", () => {
        outEl.textContent = "";
        questionEl.value = "";
        statusEl.textContent = "Ready.";
      });
      askBtn.addEventListener("click", handleAsk);

      function renderQuickButtons() {
        quickQuestions.forEach(q => {
          const b = document.createElement("button");
          b.className = "btn";
          b.textContent = q;
          b.onclick = () => {
            questionEl.value = q;
            handleAsk();
          };
          quickListEl.appendChild(b);
        });
      }

      async function loadDataset() {
        rawRows = [];
        csvFallbackText = "";
        loadedFrom = "";

        const jsonCandidates = ["report_data.json", "./report_data.json", "../output/report_data.json", "/output/report_data.json"];
        for (const p of jsonCandidates) {
          try {
            const resp = await fetch(p, { cache: "no-store" });
            if (!resp.ok) continue;
            const payload = await resp.json();
            const rows = Array.isArray(payload?.raw_data) ? payload.raw_data :
              Array.isArray(payload?.rows) ? payload.rows :
              Array.isArray(payload?.line_items) ? payload.line_items : [];
            if (rows.length) {
              rawRows = rows;
              loadedFrom = p;
              return true;
            }
          } catch (_) {}
        }

        const csvCandidates = [
          "linebyline_ai_breakdown_selected_accounts.csv",
          "./linebyline_ai_breakdown_selected_accounts.csv",
          "../output/linebyline_ai_breakdown_selected_accounts.csv",
          "/output/linebyline_ai_breakdown_selected_accounts.csv"
        ];
        for (const p of csvCandidates) {
          try {
            const resp = await fetch(p, { cache: "no-store" });
            if (!resp.ok) continue;
            const text = await resp.text();
            if (text && text.trim()) {
              csvFallbackText = text;
              loadedFrom = p;
              return true;
            }
          } catch (_) {}
        }
        return false;
      }

      async function init() {
        renderQuickButtons();
        try {
          const ok = await loadDataset();
          if (!ok) throw new Error("Cannot load report_data.json or fallback CSV");
          if (rawRows.length) {
            statusEl.innerHTML = `<span class="ok">Loaded ${rawRows.length} rows from ${loadedFrom}.</span>`;
          } else {
            statusEl.innerHTML = `<span class="ok">Loaded CSV fallback from ${loadedFrom}.</span>`;
          }
        } catch (err) {
          statusEl.innerHTML = '<span class="warn">Failed to load report_data and CSV fallback</span>';
          outEl.textContent = String(err);
        }
      }
      init();
    </script>
  </body>
</html>
"""
    output_path.write_text(html_content, encoding="utf-8")


def _allowed_categories_for_row(
    row: Dict[str, Any],
    category_defs: Dict[str, Any],
) -> List[Dict[str, Any]]:
    account_code = str(row.get("AccountCode") or "").strip()
    tx_type = row.get("Type")
    if tx_type == "Payroll":
        return category_defs["payroll_payload"] or category_defs["allowed_payload"]
    if account_code.startswith("2"):
        return category_defs["income_payload"] or category_defs["allowed_payload"]
    return category_defs["allowed_payload"]


def _map_profit_loss_row(
    row: Dict[str, Any],
    category_defs: Dict[str, Any],
    request_timeout_seconds: float,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    working_row = dict(row)
    allowed = _allowed_categories_for_row(working_row, category_defs)
    account_code = str(working_row.get("AccountCode") or "").strip()
    account_name = str(working_row.get("AccountName") or "")
    tx_type = working_row.get("Type")

    try:
        mapped = _apply_rule_first_mapping(working_row, category_defs["fallback"])
        if mapped is None:
            mapped = map_description(
                contact=str(working_row.get("Contact") or ""),
                description=str(working_row.get("Description") or ""),
                amount=_safe_float(working_row.get("Amount")),
                allowed_categories=allowed,
                account_code=account_code,
                account_name=account_name,
                tx_type=str(tx_type or ""),
                request_timeout_seconds=request_timeout_seconds,
            )
        mapped = _apply_post_mapping_policy_guards(
            working_row,
            mapped,
            category_defs["fallback"],
        )
        mapped, _ = validate_mapping_result(mapped, allowed)
    except Exception as exc:  # noqa: BLE001
        mapped = rejected_mapping(
            f"Mapping runtime error: {exc}",
            "MAPPING_RUNTIME_ERROR",
        )

    mapped_row = {
        **working_row,
        "MappedCategory": mapped["category"],
        "Confidence": mapped["confidence"],
        "Reason": mapped["reason"],
        "RuleID": mapped.get("rule_id"),
        "ReviewRequired": mapped['confidence'] <= REVIEW_CONFIDENCE_THRESHOLD or mapped['category'] == category_defs['fallback'],
        "ReviewReason": mapped['reason'] if mapped['confidence'] <= REVIEW_CONFIDENCE_THRESHOLD or mapped['category'] == category_defs['fallback'] else '',
    }
    return mapped_row, mapped


def _map_profit_loss_rows(
    rows: List[Dict[str, Any]],
    category_defs: Dict[str, Any],
    worker_count: int,
    request_timeout_seconds: float,
    progress_path: Path,
    progress_json_path: Path,
    write_progress: bool,
) -> List[Dict[str, Any]]:
    if not rows:
        return []

    effective_workers = min(worker_count, len(rows))
    print(
        f"Mapping P&L lines with {effective_workers} worker(s); "
        f"OpenAI timeout {request_timeout_seconds:g}s."
    )
    mapped_rows: List[Dict[str, Any]] = [{} for _ in rows]
    with ThreadPoolExecutor(max_workers=effective_workers, thread_name_prefix="qfr-map") as executor:
        future_to_index = {
            executor.submit(
                _map_profit_loss_row,
                row,
                category_defs,
                request_timeout_seconds,
            ): index
            for index, row in enumerate(rows)
        }
        for completed, future in enumerate(as_completed(future_to_index), start=1):
            source_index = future_to_index[future]
            mapped_row, mapped = future.result()
            mapped_rows[source_index] = mapped_row
            if write_progress:
                _write_progress_json(
                    progress_json_path,
                    completed,
                    len(rows),
                    mapped_row,
                    mapped,
                )
                _write_progress_html(
                    progress_path,
                    completed,
                    len(rows),
                    mapped_row,
                    mapped,
                    json_filename="progress.json",
                )
    return mapped_rows


def main() -> None:
    args = parse_args()
    ensure_output_dir()
    env = _load_env_and_token()
    access_token = env["access_token"]
    tenant_id = env["tenant_id"]

    # 1) Read P&L report (raw JSON for now, easier to inspect)
    report_from, report_to = get_report_date_range(args)
    start_date = _parse_iso_date(report_from)
    end_date = _parse_iso_date(report_to)
    balance_sheet_date = report_to
    opening_balance_sheet_date = (start_date - timedelta(days=1)).isoformat()
    print(f"Fetching Profit and Loss report ({report_from} to {report_to})...")
    cached_pl = _load_json_cache("raw_pl.json") if args.use_cache else None
    if cached_pl is not None:
        pl = cached_pl
    else:
        pl = get_profit_and_loss(
            access_token,
            tenant_id,
            from_date=report_from,
            to_date=report_to,
            payments_only=args.payments_only,
        )
        _write_json_cache("raw_pl.json", pl)

    print(f"Fetching Balance Sheet report (as at {balance_sheet_date})...")
    cached_balance_sheet = _load_json_cache("raw_balance_sheet.json") if args.use_cache else None
    if cached_balance_sheet is not None:
        balance_sheet = cached_balance_sheet
    else:
        balance_sheet = get_balance_sheet(access_token, tenant_id, date=balance_sheet_date)
        _write_json_cache("raw_balance_sheet.json", balance_sheet)

    print(f"Fetching opening Balance Sheet report (as at {opening_balance_sheet_date})...")
    cached_opening_balance_sheet = _load_json_cache("raw_opening_balance_sheet.json") if args.use_cache else None
    if cached_opening_balance_sheet is not None:
        opening_balance_sheet = cached_opening_balance_sheet
    else:
        opening_balance_sheet = get_balance_sheet(access_token, tenant_id, date=opening_balance_sheet_date)
        _write_json_cache("raw_opening_balance_sheet.json", opening_balance_sheet)

    # 2) Pull chart of accounts for predefined fields
    print("Fetching chart of accounts...")
    account_rows: List[Dict[str, Any]] = []
    account_lookup: Dict[str, str] = {}
    account_class_lookup: Dict[str, str] = {}
    account_meta_lookup: Dict[str, Dict[str, Any]] = {}
    try:
        accounts_payload = _call_with_hard_timeout(
            get_accounts,
            access_token,
            tenant_id,
            timeout_seconds=45,
            label="Chart of accounts fetch",
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Chart of accounts not available: {exc}")
        accounts_payload = _load_cached_accounts_payload()
        if accounts_payload:
            print("Using cached chart_of_accounts.json fallback.")

    for acc in accounts_payload.get("Accounts", []):
        code = str(acc.get("Code") or "").strip()
        name = acc.get("Name")
        account_class = str(acc.get("Class") or "").strip()
        if code:
            account_lookup[code] = name or ""
            if account_class:
                account_class_lookup[code] = account_class
        account_row = {
            "AccountID": acc.get("AccountID"),
            "Code": code or None,
            "Name": name,
            "Type": acc.get("Type"),
            "Status": acc.get("Status"),
            "Class": acc.get("Class"),
            "TaxType": acc.get("TaxType"),
            "Description": acc.get("Description"),
            "ReportingCode": acc.get("ReportingCode"),
            "ReportingCodeName": acc.get("ReportingCodeName"),
        }
        account_rows.append(account_row)
        if code:
            account_meta_lookup[code] = account_row

    if account_rows:
        accounts_df = pd.DataFrame(account_rows)
        accounts_csv = OUTPUT_DIR / "chart_of_accounts.csv"
        accounts_json = OUTPUT_DIR / "chart_of_accounts.json"
        accounts_df.to_csv(accounts_csv, index=False)
        accounts_df.to_json(accounts_json, orient="records")

    xero_balance_sheet_df = _enrich_balance_sheet_account_codes(
        extract_xero_balance_sheet_lines(balance_sheet),
        account_rows,
    )
    opening_balance_sheet_df = _enrich_balance_sheet_account_codes(
        extract_xero_balance_sheet_lines(opening_balance_sheet),
        account_rows,
    )
    if not opening_balance_sheet_df.empty:
        opening_balance_sheet_df.to_csv(OUTPUT_DIR / "xero_opening_balance_sheet_lines.csv", index=False)
        opening_balance_sheet_df.to_excel(OUTPUT_DIR / "xero_opening_balance_sheet_lines.xlsx", index=False)
    if not xero_balance_sheet_df.empty:
        xero_balance_sheet_df.to_csv(OUTPUT_DIR / "xero_balance_sheet_lines.csv", index=False)
        xero_balance_sheet_df.to_excel(OUTPUT_DIR / "xero_balance_sheet_lines.xlsx", index=False)
    balance_sheet_account_map = _build_balance_sheet_account_map(xero_balance_sheet_df, account_rows)
    receivable_account_code = _find_account_code(account_rows, ["Accounts Receivable"], "ASSET")
    payable_account_code = _find_account_code(account_rows, ["Accounts Payable"], "LIABILITY")
    gst_account_code = _find_account_code(account_rows, ["GST"], "LIABILITY")

    # 3) Pull bills and invoices (all pages)
    print("Fetching bills (ACCPAY)...")
    bills_payload = _cached_fetch_all_invoices(
        args,
        "raw_bills.json",
        get_bills,
        access_token,
        tenant_id,
        "bills",
    )
    print("Fetching invoices (ACCREC)...")
    invoices_payload = _cached_fetch_all_invoices(
        args,
        "raw_invoices.json",
        get_invoices,
        access_token,
        tenant_id,
        "invoices",
    )
    print("Fetching bank transactions...")
    bank_payload = _cached_fetch_all_pages(
        args,
        "raw_bank_transactions.json",
        get_bank_transactions,
        access_token,
        tenant_id,
        "bank transactions",
        "BankTransactions",
    )
    print("Fetching credit notes...")
    credit_payload = _cached_fetch_all_pages(
        args,
        "raw_credit_notes.json",
        get_credit_notes,
        access_token,
        tenant_id,
        "credit notes",
        "CreditNotes",
    )
    print("Fetching payments...")
    payments_payload = _cached_fetch_all_pages(
        args,
        "raw_payments.json",
        get_payments,
        access_token,
        tenant_id,
        "payments",
        "Payments",
    )
    print("Fetching bank transfers...")
    bank_transfers_payload = _cached_fetch_all_pages(
        args,
        "raw_bank_transfers.json",
        get_bank_transfers,
        access_token,
        tenant_id,
        "bank transfers",
        "BankTransfers",
    )
    finance_balance_sheet_payload: Dict[str, Any] = {}
    print("Fetching Finance API Balance Sheet account detail...")
    cached_finance_payload = _load_json_cache("raw_finance_balance_sheet.json") if args.use_cache else None
    if cached_finance_payload is not None:
        finance_balance_sheet_payload = cached_finance_payload
    else:
        try:
            finance_balance_sheet_payload = get_financial_statement_balance_sheet(
                access_token,
                tenant_id,
                balance_sheet_date,
            )
            _write_json_cache("raw_finance_balance_sheet.json", finance_balance_sheet_payload)
        except Exception as exc:  # noqa: BLE001
            print(f"Finance API Balance Sheet not available or not authorized: {exc}")

    manual_journal_payload: Dict[str, Any] = {"ManualJournals": []}
    if args.no_manual_journals:
        print("Manual journals disabled by --no-manual-journals.")
    else:
        print("Fetching manual journals...")
        manual_journal_payload = _cached_fetch_all_pages(
            args,
            "raw_manual_journals.json",
            get_manual_journals,
            access_token,
            tenant_id,
            "manual journals",
            "ManualJournals",
        )
    journals_payload: Dict[str, Any] = {"Journals": []}
    if args.no_journals:
        print("Journals disabled by --no-journals.")
    else:
        print("Fetching journals...")
        try:
            journals_payload = _cached_fetch_journals(args, "raw_journals.json", access_token, tenant_id)
        except Exception as exc:  # noqa: BLE001
            print(f"Journals not available or not authorized: {exc}")

    bill_counts = _count_line_items(bills_payload, "Invoices")
    invoice_counts = _count_line_items(invoices_payload, "Invoices")
    bank_counts = _count_line_items(bank_payload, "BankTransactions")
    credit_counts = _count_line_items(credit_payload, "CreditNotes")
    payment_counts = _count_line_items(payments_payload, "Payments")
    bank_transfer_counts = _count_line_items(bank_transfers_payload, "BankTransfers")
    manual_journal_counts = _count_manual_journal_lines(manual_journal_payload)
    journal_counts = _count_journal_lines(journals_payload)
    print(
        "Bills fetched: "
        f"{bill_counts['items']} invoices, {bill_counts['lines']} line items "
        f"({bill_counts['zero_lines']} with 0 lines)."
    )
    print(
        "Invoices fetched: "
        f"{invoice_counts['items']} invoices, {invoice_counts['lines']} line items "
        f"({invoice_counts['zero_lines']} with 0 lines)."
    )
    print(
        "Bank transactions fetched: "
        f"{bank_counts['items']} transactions, {bank_counts['lines']} line items "
        f"({bank_counts['zero_lines']} with 0 lines)."
    )
    print(
        "Credit notes fetched: "
        f"{credit_counts['items']} notes, {credit_counts['lines']} line items "
        f"({credit_counts['zero_lines']} with 0 lines)."
    )
    print(
        "Payments fetched: "
        f"{payment_counts['items']} payments "
        f"({payment_counts['zero_lines']} with 0 lines)."
    )
    print(
        "Bank transfers fetched: "
        f"{bank_transfer_counts['items']} transfers "
        f"({bank_transfer_counts['zero_lines']} with 0 lines)."
    )
    print(
        "Manual journals fetched: "
        f"{manual_journal_counts['items']} journals, {manual_journal_counts['lines']} lines "
        f"({manual_journal_counts['zero_lines']} with 0 lines)."
    )
    print(
        "Journals fetched: "
        f"{journal_counts['items']} journals, {journal_counts['lines']} lines "
        f"({journal_counts['zero_lines']} with 0 lines)."
    )

    if args.dump_raw:
        _write_json_cache("raw_bills.json", bills_payload)
        _write_json_cache("raw_invoices.json", invoices_payload)
        _write_json_cache("raw_bank_transactions.json", bank_payload)
        _write_json_cache("raw_credit_notes.json", credit_payload)
        _write_json_cache("raw_payments.json", payments_payload)
        _write_json_cache("raw_bank_transfers.json", bank_transfers_payload)
        _write_json_cache("raw_manual_journals.json", manual_journal_payload)
        _write_json_cache("raw_journals.json", journals_payload)

    # 4) Pull payroll report (preferred) or payruns (fallback)
    print("Fetching payroll report (if enabled)...")
    payroll_payload: Dict[str, Any] = {}
    payroll_summary_df = pd.DataFrame()
    payroll_mode = "none"
    if not args.no_payroll:
        try:
            reports_payload = get_reports(access_token, tenant_id)
            payroll_report_meta = _find_payroll_report(reports_payload)
            if payroll_report_meta:
                report_id = payroll_report_meta.get("ReportID") or payroll_report_meta.get("ReportId")
                report_name = payroll_report_meta.get("ReportName") or payroll_report_meta.get("ReportTitle")
                report_key = report_id or report_name
                if report_key:
                    payroll_payload = get_report_by_id(access_token, tenant_id, report_key)
                    payroll_mode = "report"
                    (OUTPUT_DIR / "raw_payroll_report.json").write_text(
                        json.dumps(payroll_payload, indent=2), encoding="utf-8"
                    )
                    payroll_summary_df = extract_report_lines(payroll_payload)
                    if not payroll_summary_df.empty:
                        payroll_csv = OUTPUT_DIR / "payroll_report_lines.csv"
                        payroll_xlsx = OUTPUT_DIR / "payroll_report_lines.xlsx"
                        payroll_summary_df.to_csv(payroll_csv, index=False)
                        payroll_summary_df.to_excel(payroll_xlsx, index=False)
                else:
                    print("Payroll report found but missing ReportID/ReportName.")
            else:
                print("No payroll report found in /Reports list.")
        except Exception as exc:  # noqa: BLE001
            print(f"Payroll report lookup failed: {exc}")

        if payroll_mode != "report":
            try:
                payroll_payload = get_payruns(access_token, tenant_id)
                payroll_mode = "payrun"
            except Exception as exc:  # noqa: BLE001
                print(f"Payroll not available or not authorized: {exc}")
    else:
        print("Payroll disabled by --no-payroll.")

    bill_rows = flatten_invoices(bills_payload, "Bill", start_date, end_date, account_lookup)
    invoice_rows = flatten_invoices(invoices_payload, "Invoice", start_date, end_date, account_lookup)
    bank_rows = flatten_bank_transactions(bank_payload, start_date, end_date, account_lookup)
    credit_rows = flatten_credit_notes(credit_payload, start_date, end_date, account_lookup)
    manual_journal_rows = flatten_manual_journals(
        manual_journal_payload,
        start_date,
        end_date,
        account_lookup,
        account_class_lookup,
    )
    journal_rows = flatten_journals(
        journals_payload,
        start_date,
        end_date,
        account_lookup,
        account_class_lookup,
    )
    payroll_rows = []
    if payroll_mode == "payrun" and payroll_payload:
        payroll_rows = flatten_payruns(payroll_payload, start_date, end_date)
    all_source_rows = bill_rows + invoice_rows + bank_rows + credit_rows + manual_journal_rows + journal_rows + payroll_rows
    all_rows = _filter_profit_loss_rows(all_source_rows, account_class_lookup)

    balance_sheet_start_date = date(1900, 1, 1)
    balance_sheet_manual_journal_rows = flatten_manual_journals(
        manual_journal_payload,
        balance_sheet_start_date,
        end_date,
        account_lookup,
        account_class_lookup,
        included_classes=BALANCE_SHEET_CLASSES,
    )
    balance_sheet_journal_rows = flatten_journals(
        journals_payload,
        balance_sheet_start_date,
        end_date,
        account_lookup,
        account_class_lookup,
        included_classes=BALANCE_SHEET_CLASSES,
        include_manual_journals=not balance_sheet_manual_journal_rows,
    )
    balance_sheet_explicit_rows = (
        flatten_invoices(bills_payload, "Bill", balance_sheet_start_date, end_date, account_lookup)
        + flatten_invoices(invoices_payload, "Invoice", balance_sheet_start_date, end_date, account_lookup)
        + flatten_bank_transactions(bank_payload, balance_sheet_start_date, end_date, account_lookup)
        + flatten_credit_notes(credit_payload, balance_sheet_start_date, end_date, account_lookup)
        + balance_sheet_manual_journal_rows
        + balance_sheet_journal_rows
    )
    balance_sheet_synthetic_rows = (
        flatten_invoice_balance_sheet_synthetic_rows(
            bills_payload,
            "Bill",
            balance_sheet_start_date,
            end_date,
            payable_account_code,
            gst_account_code,
            account_lookup,
            tax_sign=1.0,
        )
        + flatten_invoice_balance_sheet_synthetic_rows(
            invoices_payload,
            "Invoice",
            balance_sheet_start_date,
            end_date,
            receivable_account_code,
            gst_account_code,
            account_lookup,
            tax_sign=-1.0,
        )
        + flatten_bank_balance_sheet_synthetic_rows(
            bank_payload,
            balance_sheet_start_date,
            end_date,
            gst_account_code,
            account_lookup,
        )
        + flatten_credit_note_balance_sheet_synthetic_rows(
            credit_payload,
            balance_sheet_start_date,
            end_date,
            receivable_account_code,
            payable_account_code,
            gst_account_code,
            account_lookup,
        )
        + flatten_payments_balance_sheet_evidence_rows(
            payments_payload,
            balance_sheet_start_date,
            end_date,
            account_lookup,
        )
        + flatten_bank_transfers_balance_sheet_evidence_rows(
            bank_transfers_payload,
            balance_sheet_start_date,
            end_date,
            account_lookup,
        )
        + flatten_finance_balance_sheet_evidence_rows(
            finance_balance_sheet_payload,
            balance_sheet_date,
            account_lookup,
        )
    )
    balance_sheet_rows = _map_balance_sheet_rows(
        balance_sheet_explicit_rows + balance_sheet_synthetic_rows,
        account_meta_lookup,
        balance_sheet_account_map,
    )
    balance_sheet_df = pd.DataFrame(balance_sheet_rows)
    pl_net_profit = extract_xero_pl_net_profit(pl)
    balance_sheet_summary_df = _write_balance_sheet_outputs(
        balance_sheet_df,
        xero_balance_sheet_df,
        opening_balance_sheet_df=opening_balance_sheet_df,
        movement_start_date=start_date,
        movement_end_date=end_date,
        pl_net_profit=pl_net_profit,
    )

    print(f"Total P&L transaction lines to map: {len(all_rows)}")
    print(f"Total Balance Sheet detail lines: {len(balance_sheet_rows)}")
    _write_source_coverage_summary(
        report_from=report_from,
        report_to=report_to,
        payments_only=args.payments_only,
        source_counts={
            "bills": bill_counts,
            "invoices": invoice_counts,
            "bank_transactions": bank_counts,
            "credit_notes": credit_counts,
            "payments": payment_counts,
            "bank_transfers": bank_transfer_counts,
            "manual_journals": manual_journal_counts,
            "journals": journal_counts,
            "payroll_payruns": {
                "items": len(payroll_payload.get("PayRuns", []) if isinstance(payroll_payload, dict) else []),
                "lines": len(payroll_rows),
                "zero_lines": 0,
            },
        },
    )

    category_defs = prepare_category_lists()
    progress_path = OUTPUT_DIR / "progress.html"
    progress_json_path = OUTPUT_DIR / "progress.json"
    mapped_rows = _map_profit_loss_rows(
        all_rows,
        category_defs,
        worker_count=args.mapping_workers,
        request_timeout_seconds=args.ai_timeout,
        progress_path=progress_path,
        progress_json_path=progress_json_path,
        write_progress=not args.no_progress,
    )

    df = pd.DataFrame(mapped_rows)
    df = _apply_category_normalization(df, category_defs["allowed_names"])
    _write_wages_reconciliation_debug(df)
    detail_path = OUTPUT_DIR / "pl_mapping_report.xlsx"
    summary_path = OUTPUT_DIR / "pl_mapping_summary.xlsx"

    print(f"Writing detailed mapping report to {detail_path} ...")
    df.to_excel(detail_path, index=False)

    summary = pd.DataFrame(columns=["MappedCategory", "Amount"])
    if not df.empty:
        summary = (
            df.groupby("MappedCategory")["Amount"]
            .sum()
            .sort_values(ascending=False)
            .reset_index()
        )
        print(f"Writing summary report to {summary_path} ...")
        summary.to_excel(summary_path, index=False)
    else:
        print("No transaction lines found; summary report will not be created.")

    # Xero P&L comparison (original vs AI-mapped)
    xero_pl_df = extract_xero_pl_lines(pl)
    xero_pl_path = OUTPUT_DIR / "xero_pl_lines.csv"
    if not xero_pl_df.empty:
        xero_pl_df.to_csv(xero_pl_path, index=False)

        ai_pl_df = summary.rename(columns={"MappedCategory": "Category", "Amount": "AI_Amount"})
        comparison = xero_pl_df.rename(columns={"Amount": "Xero_Amount"}).merge(
            ai_pl_df,
            on="Category",
            how="outer",
        )
        comparison["Xero_Amount"] = comparison["Xero_Amount"].fillna(0.0)
        comparison["AI_Amount"] = comparison["AI_Amount"].fillna(0.0)
        comparison["Difference"] = comparison["AI_Amount"] - comparison["Xero_Amount"]
        comparison = comparison.sort_values("Category")

        comparison_csv = OUTPUT_DIR / "xero_vs_ai_diff.csv"
        comparison_xlsx = OUTPUT_DIR / "xero_vs_ai_diff.xlsx"
        comparison.to_csv(comparison_csv, index=False)
        comparison.to_excel(comparison_xlsx, index=False)
        _write_xero_ai_diff_debug_outputs(df, xero_pl_df, comparison)
        print(
            "Wrote line-by-line diff debug files: "
            "xero_vs_ai_line_debug.xlsx / xero_vs_ai_suspicious_lines.xlsx / xero_vs_ai_debug_summary.json"
        )

    # Split income vs expense outputs
    if not df.empty:
        account_code_series = df.get("AccountCode", "").fillna("").astype(str).str.strip()
        mapped_category_series = df.get("MappedCategory", "").fillna("")

        is_income = account_code_series.str.startswith("2") | mapped_category_series.isin(
            category_defs["income_names"]
        )
        income_df = df[is_income].copy()
        expense_df = df[~is_income].copy()

        income_detail_path = OUTPUT_DIR / "income_mapping_report.xlsx"
        expense_detail_path = OUTPUT_DIR / "expense_mapping_report.xlsx"
        print(f"Writing income detail report to {income_detail_path} ...")
        income_df.to_excel(income_detail_path, index=False)
        print(f"Writing expense detail report to {expense_detail_path} ...")
        expense_df.to_excel(expense_detail_path, index=False)

        income_summary = (
            income_df.groupby("MappedCategory")["Amount"]
            .sum()
            .sort_values(ascending=False)
            .reset_index()
        )
        expense_summary = (
            expense_df.groupby("MappedCategory")["Amount"]
            .sum()
            .sort_values(ascending=False)
            .reset_index()
        )

        income_summary_path = OUTPUT_DIR / "profit_summary.csv"
        expense_summary_path = OUTPUT_DIR / "loss_summary.csv"
        income_summary.to_csv(income_summary_path, index=False)
        expense_summary.to_csv(expense_summary_path, index=False)

        income_total = float(income_df["Amount"].sum())
        expense_total = float(expense_df["Amount"].sum())
        total_summary = pd.DataFrame(
            [
                {"Metric": "Total Income", "Amount": income_total},
                {"Metric": "Total Expense", "Amount": expense_total},
                {"Metric": "Net Profit/Loss", "Amount": income_total - expense_total},
            ]
        )
        total_summary_path_csv = OUTPUT_DIR / "total_summary.csv"
        total_summary_path_xlsx = OUTPUT_DIR / "total_summary.xlsx"
        total_summary.to_csv(total_summary_path_csv, index=False)
        total_summary.to_excel(total_summary_path_xlsx, index=False)

    # Payroll summary export (if payruns available)
    if payroll_mode == "payrun" and payroll_payload.get("PayRuns"):
        payroll_rows_summary: List[Dict[str, Any]] = []
        for pr in payroll_payload.get("PayRuns", []):
            pay_date_raw = pr.get("PaymentDate") or pr.get("PayRunPeriodEndDate") or pr.get("PayPeriodEndDate")
            pay_date_str, pay_date_obj = _normalize_xero_date(pay_date_raw)
            if not _in_date_range(pay_date_obj, start_date, end_date):
                continue
            payroll_rows_summary.append(
                {
                    "PayRunID": pr.get("PayRunID") or pr.get("PayRunId"),
                    "PaymentDate": pay_date_str or pay_date_raw,
                    "PeriodStart": pr.get("PayRunPeriodStartDate") or pr.get("PayPeriodStartDate"),
                    "PeriodEnd": pr.get("PayRunPeriodEndDate") or pr.get("PayPeriodEndDate"),
                    "Wages": pr.get("Wages"),
                    "Deductions": pr.get("Deductions"),
                    "Tax": pr.get("Tax"),
                    "Super": pr.get("Super"),
                    "Reimbursement": pr.get("Reimbursement"),
                    "NetPay": pr.get("NetPay"),
                }
            )

        if payroll_rows_summary:
            payroll_summary_df = pd.DataFrame(payroll_rows_summary)
            payroll_csv = OUTPUT_DIR / "payroll_summary.csv"
            payroll_xlsx = OUTPUT_DIR / "payroll_summary.xlsx"
            payroll_summary_df.to_csv(payroll_csv, index=False)
            payroll_summary_df.to_excel(payroll_xlsx, index=False)

    if not df.empty:
        html_path = OUTPUT_DIR / "report.html"
        assistant_path = OUTPUT_DIR / "report_assistant.html"
        print(f"Writing visualization report to {html_path} ...")
        _write_html_report(
            df,
            html_path,
            category_defs["income_names"],
            category_defs["allowed_names"],
            payroll_summary=payroll_summary_df,
            payroll_mode=payroll_mode,
            report_from=report_from,
            report_to=report_to,
            balance_sheet_date=balance_sheet_date,
            balance_sheet_detail=balance_sheet_df,
            balance_sheet_summary=balance_sheet_summary_df,
        )
        print(f"Writing natural-language assistant page to {assistant_path} ...")
        _write_report_assistant_html(assistant_path)
    else:
        print("No mapped rows; skipping HTML report.")

    print("Done.")


if __name__ == "__main__":
    main()
