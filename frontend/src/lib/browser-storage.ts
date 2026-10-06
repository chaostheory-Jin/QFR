// Private, origin-scoped storage. No API keys or server paths belong here.
export const BROWSER_DATABASE = 'qfr-browser-data-v1'
type Entry<T> = { key: string; value: T }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Browser storage is unavailable. Enable site storage in a normal browser window.')); return }
    const request = indexedDB.open(BROWSER_DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' })
    request.onerror = () => reject(new Error('Unable to open browser storage. Check this site’s storage permissions.'))
    request.onblocked = () => reject(new Error('Close other QFR tabs and retry opening browser storage.'))
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  })
}

export async function browserRead<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction('records', 'readonly'), request = tx.objectStore('records').get(key)
      tx.oncomplete = () => resolve((request.result as Entry<T> | undefined)?.value)
      tx.onabort = () => reject(tx.error ?? new Error('Unable to read browser data.'))
    })
  } finally { db.close() }
}

export async function browserList<T>(prefix: string): Promise<T[]> {
  const db = await openDatabase()
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction('records', 'readonly')
      const request = tx.objectStore('records').getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'))
      tx.oncomplete = () => resolve((request.result as Entry<T>[]).map(entry => entry.value))
      tx.onabort = () => reject(tx.error ?? new Error('Unable to list browser data.'))
    })
  } finally { db.close() }
}

// Reducers must be synchronous: validation, revision checks and writes run in
// ONE IndexedDB transaction, including concurrent writes from another tab.
export async function browserUpdate<T>(key: string, update: (current: T | undefined, peers: T[]) => T, prefix?: string): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records')
      const request = prefix ? store.getAll(IDBKeyRange.bound(prefix, prefix + '\uffff')) : store.get(key)
      let result: T, failure: unknown
      request.onsuccess = () => {
        try {
          const entries: Entry<T>[] = prefix ? request.result : request.result ? [request.result] : []
          result = update(entries.find(entry => entry.key === key)?.value, entries.map(entry => entry.value))
          store.put({ key, value: result })
        } catch (error) { failure = error; tx.abort() }
      }
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure ?? new Error(tx.error?.name === 'QuotaExceededError'
        ? 'Browser storage is full. Export your records and free space before retrying. Nothing was saved.'
        : 'Unable to save browser data. Check site storage permissions and retry.'))
    })
  } finally { db.close() }
}

export async function browserDigest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('')
}
