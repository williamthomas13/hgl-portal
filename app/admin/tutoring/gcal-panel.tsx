'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'

// Google Calendar connection panel (Phase 7a §4). Admin pastes the service-
// account JSON key (encrypted server-side; never readable back out); staff
// see connection status, queue health, and can retry failed pushes. The
// connect flow live-checks domain-wide delegation and says exactly what is
// still missing, because DWD propagation is the one genuinely async step.

type Status = {
  status: 'connected' | 'disconnected'
  clientEmail: string | null
  connectedBy: string | null
  connectedAt: string | null
  pendingCount: number
  failedCount: number
  callerRole: 'admin' | 'manager'
}

type FailedRow = {
  id: string
  session_id: string
  reason: string | null
  last_error: string | null
  attempts: number
  created_at: string
}

export default function GcalPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [failed, setFailed] = useState<FailedRow[]>([])
  const [saJson, setSaJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/gcal/status')
    if (res.ok) setStatus(await res.json())
    const { data } = await supabase
      .from('gcal_sync_log')
      .select('id, session_id, reason, last_error, attempts, created_at')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(10)
    setFailed((data as FailedRow[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function connect() {
    setBusy(true)
    setMessage('')
    const res = await fetch('/api/gcal/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saJson }),
    })
    const json = await res.json()
    if (!res.ok) {
      setMessage(`Error: ${json.error}`)
    } else if (json.dwdOk) {
      setMessage(`Connected as ${json.clientEmail} — domain-wide delegation verified. ✓`)
      setSaJson('')
    } else {
      setMessage(
        `Key saved (${json.clientEmail}), but the delegation test failed — usually this means ` +
          `domain-wide delegation isn't authorized yet in admin.google.com (Security → API controls), ` +
          `or is still propagating. Pushes will start working once it is. Google said: ${json.dwdError ?? 'unknown'}`
      )
    }
    setBusy(false)
    load()
  }

  async function disconnect() {
    if (!confirm('Disconnect Google Calendar? Scheduling keeps working; calendar pushes queue up until reconnected.')) return
    setBusy(true)
    await fetch('/api/gcal/disconnect', { method: 'POST' })
    setBusy(false)
    setMessage('Disconnected.')
    load()
  }

  async function retryAll() {
    setBusy(true)
    const res = await fetch('/api/gcal/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allFailed: true }),
    })
    const json = await res.json()
    setMessage(res.ok ? `Retried: ${json.reset} rows reset, ${json.synced} pushed.` : `Error: ${json.error}`)
    setBusy(false)
    load()
  }

  if (!status) return <p className="text-sm text-gray-500">Loading…</p>

  const connected = status.status === 'connected'
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3">
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${
            connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
          }`}
        >
          {status.status}
        </span>
        {status.clientEmail && (
          <span className="text-gray-600">
            {status.clientEmail}
            {status.connectedBy && <span className="text-gray-400"> · connected by {status.connectedBy}</span>}
          </span>
        )}
        <span className="ml-auto text-gray-500">
          queue: {status.pendingCount} pending · {status.failedCount} failed
        </span>
      </div>

      <p className="text-gray-500">
        One-way push: the portal writes sessions to tutors&apos; Google calendars and reads their busy
        times — tutors keep blocking availability in Google exactly as before. A Google outage never
        blocks scheduling; pushes queue and retry.
      </p>

      {status.callerRole === 'admin' && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-600 font-semibold">
            Service-account JSON key (from the Google Cloud console — stored encrypted, never shown again)
          </label>
          <textarea
            value={saJson}
            onChange={(e) => setSaJson(e.target.value)}
            rows={3}
            placeholder='{"type": "service_account", "client_email": "…", "private_key": "…"}'
            className="w-full border border-gray-300 rounded-md p-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <button
              onClick={connect}
              disabled={busy || !saJson.trim()}
              className="bg-hgl-slate text-white py-2 px-4 rounded hover:opacity-90 disabled:opacity-60"
            >
              {connected ? 'Replace key' : 'Connect'}
            </button>
            {connected && (
              <button
                onClick={disconnect}
                disabled={busy}
                className="text-red-600 py-2 px-3 rounded border border-red-200 hover:bg-red-50 disabled:opacity-60"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div className="border border-red-200 rounded-md p-3 bg-red-50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-red-700">Failed pushes</span>
            <button onClick={retryAll} disabled={busy} className="underline text-hgl-blue disabled:opacity-60">
              Retry all
            </button>
          </div>
          <ul className="space-y-1 text-xs text-red-800">
            {failed.map((f) => (
              <li key={f.id}>
                <span className="font-mono">{f.session_id.slice(0, 8)}</span> — {f.reason ?? 'push'} ·{' '}
                {f.last_error?.slice(0, 140) ?? 'unknown error'} ({f.attempts} attempts)
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <div
          className={`p-3 rounded text-center font-semibold ${
            message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
