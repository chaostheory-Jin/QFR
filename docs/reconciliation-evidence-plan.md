# Reconciliation Evidence Controls and Follow-up Plan

Status reviewed: **2026-10-15T11:11:41+11:00 (AEDT)**, code baseline `ec60f88`.
Evidence isolation and global matching in Phases 1 and 3 are implemented.
Phase 2 now includes demo-level persistent human review, but trusted user identity,
server-side role authorization and cloud audit storage remain unimplemented.
Key commits: `83865fe` (2026-10-02T09:32:28+10:00, evidence/review controls),
`b88b669` (2026-10-06T13:51:39+11:00, browser storage), and
`6dacc65` (2026-10-08T16:37:24+11:00, candidates/restoration).
These are commit times, not deployment times. See the
[technical progress report](technical-progress-2026-10-15.md).
English translation: **2026-10-15**; the review baseline is unchanged.

The 2026-10-01 API reproduction work preserved original uploads, added original-colour
and enhanced crops, and independently read the total region. A model repeating its
own ID is no longer treated as independent verification. Missing, weak or conflicting
local OCR requires human review. Conflicting amount readings cannot be automatically
verified even when each is arithmetically self-consistent. See the
[API reproduction record](reconciliation-api-reproduction.md) for methods and limitations.

## Risks Confirmed Before the Fix

In `frontend/src/app/api/reconciliation/route.ts`,
`recoverAgainstFullStatement` previously found nearby-amount candidates in the
same statement and directly overwrote invoice IDs and amounts. `verifyInvoice`
allowed `recoveredFromStatementLine` to bypass printed-amount and net-plus-tax
checks. `frontend/src/lib/reconciliation.ts` then matched those modified fields
against the same statement. Equality after this substitution was not independent
evidence that the original invoice amount was correct.

Runtime `validateExtraction` also checked only objects, arrays and counts before
sorting and rewriting `documentIndex`. Duplicate/out-of-range indices could be
hidden, and field types/amounts were not fully validated. Greedy invoice-by-invoice
matching could let an earlier weak match occupy a later invoice's exact target.

## Phase 1 (Implemented): Preserve Differences

1. Preserve original extraction: file hashes, printed text, extracted IDs/amounts,
   pages and OCR locations. Statement candidates belong separately in
   `matchCandidates`, never overwriting invoice fields. Traceable whitespace/
   punctuation normalization is allowed; candidate IDs/amounts are not source text.
2. Verify fields independently of the statement. IDs must agree with normalized
   invoice text, not merely be two nonempty strings. Amounts must agree with the
   printed final payable. Check net plus tax when both exist; successful recovery
   must not bypass arithmetic. Ambiguous, missing or conflicting evidence requires review.
3. Exact IDs with unequal amounts produce `amount_mismatch`, preserving both
   values and the difference. A unique amount alone or fuzzy ID supports a
   candidate, not an automatic reconciliation claim.
4. Validate every field, string length, finite number and nullable value at runtime.
   `documentIndex` must be an in-range integer, unique and collectively cover all
   uploaded files. Bind server filenames to validated original indices; do not
   sort and renumber.
5. Use decimal/minor-unit arithmetic with explicit currency and direction policies.
   Do not universally take absolute values: invoices, credits and refunds have
   different direction rules. Tolerances follow currency/business policy, and
   the UI currency is no longer fixed to UGX.

Keep `verified_match`, `amount_mismatch`, `needs_review`, `unmatched` and
`invalid_extraction` conceptually distinct. Heuristic match scores must not be
presented as calibrated correctness probabilities.

## Phase 2: Persistent Demo Review Implemented; Trusted Identity Still Required

Unclear fields can trigger a separate OCR/region reread that sees only the invoice,
not statement targets or instructions to produce a preferred candidate. Retain both
readings and conflict reasons rather than silently choosing the closer statement
value. If independent confirmation is unavailable, a human must inspect the original.

Human decisions are separate browser audit records containing original extraction,
revised fields, selected statement line, reason, time and self-declared reviewer/role.
Human confirmation is not labelled automatic verification. Stable IDs, original-file
hashes and same-transaction revision checks protect evidence binding and concurrent
writes. Original extraction and historical decisions remain separate. Material
variances have a demo manager-role gate, but self-declared roles are not production
authorization. Trusted identity, server role checks and tamper-proof audit remain
future work.

Candidate search covers all statement lines, not only current filtered rows.
It lists up to five supported alternatives without adding irrelevant fillers.
Selection locates/highlights the corresponding right-hand line; saving still
requires explicit confirmation, a reason and field-consistency checks. Unresolved
differences remain differences: source evidence is not rewritten to reach
“100% matching.” Records belong only to the current browser and site origin;
clearing data, changing domains or switching devices does not automatically
restore them. Export beforehand.

## Phase 3 (Implemented): Upload-Order-Independent Matching

Construct all candidate relationships before processing globally unique exact
ID-plus-amount matches. Preserve amount differences for identical IDs. Handle
OCR/fuzzy candidates after reserving exact relationships, so weak candidates
cannot take exact targets. Many-to-one, one-to-many and duplicate invoices require
explicit review rather than forced one-to-one allocation. Reordering uploads
must not change automatic reconciliation conclusions.

## Regression Cases

- Different invoice/statement amounts within the former recovery tolerance still show a difference.
- Conflicting OCR text, printed totals or net-plus-tax evidence cannot automatically match.
- Duplicate, missing, negative, out-of-range or fractional indices are rejected without misbinding files.
- String amounts, non-finite values, invalid nullable fields and empty IDs are rejected or explicitly reviewed.
- Same-amount alternatives, duplicate invoices, credit direction and currency differences cannot cause false automatic matches.
- Placing a weak candidate before an exact invoice does not change the result after reordering.
- Saved human revisions reload with original evidence and historical decisions still available.

Local regression tests cover evidence validation, candidate review, browser
persistence and revision conflicts. They do not establish trusted identity or
correct recognition of arbitrary scans. Audit JSON preserves invoice fields,
upload hashes, model/OCR evidence, candidate lines and differences. Heuristic
scores are not described as correctness probabilities. Strict JSON Schema is
supplemented by independent runtime field/index checks.

## Full Original-Scan Testing

`Cola_Reconciliation/invoice-ground-truth.json` is a visual transcription baseline
from original images, not answers derived from the statement. Nine of ten scans
contain a visible final total; `20260805114055_005.jpg` does not capture it.
`invoices/` also contains one invoice screenshot and two non-invoice screenshots;
these are tested separately, not included in UGX reconciliation statistics.

Default unit tests do not call paid APIs. The explicit full-test entry point is
`QFR_RUN_LIVE=1 npm test -- src/lib/reconciliation-live.test.ts` from `frontend`.
First start a local service with an existing API key, by default at
`http://127.0.0.1:3107`; override using `QFR_TEST_BASE_URL`. Statements are
parsed locally, while the model receives only invoices/screenshots.
Responses, timings, errors, visual-baseline comparisons and global match results
are saved to `output/reconciliation/live-<timestamp>/report.md` and `report.json`;
default concurrency is 2. Obtain explicit user consent before sending sensitive
financial images outside the local environment.

Recognition agreement and automatic match rate are separate measurements.
A missing total is not complete extraction; same amounts and approximate IDs
are candidates only. The AUD invoice has no corresponding AUD statement, so
only extraction is tested. Sample results do not guarantee future performance.
The permissive unique-amount matching in legacy `Cola_Reconciliation/reconcile.py`
is not evidence of this implementation's accuracy or automatic verification.
