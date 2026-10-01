'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DataSource } from './link-data'
import type { ReportData } from './report-data'
import { applyMappingReviews, type ReviewDraft, type ReviewMap } from './mapping-reviews'

type ReviewScope = { reportKind: 'balance-sheet'; startDate: string; endDate: string }
type ReviewState = { identity: string; snapshotId: string; reviews: ReviewMap }

export function useMappingReviews(source: DataSource, data: ReportData, scope?: ReviewScope) {
  const identity = new URLSearchParams({ source, ...(scope ?? {}) }).toString()
  const [state, setState] = useState<ReviewState | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/mapping-reviews?${identity}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const payload = await response.json()
        if (controller.signal.aborted) return
        if (!response.ok) throw new Error(payload.error || 'Unable to load reviews.')
        setState({ identity, ...payload })
        setError('')
      })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load reviews.') })
    return () => controller.abort()
  }, [identity])

  const reviews = useMemo(() => state?.identity === identity ? state.reviews : {}, [state, identity])
  const rows = useMemo(() => applyMappingReviews(data.raw_data, reviews, data.review_threshold), [data, reviews])
  const ready = state?.identity === identity

  async function save(lineId: string, review: ReviewDraft) {
    if (!state || state.identity !== identity) throw new Error('Wait for saved reviews to load.')
    setSaving(true)
    try {
      const response = await fetch('/api/mapping-reviews', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, ...(scope ?? {}), snapshotId: state.snapshotId, lineId, review, revision: state.reviews[lineId]?.revision ?? 0 }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to save review.')
      setState({ identity, ...payload })
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save review.')
      throw caught
    } finally { setSaving(false) }
  }

  return { rows, reviews, ready, saving, error, save, snapshotId: state?.identity === identity ? state.snapshotId : '' }
}
