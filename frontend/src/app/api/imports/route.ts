import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { createImport, listImports, loadImport, updateImport } from '@/lib/import-store'
import { dataPath } from '@/lib/durable-store'
import { guardDataRequest, dataError } from '@/lib/data-request'
import { REPORT_DATA } from '@/lib/report-data-mock'
import type { ImportMetadata } from '@/lib/data-intake'

export const runtime = 'nodejs'
export async function GET(request: NextRequest) {
  const denied = guardDataRequest(request); if (denied) return denied
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ batches: await listImports() }, { headers: { 'Cache-Control': 'no-store' } })
    const batch = await loadImport(id)
    if (request.nextUrl.searchParams.get('original') === '1') return new NextResponse(new Uint8Array(await readFile(dataPath('imports', id, 'original.bin'))), {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(batch.fileName)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    })
    return NextResponse.json(batch, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return dataError(error) }
}
export async function POST(request: NextRequest) {
  const denied = guardDataRequest(request, true); if (denied) return denied
  try {
    if (Number(request.headers.get('content-length')) > 3.5 * 1024 * 1024) throw new Error('Upload limit is 3 MB.')
    const form = await request.formData(), file = form.get('file')
    if (!(file instanceof File)) throw new Error('Select a source file.')
    const metadata = JSON.parse(String(form.get('metadata'))) as ImportMetadata
    return NextResponse.json(await createImport(new Uint8Array(await file.arrayBuffer()), file.name, metadata))
  } catch (error) { return dataError(error) }
}
export async function PUT(request: NextRequest) {
  const denied = guardDataRequest(request, true); if (denied) return denied
  try {
    const body = await request.json()
    if (!Number.isInteger(body.revision) || body.revision < 0 || typeof body.commit !== 'boolean' || !body.mapping || typeof body.mapping !== 'object' || Array.isArray(body.mapping)) throw new Error('Invalid import request.')
    return NextResponse.json(await updateImport(body.id, body.revision, body.sheet, body.mapping, body.options, body.commit, REPORT_DATA.allowed_categories))
  } catch (error) { return dataError(error) }
}
