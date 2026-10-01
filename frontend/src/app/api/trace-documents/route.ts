import { NextRequest, NextResponse } from 'next/server'
import { guardDataRequest, dataError } from '@/lib/data-request'
import { addTraceDocument, listTraceDocuments, readTraceDocument, type DocumentScope } from '@/lib/trace-document-store'

export const runtime = 'nodejs'
function scope(request: NextRequest): DocumentScope {
  const query = request.nextUrl.searchParams
  return { source: query.get('source'), report: query.get('report'), record: query.get('record') } as DocumentScope
}
export async function GET(request: NextRequest) {
  const denied = guardDataRequest(request); if (denied) return denied
  try {
    const fileId = request.nextUrl.searchParams.get('file')
    if (!fileId) return NextResponse.json({ documents: await listTraceDocuments(scope(request)) }, { headers: { 'Cache-Control': 'no-store' } })
    const { document, bytes } = await readTraceDocument(scope(request), fileId)
    const preview = request.nextUrl.searchParams.get('preview') === '1'
    return new NextResponse(new Uint8Array(bytes), { headers: {
      'Content-Type': preview ? document.mime : 'application/octet-stream',
      'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer',
    } })
  } catch (error) { return dataError(error) }
}
export async function POST(request: NextRequest) {
  const denied = guardDataRequest(request, true); if (denied) return denied
  try {
    if (Number(request.headers.get('content-length')) > 3.5 * 1024 * 1024) throw new Error('Upload limit is 3 MB.')
    const form = await request.formData(), file = form.get('file'), note = form.get('note')
    if (!(file instanceof File) || (note !== null && typeof note !== 'string')) throw new Error('Select a supporting document.')
    const documents = await addTraceDocument(scope(request), new Uint8Array(await file.arrayBuffer()), file.name, note ?? '')
    return NextResponse.json({ documents })
  } catch (error) { return dataError(error) }
}
