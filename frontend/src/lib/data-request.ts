import { NextRequest, NextResponse } from 'next/server'
import { isReviewOriginAllowed } from './review-request'

export function guardDataRequest(request: NextRequest, mutation = false) {
  if (request.cookies.get('qfr_auth')?.value !== '1') return NextResponse.json({ error: 'Sign in before accessing stored financial data.' }, { status: 401 })
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? request.nextUrl.protocol.replace(':', '')
  if (mutation && !isReviewOriginAllowed(request.headers.get('origin'), request.headers.get('host'), protocol)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
  return null
}
export function dataError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unable to access data.'
  return NextResponse.json({ error: message }, { status: /elsewhere/.test(message) ? 409 : /durable storage|busy/.test(message) ? 503 : 400 })
}
