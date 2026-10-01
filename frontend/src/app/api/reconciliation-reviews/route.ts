import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { archiveRunFile, createRun, listRuns, loadRun, saveDecision } from '@/lib/reconciliation-review-store'
import { dataPath } from '@/lib/durable-store'
import { guardDataRequest, dataError } from '@/lib/data-request'

export const runtime = 'nodejs'
export async function GET(request: NextRequest) {
  const denied = guardDataRequest(request); if (denied) return denied
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ runs: await listRuns() }, { headers: { 'Cache-Control': 'no-store' } })
    const run = await loadRun(id), original = request.nextUrl.searchParams.get('original')
    if (original !== null) {
      const index = Number(original), file = run.files.find(file => file.index === index)
      if (!file?.archived) throw new Error('Original evidence is not archived.')
      const name = index === -1 ? 'statement.bin' : `invoice-${index}.bin`
      return new NextResponse(new Uint8Array(await readFile(dataPath('reconciliation', id, name))), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
    }
    return NextResponse.json(run, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return dataError(error) }
}
export async function POST(request: NextRequest) {
  const denied = guardDataRequest(request, true); if (denied) return denied
  try {
    if (Number(request.headers.get('content-length')) > 3.75 * 1024 * 1024) throw new Error('Archive one file at a time, maximum 3.5 MB.')
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData(), file = form.get('file')
      if (!(file instanceof File) || !file.size || file.size > 3.5 * 1024 * 1024) throw new Error('Invalid original evidence file size.')
      return NextResponse.json(await archiveRunFile(String(form.get('id')), Number(form.get('index')), new Uint8Array(await file.arrayBuffer())))
    }
    return NextResponse.json(await createRun(await request.json()))
  } catch (error) { return dataError(error) }
}
export async function PUT(request: NextRequest) {
  const denied = guardDataRequest(request, true); if (denied) return denied
  try {
    const body = await request.json()
    return NextResponse.json(await saveDecision(body.id, body.decision, body.revision))
  } catch (error) { return dataError(error) }
}
