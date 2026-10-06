'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { browserDataRequest } from '@/lib/browser-data'

export function useBrowserFileUrl(endpoint: string | null) {
  const [state, setState] = useState({ endpoint: '', url: '', error: '' })
  useEffect(() => {
    if (!endpoint) return
    const controller = new AbortController()
    let objectUrl = ''
    void browserDataRequest(endpoint, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error)
      const blob = await response.blob()
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setState({ endpoint, url: objectUrl, error: '' })
    }).catch(error => { if (!controller.signal.aborted) setState({ endpoint, url: '', error: error.message }) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [endpoint])
  return state.endpoint === endpoint ? state : { url: '', error: '' }
}

export function BrowserFileLink({ href, children, className, fileName }: { href: string; children: ReactNode; className?: string; fileName?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save() {
    setBusy(true); setError('')
    try {
      const response = await browserDataRequest(href)
      if (!response.ok) throw new Error((await response.json()).error)
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a')
      const headerName = response.headers.get('Content-Disposition')?.split("filename*=UTF-8''")[1]
      link.href = url; link.download = fileName ?? (headerName ? decodeURIComponent(headerName) : 'original')
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <><button type="button" className={className} disabled={busy} onClick={() => void save()}>{busy ? 'Loading…' : children}</button>{error && <span role="alert" className="ml-2 text-xs text-red-700">{error}</span>}</>
}
