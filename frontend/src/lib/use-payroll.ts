'use client'
import { useCallback, useEffect, useState } from 'react'
import { loadPayrollState, savePayrollAction } from './payroll-store'
import type { PayrollAction, PayrollState } from './payroll-ledger'

const EVENT = 'qfr-payroll-updated'
export function usePayroll() {
  const [state, setState] = useState<PayrollState | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    try { const next = await loadPayrollState(); setState(current => !current || next.revision >= current.revision ? next : current); setError('') }
    catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => {
    let active = true
    const load = () => { void loadPayrollState().then(next => { if (active) { setState(current => !current || next.revision >= current.revision ? next : current); setError('') } }).catch(e => { if (active) setError(e.message) }) }
    load()
    window.addEventListener(EVENT, load)
    window.addEventListener('focus', load)
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(EVENT) : null
    if (channel) channel.onmessage = load
    return () => { active = false; window.removeEventListener(EVENT, load); window.removeEventListener('focus', load); channel?.close() }
  }, [])
  async function act(action: PayrollAction) {
    if (!state || busy) return false
    setBusy(true); setError('')
    try {
      const next = await savePayrollAction(action, state.revision)
      setState(next); window.dispatchEvent(new Event(EVENT))
      if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel(EVENT); channel.postMessage(next.revision); channel.close() }
      return true
    } catch (e) { setError((e as Error).message); return false }
    finally { setBusy(false) }
  }
  return { state, error, busy, reload, act }
}
