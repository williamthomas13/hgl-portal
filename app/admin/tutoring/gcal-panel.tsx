'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { ConfirmAction } from './confirm'

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
    if (res.ok) setStatus(await res.json().catch(() => ({})))
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
    const json = await res.json().catch(() => ({}))
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
    const json = await res.json().catch(() => ({}))
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={connect}
              disabled={busy || !saJson.trim()}
              className="bg-hgl-slate text-white py-2 px-4 rounded hover:opacity-90 disabled:opacity-60"
            >
              {connected ? 'Replace key' : 'Connect'}
            </button>
            {connected && (
              <ConfirmAction
                label="Disconnect"
                message="Disconnect? Scheduling keeps working; calendar pushes queue up until reconnected."
                confirmLabel="Yes, disconnect"
                className="text-red-600 py-2 px-3 rounded border border-red-200 hover:bg-red-50 disabled:opacity-60"
                disabled={busy}
                onConfirm={disconnect}
              />
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

      <IntlCalendarSection />

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

/** PL-161: the International Classes shared calendar — point the portal at
 *  the SAME calendar everyone already subscribes to, adopt the hand-made
 *  events once (report, never delete), and sync/audit on demand (the daily
 *  cron does both automatically once configured). */
function IntlCalendarSection() {
  const [calendarId, setCalendarId] = useState('')
  const [configured, setConfigured] = useState(false)
  // Jul-28 lesson: configuration must not equal activation.
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [report, setReport] = useState<{ summary: string | null; start: string | null }[] | null>(null)

  useEffect(() => {
    fetch('/api/admin/intl-calendar')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.config) {
          setCalendarId(json.config.calendarId)
          setConfigured(true)
          setEnabled(Boolean(json.config.enabled))
        }
      })
      .catch(() => {})
  }, [])

  async function act(body: Record<string, unknown>, describe: (json: Record<string, unknown>) => string) {
    setBusy(true)
    setNote('')
    try {
      const res = await fetch('/api/admin/intl-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      setNote(res.ok ? describe(json) : 'Error: ' + (json.error ?? res.status))
      if (res.ok && body.action === 'configure') setConfigured(true)
    } catch {
      setNote("Error: couldn't reach the server.")
    }
    setBusy(false)
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (
    <div className="mt-6 pt-4 border-t border-gray-200 text-sm">
      <h3 className="font-bold text-hgl-slate mb-1">International Classes calendar</h3>
      <p className="text-xs text-gray-500 mb-2">
        The portal writes to the SAME shared calendar everyone already subscribes to — class spans
        and session blocks, in the established colors (yellow proposed · dark green in-person ·
        light green online · red cancelled — cancelled recolors, never deletes). The cutover is
        THREE separate acts: <strong>1)</strong> save the calendar id (changes nothing),{' '}
        <strong>2)</strong> run &ldquo;adopt hand-made events&rdquo; once and check its report,{' '}
        <strong>3)</strong>{' '}press Enable — only then do the daily sweep and sync-now write to the
        calendar. Hand edits are reported by the drift audit, never overwritten.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={calendarId}
          onChange={(e) => setCalendarId(e.target.value)}
          placeholder="Shared calendar id (…@group.calendar.google.com)"
          className="border border-gray-300 rounded p-1.5 text-xs flex-1 min-w-72"
        />
        <button
          disabled={busy || !calendarId.trim()}
          onClick={() => act({ action: 'configure', calendarId: calendarId.trim() }, () => 'Saved. Nothing is writing yet — adopt hand-made events, then press Enable when ready.')}
          className="text-xs font-semibold bg-hgl-slate text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          Save
        </button>
        {configured && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                act({ action: 'reconcile' }, (j: any) => {
                  setReport(j.result?.unmatched ?? [])
                  return `Adopted ${j.result?.adoptedSpans ?? 0} span event(s) and ${j.result?.adoptedSessions ?? 0} session event(s); ${j.result?.unmatched?.length ?? 0} hand event(s) matched nothing (listed below — nothing was deleted).`
                })
              }
              className="text-xs font-semibold text-purple-700 underline disabled:opacity-50"
            >
              adopt hand-made events
            </button>
            <button
              disabled={busy || !enabled}
              title={enabled ? undefined : 'Enable the sync first — configuring the id does not activate anything'}
              onClick={() =>
                act({ action: 'sync' }, (j: any) =>
                  `Synced — ${j.result?.created ?? 0} created, ${j.result?.patched ?? 0} updated, ${j.result?.unchanged ?? 0} already right${j.result?.errors?.length ? `, ${j.result.errors.length} error(s)` : ''}.`
                )
              }
              className="text-xs font-semibold text-hgl-blue underline disabled:opacity-50"
            >
              sync now
            </button>
            <button
              disabled={busy}
              onClick={() =>
                act({ action: enabled ? 'disable' : 'enable' }, (j: any) => {
                  setEnabled(Boolean((j as any).enabled))
                  return (j as any).enabled
                    ? 'Sync ENABLED — the daily sweep and sync-now will now write to the subscribed calendar.'
                    : 'Sync disabled — nothing writes to the calendar until re-enabled.'
                })
              }
              className={`text-xs font-bold px-2 py-1 rounded ${enabled ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`}
              title="The explicit activation switch — separate from configuring the id on purpose"
            >
              {enabled ? 'sync: ON' : 'sync: OFF — enable'}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                act({ action: 'audit' }, (j: any) =>
                  j.result?.drift?.length
                    ? `Drift: ${j.result.drift.length} hand-edited event(s) — ${j.result.drift.map((d: any) => d.what).join('; ')}`
                    : 'No drift — the calendar matches the portal.'
                )
              }
              className="text-xs font-semibold text-gray-600 underline disabled:opacity-50"
            >
              run drift audit
            </button>
          </>
        )}
      </div>
      {note && <p className={`text-xs mt-2 ${note.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>{note}</p>}
      {report && report.length > 0 && (
        <ul className="mt-2 text-xs text-gray-600 list-disc ml-5">
          {report.slice(0, 20).map((r, i) => (
            <li key={i}>
              &ldquo;{r.summary ?? '(untitled)'}&rdquo; {r.start ? `· ${r.start.slice(0, 10)}` : ''} — matched no
              portal class or session; resolve by hand
            </li>
          ))}
          {report.length > 20 && <li>…and {report.length - 20} more</li>}
        </ul>
      )}
    </div>
  )
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
