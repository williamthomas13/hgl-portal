'use client'

import { useCallback, useEffect, useState } from 'react'

// PL-202: the Quo setup panel — three acts, same shape as the intl-calendar
// lesson: CONFIGURE (secret + API key in the environment; the endpoint URL
// to paste into Quo's webhook settings), VERIFY (test deliveries land and
// count up here), ENABLE (the explicit switch — configuration alone never
// activates anything). Also the one-way contact push (externalId trick).

export default function CallsPanel() {
  const [status, setStatus] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/calls')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setStatus(json)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true)
    setMessage('')
    const res = await fetch('/api/admin/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setMessage(res.ok ? done.replace('{n}', String(json.pushed ?? '')) : 'Error: ' + (json.error ?? 'failed'))
    setBusy(false)
    load()
  }

  if (!status) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <div className="text-sm space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">1 · Configure (Quo account + this endpoint)</p>
        <ul className="text-xs space-y-1 text-gray-700">
          <li>
            Webhook endpoint to paste into Quo:{' '}
            <code className="bg-gray-100 rounded px-1.5 py-0.5">{status.endpointUrl}</code>
          </li>
          <li>
            Signing secret (QUO_WEBHOOK_SECRET):{' '}
            {status.secretConfigured ? (
              <span className="text-green-700 font-semibold">configured</span>
            ) : (
              <span className="text-amber-700 font-semibold">not set — deliveries are refused until it is</span>
            )}
          </li>
          <li>
            API key (QUO_API_KEY, for the contact push):{' '}
            {status.apiKeyConfigured ? (
              <span className="text-green-700 font-semibold">configured</span>
            ) : (
              <span className="text-gray-500">not set yet</span>
            )}
          </li>
        </ul>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">2 · Verify (send a test delivery from Quo)</p>
        <p className="text-xs text-gray-700">
          {status.events.total} call event{status.events.total === 1 ? '' : 's'} received all-time ·{' '}
          {status.events.last7} in the last 7 days.
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">3 · Enable (configuration is not activation)</p>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold ${status.enabled ? 'text-green-700' : 'text-gray-500'}`}>
            {status.enabled ? 'ON — calls are being processed' : 'OFF — deliveries acknowledged and dropped'}
          </span>
          <button
            disabled={busy}
            onClick={() =>
              act(
                { action: 'set_enabled', enabled: !status.enabled },
                status.enabled ? 'Calls integration switched off.' : 'Calls integration is LIVE.'
              )
            }
            className="text-xs font-bold border border-gray-400 rounded px-3 py-1.5 hover:border-hgl-slate disabled:opacity-40"
          >
            {status.enabled ? 'Switch off' : 'Switch on'}
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Contact sync (portal → Quo, one-way)</p>
        <p className="text-xs text-gray-500 mb-1.5">
          Pushes family contacts with our record id attached, so caller ID reads the parent&apos;s name
          and future calls match instantly. The portal stays the system of record.
        </p>
        <button
          disabled={busy || !status.apiKeyConfigured || !status.enabled}
          onClick={() => act({ action: 'push_contacts' }, 'Pushed {n} contacts to Quo.')}
          className="text-xs font-bold bg-hgl-slate text-white rounded px-3 py-1.5 disabled:opacity-40"
          title={!status.apiKeyConfigured ? 'Needs QUO_API_KEY' : !status.enabled ? 'Enable the integration first' : ''}
        >
          Push contacts to Quo
        </button>
      </div>

      {message && (
        <p className={`text-xs ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
      )}
    </div>
  )
}
