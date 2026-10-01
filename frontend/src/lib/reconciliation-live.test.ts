/** Opt-in paid integration benchmark. Never runs in the normal unit suite. */
import { it, expect } from 'vitest'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { reconcileInvoices, normaliseInvoiceNumber, type InvoiceExtraction, type StatementRecord } from './reconciliation'

type Truth = { file: string; invoiceNumber: string | null; totalAmount: number | null; currency: string; nonInvoice?: boolean; note?: string }
type Result = { file: string; httpStatus: number; seconds: number; error?: string; invoice?: InvoiceExtraction; idCorrect?: boolean; amountCorrect?: boolean; bothCorrect?: boolean; missingAmountSafelyRejected?: boolean; nonInvoiceSafelyRejected?: boolean }

it.skipIf(process.env.QFR_RUN_LIVE !== '1')('recognises every original invoice and retains all evidence', async () => {
  const root = resolve(process.cwd(), '..')
  const truth = JSON.parse(await readFile(resolve(root, 'Cola_Reconciliation/invoice-ground-truth.json'), 'utf8')) as { basis: string; documents: Truth[] }
  const inventory = (await Promise.all(['Cola_Reconciliation', 'invoices'].map(async directory =>
    (await readdir(resolve(root, directory))).filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file)).sort().map(file => `${directory}/${file}`)))).flat()
  expect(new Set(inventory)).toEqual(new Set(truth.documents.map(item => item.file)))
  const selected = process.env.QFR_LIVE_FILES?.split(',').map(file => file.trim()).filter(Boolean)
  const files = selected ? inventory.filter(file => selected.includes(basename(file))) : inventory
  if (selected) expect(files).toHaveLength(selected.length)
  const output = resolve(root, 'output/reconciliation', `live-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(output, { recursive: true })
  const statement = await readFile(resolve(root, 'Cola_Reconciliation/UTUKUFU LTD SEMUTO statement Jan 2024 to 30th April 2026.pdf'))
  const results: Result[] = []
  let records: StatementRecord[] = []
  const colaInvoices: InvoiceExtraction[] = []
  let cursor = 0
  async function worker() {
    while (cursor < files.length) {
      const index = cursor++
      const file = files[index]
      const expected = truth.documents.find(item => item.file === file)!
      const bytes = await readFile(resolve(root, file))
      const form = new FormData()
      form.append('statement', new File([statement], 'statement.pdf', { type: 'application/pdf' }))
      form.append('statementCurrency', file.startsWith('Cola_Reconciliation/') ? 'UGX' : 'AUD')
      form.append('invoices', new File([bytes], basename(file), { type: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg' }))
      const started = Date.now()
      try {
        const response = await fetch(`${process.env.QFR_TEST_BASE_URL ?? 'http://127.0.0.1:3107'}/api/reconciliation`, {
          method: 'POST', body: form, headers: { cookie: 'qfr_auth=1' }, signal: AbortSignal.timeout(150_000),
        })
        const payload = await response.json()
        await writeFile(resolve(output, `${basename(file)}.json`), JSON.stringify(payload, null, 2))
        const result: Result = { file, httpStatus: response.status, seconds: Math.round((Date.now() - started) / 100) / 10 }
        if (!response.ok) result.error = payload.error ?? 'Extraction failed'
        else {
          const invoice: InvoiceExtraction = payload.invoiceDocuments[0]
          expect(invoice.documentIndex).toBe(0)
          expect(invoice.fileName).toBe(basename(file))
          expect(invoice.sourceHash).toBe(createHash('sha256').update(bytes).digest('hex'))
          result.invoice = invoice
          if (expected.nonInvoice) result.nonInvoiceSafelyRejected = invoice.documentType === 'unknown' && !invoice.invoiceNumber && !invoice.fieldVerification?.invoiceNumberVerified
          else {
            result.idCorrect = normaliseInvoiceNumber(invoice.invoiceNumber) === normaliseInvoiceNumber(expected.invoiceNumber!)
            if (expected.totalAmount !== null) {
              result.amountCorrect = invoice.totalAmount === expected.totalAmount && invoice.currency === expected.currency
              result.bothCorrect = result.idCorrect && result.amountCorrect
            } else result.missingAmountSafelyRejected = invoice.totalAmount === 0 && !invoice.fieldVerification?.totalAmountVerified
          }
          if (file.startsWith('Cola_Reconciliation/')) {
            records = payload.statementRecords
            colaInvoices.push({ ...invoice, documentIndex: index })
          }
        }
        results.push(result)
        console.log(`${file}: HTTP ${response.status}, ID ${result.idCorrect ?? 'n/a'}, amount ${result.amountCorrect ?? 'n/a'} (${result.seconds}s)${result.error ? ': ' + result.error : ''}`)
      } catch (error) {
        results.push({ file, httpStatus: 0, seconds: Math.round((Date.now() - started) / 100) / 10, error: error instanceof Error ? error.message : String(error) })
      }
      await writeFile(resolve(output, 'checkpoint.json'), JSON.stringify(results, null, 2))
    }
  }
  // Small concurrency bound; no test-time statement-based field correction.
  await Promise.all([worker(), worker()])
  results.sort((a, b) => a.file.localeCompare(b.file))
  colaInvoices.sort((a, b) => a.documentIndex - b.documentIndex)
  const before = JSON.stringify(colaInvoices)
  const matches = reconcileInvoices(colaInvoices, records, { currency: 'UGX' })
  expect(JSON.stringify(colaInvoices)).toBe(before)
  const sortedDecisions = (items: typeof matches) => items.map(match => ({ file: match.invoice.fileName, status: match.status, line: match.statementRecord?.lineIndex })).sort((a,b) => a.file.localeCompare(b.file))
  expect(sortedDecisions(reconcileInvoices([...colaInvoices].reverse(), records, { currency: 'UGX' }))).toEqual(sortedDecisions(matches))
  const cola = results.filter(result => result.file.startsWith('Cola_Reconciliation/'))
  const summary = {
    attemptedImages: files.length, successfulAPIResponses: results.filter(result => result.invoice).length,
    apiErrors: results.filter(result => result.error).length,
    colaInvoices: cola.length, colaReadableFullInvoices: cola.filter(result => truth.documents.find(item => item.file === result.file)?.totalAmount !== null).length,
    colaIDsAgreeWithVisualBaseline: cola.filter(result => result.idCorrect).length,
    colaGrossAmountsAgreeWithVisualBaseline: cola.filter(result => result.amountCorrect).length,
    colaBothFieldsAgreeWithVisualBaseline: cola.filter(result => result.bothCorrect).length,
    colaMissingTotalSafelyRejected: cola.filter(result => result.missingAmountSafelyRejected).length,
    colaAutomaticMatches: matches.filter(match => match.matched).length,
    colaReview: matches.filter(match => !match.matched).length,
    extraInvoiceBothCorrect: results.filter(result => result.file.startsWith('invoices/') && result.bothCorrect).length,
    nonInvoicesSafelyRejected: results.filter(result => result.nonInvoiceSafelyRejected).length,
    statementRows: records.length,
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ createdAt: new Date().toISOString(), basis: truth.basis, summary, results, matches, statementRecords: records }, null, 2))
  const table = results.map(result => {
    const expected = truth.documents.find(item => item.file === result.file)!
    const match = matches.find(item => item.invoice.fileName === basename(result.file))
    return `| ${result.file} | ${expected.invoiceNumber ?? 'Not invoice'} | ${expected.totalAmount ?? 'Missing / n/a'} | ${result.invoice?.invoiceNumber ?? '—'} | ${result.invoice?.totalAmount ?? '—'} | ${result.bothCorrect ?? result.missingAmountSafelyRejected ?? result.nonInvoiceSafelyRejected ?? false} | ${match?.status ?? 'Extraction only'} | ${result.seconds} | ${result.error ?? expected.note ?? ''} |`
  }).join('\n')
  await writeFile(resolve(output, 'report.md'), `# Invoice recognition benchmark\n\n${truth.basis}\n\nVisual transcriptions are a comparison baseline, not independently verified ground truth. Faint characters (including gross digits) require source review. Agreement counts are not established extraction accuracy. Baseline disagreements must be reviewed against source pixels / authoritative invoice records, never corrected from the statement or model answer.\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\n| File | Visual baseline ID | Visual gross | Extracted ID | Extracted gross | Baseline agreement / safe rejection | Match status | Seconds | Note |\n|---|---|---:|---|---:|---|---|---:|---|\n${table}\n\nOnly Coca-Cola invoices were reconciled. The AUD screenshot has no corresponding supplied AUD statement. API payloads and source hashes are preserved alongside this report. Heuristic candidates do not count as verified matches.\n`)
  console.log('REPORT', output, JSON.stringify(summary))
  expect(results).toHaveLength(files.length)
  expect(results.filter(result => result.error)).toHaveLength(0)
}, 600_000)
