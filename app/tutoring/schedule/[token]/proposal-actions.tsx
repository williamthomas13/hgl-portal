'use client'

import { useState } from 'react'

// Confirm / Request changes (Phase 7c §6.2). Request changes is free text →
// Ops Director notification; the auto-confirm clock pauses while a request
// is open, and the copy always offers the human path instead of a dead end.

export default function ProposalActions({
  token,
  changeRequested,
}: {
  token: string
  changeRequested: boolean
}) {
  const [mode, setMode] = useState<'buttons' | 'changes' | 'done-confirm' | 'done-changes'>('buttons')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function call(action: 'confirm' | 'request_changes') {
    setBusy(true)
    setError('')
    const res = await fetch('/api/tutoring/proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action, note }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) setError(json.error ?? 'Something went wrong — please try again or just reply to our email.')
    else setMode(action === 'confirm' ? 'done-confirm' : 'done-changes')
  }

  if (mode === 'done-confirm') {
    return (
      <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm font-semibold">
        Schedule confirmed — thank you! The sessions are locked in and your invoice follows by email.
      </div>
    )
  }
  if (mode === 'done-changes') {
    return (
      <div className="p-4 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
        Got it — we&apos;ll be in touch shortly to sort out the schedule. Nothing is confirmed until
        you&apos;ve okayed the updated plan.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {changeRequested && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          You&apos;ve already asked for changes — we&apos;re on it. You can still confirm the current
          schedule below if it turns out to work after all.
        </p>
      )}
      {mode === 'buttons' ? (
        <div className="flex flex-wrap gap-3">
          <button
            disabled={busy}
            onClick={() => call('confirm')}
            className="bg-hgl-slate text-white py-2.5 px-6 rounded font-bold hover:opacity-90 disabled:opacity-50"
          >
            Confirm schedule
          </button>
          <button
            disabled={busy}
            onClick={() => setMode('changes')}
            className="border border-gray-300 text-gray-700 py-2.5 px-6 rounded font-semibold hover:bg-gray-50"
          >
            Request changes
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Tell us what you'd like different — days, times, frequency, anything."
            className="w-full border border-gray-300 rounded-md p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              disabled={busy || !note.trim()}
              onClick={() => call('request_changes')}
              className="bg-hgl-blue text-white py-2 px-5 rounded font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Send request
            </button>
            <button onClick={() => setMode('buttons')} className="text-gray-500 underline text-sm">
              back
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
    </div>
  )
}
