/** Save only explicitly edited items, in order; retain the failed item and all remaining drafts. */
export async function saveDraftBatch<T>(entries: [string, T][], save: (key: string, draft: T) => Promise<void>, saved: (key: string, draft: T) => void) {
  let count = 0
  for (const [key, draft] of entries) {
    try { await save(key, draft) }
    catch (error) { return { count, error: error instanceof Error ? error.message : 'Unable to save. Please retry.' } }
    saved(key, draft)
    count++
  }
  return { count, error: '' }
}
