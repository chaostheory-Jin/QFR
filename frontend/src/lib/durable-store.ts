import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export function dataDirectory() {
  if (process.env.QFR_DATA_STORE_DIR) return resolve(process.env.QFR_DATA_STORE_DIR)
  if (process.env.VERCEL) throw new Error('Configure QFR_DATA_STORE_DIR on durable storage before importing or reviewing.')
  return resolve(/* turbopackIgnore: true */ process.cwd(), '..', 'output', 'data-platform')
}
export function dataPath(kind: string, id: string, name = 'snapshot.json') {
  if (!['imports', 'reconciliation', 'documents'].includes(kind) || !/^[a-f0-9]{64}$/.test(id) || !/^[a-z0-9.-]+$/.test(name)) throw new Error('Invalid storage identity.')
  return join(dataDirectory(), kind, id, name)
}
export async function readJSON<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
export async function atomicJSON(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) }
}
export async function immutableBytes(path: string, bytes: Uint8Array) {
  let file
  try { file = await open(path, 'wx', 0o600) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (digest(await readFile(path)) !== digest(bytes)) throw new Error('Original evidence conflicts with the stored file.')
    return
  }
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
}
export async function locked<T>(directory: string, work: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, '.write.lock')
  let lock
  for (let attempt = 0; attempt < 60; attempt++) {
    try { lock = await open(path, 'wx', 0o600); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await new Promise(done => setTimeout(done, 50))
    }
  }
  if (!lock) throw new Error('Storage is busy. Retry shortly. A surviving lock requires operator investigation.')
  try { return await work() } finally { try { await lock.close() } finally { await unlink(path) } }
}
