'use client'

import { useState } from 'react'

// PL-299: the family's continue-or-stop decision on an hours block, made in
// the signed-in portal (NO tokenized link, by design — the email points
// here). Renders only once the low-hours ask has gone out ('asked'); after a
// decision it shows the recorded state plainly. Inline confirm, never modal.

export default function BlockConfirmControl({
  engagementId,
  state,
  studentFirst,
  remaining,
  purchased,
  rate,
}: {
  engagementId: string
  state: string | null
  studentFirst: string
  remaining: number
  purchased: number
  rate: number
}) {
  const [localState, setLocalState] = useState(state)
  const [armed, setArmed] = useState<'confirmed' | 'declined' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (localState === 'confirmed') {
    return (
      <div className="text-xs mt-2 bg-green-50 border border-green-200 rounded p-2 text-green-800">
        You&apos;ve confirmed: after the purchased hours, {studentFirst}&apos;s tutoring continues
        on the monthly plan at ${rate}/hr. Nothing else to do.
      </div>
    )
  }
  if (localState === 'declined') {
    return (
      <div className="text-xs mt-2 bg-gray-50 border border-gray-200 rounded p-2 text-gray-600">
        You&apos;ve chosen to stop when the purchased hours are used up — nothing bills past them.
        Changed your mind? Just reply to any of our emails.
      </div>
    )
  }
  if (localState !== 'asked') return null

  async function decide(decision: 'confirmed' | 'declined') {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/portal/block-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, decision }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setError(json.error ?? 'That didn’t save — try again or reply to our email.')
      else setLocalState(decision)
    } catch {
      setError('That didn’t save — try again or reply to our email.')
    } finally {
      setBusy(false)
      setArmed(null)
    }
  }

  return (
    <div className="text-xs mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-amber-900 space-y-1.5">
      <p>
        <strong>
          {studentFirst} has {remaining} of {purchased} purchased hours left.
        </strong>{' '}
        When they&apos;re used up, tutoring can continue on our standard monthly plan at ${rate}/hr
        — or the sessions stop when the hours do. It&apos;s your call:
      </p>
      {armed === null ? (
        <p className="flex flex-wrap gap-2">
          <button
            onClick={() => setArmed('confirmed')}
            disabled={busy}
            className="bg-hgl-blue text-white font-bold rounded px-3 py-1.5 disabled:opacity-50"
          >
            Continue after the hours
          </button>
          <button
            onClick={() => setArmed('declined')}
            disabled={busy}
            className="border border-gray-300 bg-white text-gray-700 rounded px-3 py-1.5 disabled:opacity-50"
          >
            Stop when the hours run out
          </button>
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2">
          <span>
            {armed === 'confirmed'
              ? `Continue monthly at $${rate}/hr after the hours — confirm?`
              : 'Stop the sessions when the hours run out — confirm?'}
          </span>
          <button
            onClick={() => decide(armed)}
            disabled={busy}
            className="font-bold text-hgl-blue underline disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Yes'}
          </button>
          <button onClick={() => setArmed(null)} disabled={busy} className="text-gray-500 underline">
            cancel
          </button>
        </p>
      )}
      {error && <p className="text-red-700">{error}</p>}
    </div>
  )
}
