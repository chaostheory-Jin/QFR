import { describe, expect, it } from 'vitest'
import { looksLikeOpenAIKey, openAIApiKey } from './openai-key'

describe('OpenAI API key resolution', () => {
  it('prefers the user session key from the HttpOnly cookie', () => {
    const request = new Request('https://example.test/api', {
      headers: { cookie: 'qfr_auth=1; qfr_openai_key=sk-user-session-key-123456789' },
    })
    expect(openAIApiKey(request)).toBe('sk-user-session-key-123456789')
  })

  it('validates the basic secret-key shape without logging it', () => {
    expect(looksLikeOpenAIKey('sk-project-key-1234567890')).toBe(true)
    expect(looksLikeOpenAIKey('not-a-key')).toBe(false)
    expect(looksLikeOpenAIKey('sk-key with spaces 123456')).toBe(false)
  })
})
