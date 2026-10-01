import { NextRequest, NextResponse } from 'next/server'
import { REPORT_DATA } from '@/lib/report-data-mock'
import { QUICKBOOKS_REPORT_DATA, QUICKBOOKS_DATA, buildQuickBooksBalanceSheet } from '@/lib/quickbooks-report-data'
import { balanceReviewReport } from '@/lib/balance-sheet-review'
import { buildBalanceSheet, periodForDate } from '@/lib/balance-sheet-periods'
import { validateReviewDraft } from '@/lib/mapping-reviews'
import { loadMappingReviews, saveMappingReview } from '@/lib/mapping-review-store'
import { isReviewOriginAllowed } from '@/lib/review-request'

export const runtime = 'nodejs'

function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function report(source: unknown, kind: unknown = 'profit-loss', from: unknown = '', to: unknown = '') {
  if (source !== 'quickbooks' && source !== 'xero') throw new Error('Unknown report source.')
  if (kind === 'profit-loss') return { key: source, data: source === 'quickbooks' ? QUICKBOOKS_REPORT_DATA : REPORT_DATA }
  if (kind !== 'balance-sheet' || !isISODate(from) || !isISODate(to) || from > to) throw new Error('Invalid balance-sheet review period.')
  if (source === 'quickbooks' && (from < QUICKBOOKS_DATA.balanceSheet.reportFrom || to > QUICKBOOKS_DATA.balanceSheet.reportTo)) throw new Error('Review dates must be within the downloaded period.')
  const base = source === 'quickbooks' ? buildQuickBooksBalanceSheet(from, to) : buildBalanceSheet(periodForDate(to), '31 Dec 2024')
  return { key: `${source}-balance-sheet-${from}-${to}`, data: balanceReviewReport(base, from, to) }
}

export async function GET(request: NextRequest) {
  if (request.cookies.get('qfr_auth')?.value !== '1') return NextResponse.json({ error: 'Sign in before reviewing.' }, { status: 401 })
  try {
    const source = request.nextUrl.searchParams.get('source')
    const { data, key } = report(source, request.nextUrl.searchParams.get('reportKind') ?? 'profit-loss', request.nextUrl.searchParams.get('startDate'), request.nextUrl.searchParams.get('endDate'))
    return NextResponse.json(await loadMappingReviews(key, data), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load reviews.' }, { status: 503 })
  }
}

export async function PUT(request: NextRequest) {
  if (request.cookies.get('qfr_auth')?.value !== '1') return NextResponse.json({ error: 'Sign in before reviewing.' }, { status: 401 })
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? request.nextUrl.protocol.replace(':', '')
  if (!isReviewOriginAllowed(request.headers.get('origin'), request.headers.get('host'), protocol)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
  try {
    const body = await request.json()
    const { data, key } = report(body.source, body.reportKind, body.startDate, body.endDate)
    if (typeof body.snapshotId !== 'string' || typeof body.lineId !== 'string' || !Number.isInteger(body.revision) || body.revision < 0) throw new Error('Invalid review identity or revision.')
    const draft = validateReviewDraft(body.review, data.allowed_categories)
    return NextResponse.json(await saveMappingReview(key, data, body.snapshotId, body.lineId, draft, body.revision), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save review.'
    return NextResponse.json({ error: message }, { status: /elsewhere|changed/.test(message) ? 409 : 400 })
  }
}
