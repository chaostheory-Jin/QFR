# Invoice API Reproduction Record (2026-10-01)

Document status reviewed: **2026-10-15T11:11:41+11:00 (AEDT)**, baseline `ec60f88`.
The content below preserves the **2026-10-01 experiment record**. Test counts,
model results and the execution path describe that version, not a new run,
current deployment or guaranteed accuracy on new samples.
The record later entered Git in `83865fe` (2026-10-02T09:32:28+10:00);
“no Git commit or push” below refers only to actions at the time of the experiment.
See the [timestamped technical report](technical-progress-2026-10-15.md) for later
browser persistence, candidate review and Payroll changes. No paid API retest
was performed for this documentation update. English translation: **2026-10-15**;
historical measurements and limitations are unchanged.

## Clarifying the Acceptance Criteria

“Nine of ten are complete” means nine scans contain a final total, not that nine
IDs and amounts were already correctly extracted. The earlier visual transcription
was not independently verified ground truth. Enlarged inspection revealed doubts
about some dot-matrix characters and transcribed values. Those old values were
retained rather than changed to model output to improve a score. Comparisons are
called “agreement with the visual baseline,” not established ID accuracy.

## Why Whole-Page Calls Differ from Field-by-Field Inspection

- The old API defaulted to `gpt-5.6-luna` with only a full-page `detail: high`
  image, while visual inspection used magnified crops. Small text, sparse dot-matrix
  characters, horizontal rules and highlighting made reading harder. The image
  documentation referenced during that work discusses enlarging small text and
  differing resolution handling for `original` and `high`:
  [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision).
- The page previously resized images over 900 KB to a maximum edge of 2200 and
  encoded JPEG at quality 0.84. All ten originals, approximately 1.4–1.7 MB each,
  triggered this processing. The benchmark directly uploaded originals, so
  browser compression was an additional risk, not the sole explanation for
  direct-API failures.
- Switching to a larger model alone was insufficient. With the same five-view
  input, Luna, Sol and Astra read the amounts of two difficult samples correctly
  but none matched the old ID transcription. Tighter ID crops and single-field
  reads improved results, yet highlighted/ruled-over IDs remained uncertain.
- The earlier safety review blocked outbound sensitive financial images; it did
  not demonstrate that the API lacked recognition capability. After explicit
  user authorization, real requests for all 13 images returned successfully.

## Execution Path at the Time of the Experiment

1. The browser batches original bytes without lossy resizing and explicitly
   rejects uploads beyond hosting limits.
2. The server retains the full page, corrects orientation and bounds oversized
   dimensions. Portrait documents receive original-colour/channel-enhanced header,
   tight ID-strip, labelled-total and four-times-enlarged amount-digit regions.
   Coordinates depend on page geometry, not filenames or preset answers.
   The full page plus four regions produce nine views; independent total reading
   receives only total-related views.
3. Defaults are `gpt-6-astra`, high reasoning and `detail: original`; the full
   page establishes document type and currency.
4. The portrait invoice total is read separately without the first full-page
   guess, human baseline, statement or candidates. New field readings are exposed
   only after printed-string, final-amount-label, net-plus-tax and available local
   OCR checks pass. First readings, rereads, response IDs and conflicts remain recorded.
5. Unequal readings or reread failure keep the amount under review. Calculated
   net plus tax is not substituted for printed text.
6. ID verification requires agreement with independent, non-weak local OCR
   (threshold 0.85). This is not “85% accuracy.” Two equal strings from one model
   show self-consistency, not independent proof.
7. The statement remains locally parsed, is not included in field rereading,
   and cannot overwrite extracted fields.

Rereading has a 45-second limit within the overall 110-second request budget.
Failure retains the first result for human review. More image tokens and requests
make this path slower and more costly than the earlier lightweight whole-page read.

## Preserved Test Evidence

| Run directory | Total agreement with visual baseline | Notes |
| --- | ---: | --- |
| `live-2026-09-30T23-17-30-279Z` | 5/9 | Earlier lightweight model, full-page high |
| `live-2026-09-30T23-41-46-726Z` | 9/9 | Seven original-image views; all 13 images HTTP 200 |
| `live-2026-09-30T23-48-06-428Z` | 8/9 | One rerun error; incorrect net and total remained arithmetically consistent |
| `live-2026-09-30T23-52-36-177Z` | 9/9 | Another rerun; IDs remained under review |
| `live-2026-09-30T23-58-05-587Z` | 8/9 | Independent total reading still varied on one digit; stable 9/9 cannot be claimed |
| `amount-replay-2026-09-30T23-58-01-682Z` | Erroneous sample reread | Independently read 23264888 from the original; initial error 23264688 retained, conflict not automatically verified |
| `amount-replay-2026-10-01T00-02-57-517Z` | Tight amount-region reread | Four-times-enlarged digits again yielded 23264888; differing first reading retained |
| `live-2026-10-01T00-05-04-523Z` | 9/9 | Final nine-view path plus independent total read; 13 images HTTP 200, 4 IDs agreed with old transcription, all 10 scans retained for review |

Directories are under `output/reconciliation/`, with UTC timestamps. They record
real requests, not a demo returning cached baseline answers. A separate final-path
acceptance report accompanies the recorded experiment. One 9/9 run does not
guarantee 9/9 on every request. Some earlier report field names contain `Correct`;
their meaning is still agreement with the original visual transcription. The
test entry point renamed such statistics `AgreeWithVisualBaseline`. Historical
field names must not be interpreted as authoritative accuracy.

The final full run took 321 seconds at concurrency 2; individual scans took about
46–80 seconds. The scan without a total retained 0 and a status requiring review.
The separate AUD invoice screenshot yielded ORC1009 / 550; the two non-invoice
screenshots were classified as unknown.

Verification at that time: 85 ordinary frontend tests passed (two paid entry
points skipped by default), the live full test and independent amount-reread
replay passed, and lint, TypeScript and the production build passed. Full-test
success validated requests, evidence preservation and non-mutation by matching;
it did not establish correctness of every extracted field. No Git commit or push
was performed during that experiment.

## Reproduction Entry Points

After obtaining explicit authorization for outbound financial images, start the
service with a valid project API key; the default port is 3107. From `frontend`:

```sh
QFR_RUN_LIVE=1 npm test -- src/lib/reconciliation-live.test.ts
```

Use `QFR_LIVE_FILES` with comma-separated basenames to test a subset. File counts,
source-byte SHA-256 hashes, responses, fields, matches and timings are retained.
Ordinary tests skip paid entry points.

To independently reread a previously recorded error:

```sh
QFR_REREAD_LIVE=1 QFR_REREAD_AUDIT=/absolute/path/to/recorded-response.json npm test -- src/lib/invoice-amount-reread-live.test.ts
```

The reread uploads only total-region imagery from the invoice matching the recorded
hash. The first reading, baseline and statement are not sent. Additionally,
`scripts/probe-invoice-id.mjs` reads ID crops separately, permits `?` for uncertain
characters and does not silently rewrite the main extraction.

Final acceptance still requires an independently confirmed electronic-invoice
field list or clearer originals. Achieving “nine completely correct invoices”
must not involve feeding statement candidates into the model, changing the old
baseline or removing uncertainty checks.
