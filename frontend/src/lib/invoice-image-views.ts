import sharp from 'sharp'
import { createHash } from 'node:crypto'

export const INVOICE_IMAGE_PIPELINE = 'original-with-field-views-v3'
export type ImageViewAudit = { label: string; width: number; height: number; sha256: string; box: [number, number, number, number] }
export type ImagePart = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'original' }

/** Fixed geometry for common portrait invoice forms, never derived from expected answers.
 * Full page is always present; landscape screenshots use the full page only.
 * All crop coordinates are normalised to the auto-oriented input image. */
export function invoiceViewRegions(width: number, height: number) {
  if (height / width < 1.15 || width < 900) return []
  return [
    { label: 'Header invoice-number region', box: [680, 165, 1000, 295] as [number, number, number, number], channel: 'green' as const },
    { label: 'Tight header identifier strip (may be empty on a different layout)', box: [760, 208, 990, 253] as [number, number, number, number], channel: 'green' as const },
    { label: 'Printed totals region including net, tax and gross labels', box: [35, 605, 810, 815] as [number, number, number, number], channel: 'red' as const },
    { label: 'Printed totals region tight value strip (read rows with labels from the wider view)', box: [640, 635, 850, 765] as [number, number, number, number], channel: 'red' as const },
  ]
}

export async function prepareInvoiceImage(bytes: Buffer): Promise<{ parts: ImagePart[]; views: ImageViewAudit[] }> {
  const oriented = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({
    width: 3200, height: 4200, fit: 'inside', withoutEnlargement: true,
  }).png().toBuffer({ resolveWithObject: true })
  const { width, height } = oriented.info
  const parts: ImagePart[] = []
  const views: ImageViewAudit[] = []
  async function add(label: string, buffer: Buffer, box: ImageViewAudit['box']) {
    const metadata = await sharp(buffer).metadata()
    views.push({ label, box, width: metadata.width!, height: metadata.height!, sha256: createHash('sha256').update(buffer).digest('hex') })
    parts.push({ type: 'input_text', text: label + '. This is the SAME document, not a new invoice.' },
      { type: 'input_image', image_url: `data:image/png;base64,${buffer.toString('base64')}`, detail: 'original' })
  }
  await add('Full original document (orientation normalised, no added content)', oriented.data, [0, 0, 1000, 1000])
  for (const region of invoiceViewRegions(width, height)) {
    const [x1, y1, x2, y2] = region.box
    const left = Math.floor(width * x1 / 1000), top = Math.floor(height * y1 / 1000)
    const cropWidth = Math.floor(width * x2 / 1000) - left, cropHeight = Math.floor(height * y2 / 1000) - top
    const crop = await sharp(oriented.data).extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer()
    await add(region.label + ' in original colour', crop, region.box)
    // Channel isolation suppresses marker/watermark background; it cannot add digits.
    // Keep the original-colour crop alongside it so processing artifacts are visible.
    const enlarged = await sharp(crop).extractChannel(region.channel).normalise().resize({
      width: Math.min(2200, cropWidth * (x2 - x1 < 250 ? 4 : 2)), kernel: 'lanczos3',
    }).png().toBuffer()
    await add(region.label + ' enlarged contrast view (verify against original-colour view)', enlarged, region.box)
  }
  return { parts, views }
}
