export const OPENAI_KEY_COOKIE = 'qfr_openai_key'

function cookieValue(request: Request, name: string): string {
  const cookieHeader = request.headers.get('cookie') ?? ''
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return ''
    }
  }
  return ''
}

export function openAIApiKey(request: Request): string {
  return cookieValue(request, OPENAI_KEY_COOKIE).trim()
    || process.env.OPENAI_API_KEY_QFR
    || process.env.OPENAI_API_KEY
    || ''
}

export function looksLikeOpenAIKey(value: string): boolean {
  return value.startsWith('sk-') && value.length >= 20 && !/\s/.test(value)
}
