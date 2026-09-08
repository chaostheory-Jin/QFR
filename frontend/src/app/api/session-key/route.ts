import { NextResponse } from 'next/server'
import { looksLikeOpenAIKey, OPENAI_KEY_COOKIE } from '@/lib/openai-key'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { apiKey?: unknown } | null
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!looksLikeOpenAIKey(apiKey)) {
    return NextResponse.json({ error: 'Enter a valid OpenAI API key beginning with sk-.' }, { status: 400 })
  }

  const response = NextResponse.json({ configured: true })
  response.headers.set('Cache-Control', 'no-store')
  response.cookies.set(OPENAI_KEY_COOKIE, apiKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ configured: false })
  response.headers.set('Cache-Control', 'no-store')
  response.cookies.set(OPENAI_KEY_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: new Date(0),
  })
  return response
}
