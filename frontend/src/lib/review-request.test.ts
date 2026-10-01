import { describe, expect, it } from 'vitest'
import { isReviewOriginAllowed } from './review-request'

describe('review write origin checks', () => {
  it('accepts the requested loopback host even when the server internally uses localhost', () => {
    expect(isReviewOriginAllowed('http://127.0.0.1:3107', '127.0.0.1:3107', 'http')).toBe(true)
  })
  it('accepts the public HTTPS origin of a TLS-terminating proxy', () => {
    expect(isReviewOriginAllowed('https://qfr.example', 'qfr.example', 'https')).toBe(true)
  })
  it('rejects a different domain, port, scheme, null origin and malformed origin', () => {
    for (const origin of ['http://invalid.example', 'http://localhost:3108', 'https://localhost:3107', 'null', 'invalid']) {
      expect(isReviewOriginAllowed(origin, 'localhost:3107', 'http')).toBe(false)
    }
  })
  it('allows non-browser API clients without Origin, but not invalid forwarded protocols', () => {
    expect(isReviewOriginAllowed(null, 'localhost:3107', 'http')).toBe(true)
    expect(isReviewOriginAllowed('http://localhost:3107', 'localhost:3107', 'file')).toBe(false)
  })
})
