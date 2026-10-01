// Use the externally requested Host, not Next's internal server hostname.
export function isReviewOriginAllowed(origin: string | null, host: string | null, protocol: string): boolean {
  if (!origin) return true
  if (!host || !['http', 'https'].includes(protocol)) return false
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin
  } catch { return false }
}
