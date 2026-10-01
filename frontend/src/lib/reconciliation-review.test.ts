import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { digest } from './durable-store'
import { archiveRunFile, createRun, loadRun, saveDecision } from './reconciliation-review-store'
import { reviewedResults, validateRunInput, type ReviewDecision } from './reconciliation-review'
import type { InvoiceExtraction } from './reconciliation'
let directory: string
const previous = process.env.QFR_DATA_STORE_DIR
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'qfr-reconcile-test-')); process.env.QFR_DATA_STORE_DIR = directory })
afterEach(async () => { if (previous === undefined) delete process.env.QFR_DATA_STORE_DIR; else process.env.QFR_DATA_STORE_DIR = previous; await rm(directory, { recursive: true, force: true }) })
const invoice: InvoiceExtraction = { documentIndex: 0, fileName: 'mock.jpg', invoiceNumber: 'INV1', totalAmount: 112, currency: 'AUD', documentType: 'invoice',
  invoiceNumberBox: [0, 0, 0, 0], totalAmountBox: [0, 0, 0, 0], fieldVerification: { invoiceNumberVerified: true, totalAmountVerified: true, arithmeticVerified: false, reason: 'Mock fixture' } }
const input = { sample: true, currency: 'AUD', materiality: 100, invoices: [invoice], statements: [{ invoiceNumber: 'INV1', amount: 110, description: 'Sales invoice' }], files: [] }
const decision: ReviewDecision = { invoiceIndex: 0, invoiceNumber: 'INV1', amount: 112, currency: 'AUD', documentType: 'invoice', statementIndex: 0, action: 'approve', reason: 'Mock fields checked independently against the source.', reviewer: 'Mock finance reviewer', role: 'finance' }
describe('reconciliation human review', () => {
  it('requires valid amounts, indices, boxes, currency and original manifest', () => {
    expect(() => validateRunInput({ ...input, materiality: -1 })).toThrow('threshold')
    expect(() => validateRunInput({ ...input, invoices: [{ ...invoice, documentIndex: 2 }] })).toThrow('index')
    expect(() => validateRunInput({ ...input, statements: [{ invoiceNumber: 'INV1', amount: '112' }] })).toThrow('fields')
    expect(() => validateRunInput({ ...input, invoices: [{ ...invoice, invoiceNumberBox: [5, 5, 1, 1] }] })).toThrow('box')
    expect(() => validateRunInput({ ...input, sample: false })).toThrow('Archive')
  })
  it('preserves raw amount, keeps variance, gates finance approval and saves history across reload', async () => {
    const run = await createRun(input)
    const reviewed = await saveDecision(run.id, decision, 0)
    expect(reviewed.reviews['0']).toMatchObject({ status: 'needs_manager', difference: 2 })
    expect(reviewed.invoices[0].totalAmount).toBe(112)
    const approved = await saveDecision(run.id, { ...decision, role: 'manager', reviewer: 'Mock manager' }, 1)
    expect(reviewedResults(approved)[0]).toMatchObject({ status: 'approved_variance', matched: false, difference: 2 })
    const reloaded = await loadRun(run.id)
    expect(reloaded.history).toHaveLength(2)
    expect(reloaded.history[1].before?.status).toBe('needs_manager')
  })
  it('threshold equality triggers manager even for exact verified match and high confidence', async () => {
    const run = await createRun({ ...input, materiality: 112, statements: [{ invoiceNumber: 'INV1', amount: 112 }] })
    expect(reviewedResults(run)[0]).toMatchObject({ status: 'needs_manager', matched: false })
    const saved = await saveDecision(run.id, decision, 0)
    expect(saved.reviews['0'].status).toBe('needs_manager')
    const approved = await saveDecision(run.id, { ...decision, role: 'manager' }, 1)
    expect(reviewedResults(approved)[0].matched).toBe(true)
  })
  it('human corrections never replace original extraction', async () => {
    const run = await createRun({ ...input, materiality: 1000 })
    const saved = await saveDecision(run.id, { ...decision, amount: 110 }, 0)
    expect(saved.invoices[0].totalAmount).toBe(112)
    expect(saved.reviews['0'].amount).toBe(110)
    expect(reviewedResults(saved)[0].matched).toBe(true)
  })
  it('rejects stale writes and blank audit fields', async () => {
    const run = await createRun(input)
    await expect(saveDecision(run.id, { ...decision, reason: '' }, 0)).rejects.toThrow('reason')
    await saveDecision(run.id, decision, 0)
    await expect(saveDecision(run.id, decision, 0)).rejects.toThrow('elsewhere')
  })
  it('can reject illegible documents without inventing a missing invoice ID or amount', async () => {
    const run = await createRun({ ...input, invoices: [{ ...invoice, invoiceNumber: '', totalAmount: 0, currency: 'UNKNOWN', documentType: 'unknown' }] })
    const rejected = await saveDecision(run.id, { ...decision, invoiceNumber: '', amount: 0, action: 'reject', statementIndex: null, reason: 'Mock document is unreadable; reject without fabricated fields.' }, 0)
    expect(reviewedResults(rejected)[0]).toMatchObject({ status: 'rejected', matched: false })
    expect(rejected.invoices[0].invoiceNumber).toBe('')
  })
  it('a different ID with equal amount remains a variance; rejection clears assignment', async () => {
    const run = await createRun({ ...input, materiality: 1000, statements: [{ invoiceNumber: 'OTHER', amount: 112 }] })
    const saved = await saveDecision(run.id, decision, 0)
    expect(reviewedResults(saved)[0]).toMatchObject({ status: 'approved_variance', matched: false })
    const rejected = await saveDecision(run.id, { ...decision, action: 'reject', statementIndex: null }, 1)
    expect(reviewedResults(rejected)[0]).toMatchObject({ status: 'rejected', statementRecord: null, matched: false })
  })
  it('prevents manual reuse of an already assigned statement row', async () => {
    const run = await createRun({ ...input, materiality: 1000, invoices: [invoice, { ...invoice, documentIndex: 1, fileName: 'second.jpg', invoiceNumber: 'INV2' }] })
    const first = await saveDecision(run.id, decision, 0)
    await expect(saveDecision(first.id, { ...decision, invoiceIndex: 1, invoiceNumber: 'INV2' }, 1)).rejects.toThrow('already assigned')
  })
  it('requires byte-identical originals before review, rejects corrupt upload', async () => {
    const original = new TextEncoder().encode('mock original bytes')
    const run = await createRun({ ...input, sample: false, files: [{ index: -1, name: 'statement.csv', sha256: digest(original), mime: 'text/csv' }, { index: 0, name: 'mock.jpg', sha256: digest(original), mime: 'image/jpeg' }] })
    expect(reviewedResults(run)[0]).toMatchObject({ status: 'archive_pending', matched: false })
    await expect(saveDecision(run.id, decision, 0)).rejects.toThrow('Archive all')
    await expect(archiveRunFile(run.id, 0, new Uint8Array([1]))).rejects.toThrow('do not match')
    await archiveRunFile(run.id, -1, original); await archiveRunFile(run.id, 0, original)
    expect((await saveDecision(run.id, decision, 0)).reviews['0'].status).toBe('needs_manager')
  })
  it('serializes concurrent reviews instead of losing audit events', async () => {
    const run = await createRun(input)
    const results = await Promise.allSettled([1, 2].map(() => saveDecision(run.id, decision, 0)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((await loadRun(run.id)).history).toHaveLength(1)
  })
})
