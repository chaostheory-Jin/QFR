import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { invoiceViewRegions, prepareInvoiceImage } from './invoice-image-views'

describe('invoice-only original-resolution views', () => {
  it('uses geometry, not filenames or expected invoice answers', () => {
    const regions = invoiceViewRegions(2550, 3300)
    expect(regions).toHaveLength(4)
    for (const region of regions) {
      const [x1, y1, x2, y2] = region.box
      expect(x1).toBeGreaterThanOrEqual(0)
      expect(y1).toBeGreaterThanOrEqual(0)
      expect(x2).toBeLessThanOrEqual(1000)
      expect(y2).toBeLessThanOrEqual(1000)
      expect(x2).toBeGreaterThan(x1)
      expect(y2).toBeGreaterThan(y1)
    }
    expect(invoiceViewRegions(2940, 1312)).toEqual([])
  })
  it('keeps the full native-resolution image plus original-colour and contrast field crops', async () => {
    const bytes = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#efdddd' } }).png().toBuffer()
    const originalHash = createHash('sha256').update(bytes).digest('hex')
    const result = await prepareInvoiceImage(bytes)
    expect(result.views).toHaveLength(9)
    expect(result.parts.filter(part => part.type === 'input_image')).toHaveLength(9)
    expect(result.views[0]).toMatchObject({ width: 1200, height: 1600, box: [0, 0, 1000, 1000] })
    for (const view of result.views) expect(view.sha256).toMatch(/^[a-f0-9]{64}$/)
    for (const part of result.parts) if (part.type === 'input_image') expect(part.detail).toBe('original')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(originalHash)
  })
  it('retains landscape screenshots without applying a portrait-template crop', async () => {
    const bytes = await sharp({ create: { width: 1400, height: 600, channels: 3, background: '#fff' } }).png().toBuffer()
    expect((await prepareInvoiceImage(bytes)).views).toHaveLength(1)
  })
})
