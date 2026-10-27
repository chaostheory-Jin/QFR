import { describe, expect, it, vi } from 'vitest'
import { saveDraftBatch } from './save-drafts'

describe('explicit draft saves', () => {
  it('saves only edited entries and awaits each revision before proceeding', async () => {
    let revision = 4
    const order: string[] = []
    const result = await saveDraftBatch([['a', 'approved'], ['c', 'rejected']], async (key) => {
      const previous = revision
      await Promise.resolve()
      expect(revision).toBe(previous)
      revision++
      order.push(`save:${key}:${revision}`)
    }, key => order.push(`clear:${key}`))
    expect(result).toEqual({ count: 2, error: '' })
    expect(order).toEqual(['save:a:5', 'clear:a', 'save:c:6', 'clear:c'])
  })
  it('stops on a failure, clearing only successful drafts', async () => {
    const cleared = vi.fn(), persisted = vi.fn(async (key: string) => { if (key === 'b') throw new Error('Revision conflict') })
    const result = await saveDraftBatch([['a', 1], ['b', 2], ['c', 3]], persisted, cleared)
    expect(result).toEqual({ count: 1, error: 'Revision conflict' })
    expect(persisted.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
    expect(cleared).toHaveBeenCalledExactlyOnceWith('a', 1)
  })
  it('never creates a review from an empty batch', async () => {
    const persist = vi.fn(), clear = vi.fn()
    expect(await saveDraftBatch([], persist, clear)).toEqual({ count: 0, error: '' })
    expect(persist).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })
  it('keeps all drafts on storage failure and can retry them', async () => {
    const entries: [string, number][] = [['a', 1], ['b', 2]]
    const clear = vi.fn()
    expect((await saveDraftBatch(entries, async () => { throw 'quota' }, clear)).count).toBe(0)
    expect(clear).not.toHaveBeenCalled()
    expect((await saveDraftBatch(entries, async () => {}, clear)).count).toBe(2)
  })
})
