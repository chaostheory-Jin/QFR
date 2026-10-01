/** Opt-in replay of a recorded failed first extraction; only original invoice pixels leave the machine. */
import { it, expect } from 'vitest'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { prepareInvoiceImage } from './invoice-image-views'
import { AMOUNT_READ_PROMPT, AMOUNT_READ_SCHEMA, applyAmountReread } from './invoice-amount-reread'
import type { InvoiceExtraction } from './reconciliation'

it.skipIf(process.env.QFR_REREAD_LIVE !== '1')('replays a failed primary reading with independent invoice-only amount evidence', async () => {
  const root = resolve(process.cwd(), '..')
  process.loadEnvFile(resolve(root, '.env'))
  const fixture = process.env.QFR_REREAD_AUDIT
  if (!fixture) throw new Error('Provide QFR_REREAD_AUDIT pointing to the recorded API response.')
  const payload = JSON.parse(await readFile(fixture, 'utf8'))
  const original: InvoiceExtraction = payload.invoiceDocuments[0]
  if (!/^\d{14}_\d{3}\.jpg$/.test(original.fileName)) throw new Error('Expected a Coca-Cola scan filename.')
  const bytes = await readFile(resolve(root, 'Cola_Reconciliation', original.fileName))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(original.sourceHash)
  const prepared = await prepareInvoiceImage(bytes)
  const parts = prepared.parts.flatMap((part, index) => part.type === 'input_text' && part.text.startsWith('Printed totals region')
    ? [part, prepared.parts[index + 1]] : [])
  const model = process.env.OPENAI_RECONCILIATION_MODEL || 'gpt-6-astra'
  const effort = process.env.OPENAI_RECONCILIATION_REASONING_EFFORT || 'high'
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY_QFR || process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, store: false, reasoning: { effort }, max_output_tokens: 4_000,
      input: [{ role: 'user', content: [{ type: 'input_text', text: AMOUNT_READ_PROMPT }, ...parts] }],
      text: { format: { type: 'json_schema', name: 'invoice_totals_reread', strict: true, schema: AMOUNT_READ_SCHEMA } },
    }), signal: AbortSignal.timeout(45_000),
  })
  const provider = await response.json()
  const text = provider.output?.flatMap((item: { content?: Array<{ type: string; text?: string }> }) => item.content ?? [])
    .find((item: { type: string }) => item.type === 'output_text')?.text
  const reread = response.ok && text ? applyAmountReread(original, JSON.parse(text)) : null
  const directory = resolve(root, 'output/reconciliation', `amount-replay-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'report.json'), JSON.stringify({ status: response.status, model, effort,
    sourceHash: original.sourceHash, original, provider, reread }, null, 2))
  console.log('AMOUNT_REPLAY', directory, 'before', original.totalAmount, 'after', reread?.totalAmount)
  expect(response.ok).toBe(true)
  expect(reread?.amountReread?.accepted).toBe(true)
  // Comparison only AFTER the request; this expected value is never model input.
  const baseline = JSON.parse(await readFile(resolve(root, 'Cola_Reconciliation/invoice-ground-truth.json'), 'utf8'))
  const expected = baseline.documents.find((document: { file: string }) => document.file === `Cola_Reconciliation/${original.fileName}`)
  expect(reread?.totalAmount).toBe(expected.totalAmount)
}, 60_000)
