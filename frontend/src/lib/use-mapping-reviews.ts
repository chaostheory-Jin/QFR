'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DataSource } from './link-data'
import type { ReportData } from './report-data'
import { applyMappingReviews, type ReviewDraft, type ReviewMap } from './mapping-reviews'
import { loadBrowserReviews, saveBrowserReview } from './browser-mapping-reviews'

type ReviewScope = { reportKind: 'balance-sheet'; startDate: string; endDate: string }
type ReviewState = { identity: string; snapshotId: string; reviews: ReviewMap }

export function useMappingReviews(source: DataSource, data: ReportData, scope?: ReviewScope) {
  const identity = new URLSearchParams({ source, ...(scope ?? {}) }).toString()
  const [state, setState] = useState<ReviewState | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    loadBrowserReviews(identity, data)
      .then(payload => {
        if (controller.signal.aborted) return
        setState({ identity, ...payload })
        setError('')
      })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load reviews.') })
    return () => controller.abort()
  }, [identity, data])

  const reviews = useMemo(() => state?.identity === identity ? state.reviews : {}, [state, identity])
  const rows = useMemo(() => applyMappingReviews(data.raw_data, reviews, data.review_threshold), [data, reviews])
  const ready = state?.identity === identity

  async function save(lineId: string, review: ReviewDraft) {
    if (!state || state.identity !== identity) throw new Error('Wait for saved reviews to load.')
    setSaving(true)
    try {
      const payload = await saveBrowserReview(identity, data, state.snapshotId, lineId, review, state.reviews[lineId]?.revision ?? 0)
      setState({ identity, ...payload })
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save review.')
      throw caught
    } finally { setSaving(false) }
  }

  return { rows, reviews, ready, saving, error, save, snapshotId: state?.identity === identity ? state.snapshotId : '' }
}
