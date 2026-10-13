'use client'

import { useSyncExternalStore } from 'react'
import type { DataSource } from './link-data'
export type ReportSource = DataSource | 'payroll'

const STORAGE_KEY = 'qfr-report-source'
const CHANGE_EVENT = 'qfr-report-source-change'

export const DATA_SOURCE_LABELS: Record<ReportSource, string> = {
  xero: 'Xero',
  quickbooks: 'QuickBooks',
  payroll: 'Payroll Demo',
}

function currentSource(): ReportSource {
  if (typeof window === 'undefined') return 'quickbooks'
  const value = window.sessionStorage.getItem(STORAGE_KEY)
  return value === 'xero' || value === 'payroll' ? value : 'quickbooks'
}

export function setStoredDataSource(source: ReportSource) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(STORAGE_KEY, source)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

function serverSource(): DataSource {
  return 'quickbooks'
}

export function useReportSource(): [ReportSource, (source: ReportSource) => void] {
  const source = useSyncExternalStore(subscribe, currentSource, serverSource)
  return [source, setStoredDataSource]
}
