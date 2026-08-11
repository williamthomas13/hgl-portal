'use client'

import { useState } from 'react'

// PL-299 → PL-323B: the family's continue-or-stop decision on an hours
// block, made in the signed-in portal (NO tokenized link, by design — the
// email points here). "Continue tutoring" opens a CHOOSER — 5 · 10 · 15
// more hours (a new block at the provenance-correct post-class rate) or
// "until I cancel" (the standard monthly plan) — a family that bought a
// block never commits to open-ended billing with one click. After the
// choice the portal reports the reservation outcome plainly. Inline
// confirm, never modal.

type Choice = '5' | '10' | '15' | 'monthly'

export default function BlockConfirmControl({
  engagementId,
  state,
  studentFirst,
  remaining,
  purchased,
  rate1to9,
  rate10plus,
}: {
  engagementId: string
  state: string | null
  studentFirst: string
  remaining: number
  purchased: number
  /** PL-322/PL-323D: the provenance-correct continuing rates. */
  rate1to9: number
  rate10plus: number
}) {
  const [localState, setLocalState] = useState(state)
  const [choosing, setChoosing] = useState(false)
  const [armed, setArmed] = useState<Choice | 'declined' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<{ kind: 'reserved'; sessions: string[] } | { kind: 'staff' } | null>(null)

  if (localState === 'confirmed') {
    return (
      <div className="text-xs mt-2 bg-green-50 border border-green-200 rounded p-2 text-green-800 space-y-1">
        <p>You&apos;ve confirmed — {studentFirst}&apos;s tutoring continues. Nothing else to do.</p>
        {outcome?.kind === 'reserved' && (
          <div>
            <p className="font-semibold">These times are reserved with the same tutor:</p>
            <ul className="list-disc pl-4">
              {outcome.sessions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {outcome?.kind === 'staff' && (
          <p>
            We couldn&apos;t auto-reserve the continuing times (a conflict on the calendar) — our
            team has been alerted and will figure it out with you. Nothing needed from you.
          </p>
        )}
      </div>
    )
  }
  if (localState === 'declined') {
    return (
      <div className="text-xs mt-2 bg-gray-50 border border-gray-200 rounded p-2 text-gray-600">
        You&apos;ve chosen to stop when the purchased hours are used up — nothing bills past them,
        and any sessions past the hours come off the calendar. Changed your mind? Just reply to
        any of our emails.
      </div>
    )
  }
  if (localState !== 'asked') return null

  async function decide(decision: 'confirmed' | 'declined', choice?: Choice) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/portal/block-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, decision, choice }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setError(json.error ?? 'That didn’t save — try again or reply to our email.')
      else {
        if (json.outcome === 'reserved') setOutcome({ kind: 'reserved', sessions: json.sessions ?? [] })
        else if (json.outcome === 'staff') setOutcome({ kind: 'staff' })
        setLocalState(decision)
      }
    } catch {
      setError('That didn’t save — try again or reply to our email.')
    } finally {
      setBusy(false)
      setArmed(null)
      setChoosing(false)
    }
  }

  const rate = (c: Choice) => (c === '10' || c === '15' ? rate10plus : rate1to9)
  const choiceLabel = (c: Choice) =>
    c === 'monthly' ? `Until I cancel — monthly at $${rate1to9}/hr` : `${c} more hours at $${rate(c)}/hr`

  return (
    <div className="text-xs mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-amber-900 space-y-1.5">
      <p>
        <strong>
          {studentFirst} has {remaining} of {purchased} purchased hours left.
        </strong>{' '}
        When they&apos;re used up, tutoring can continue — same tutor, same schedule — or the
        sessions stop (and come off the calendar) when the hours do. It&apos;s your call:
      </p>
      {!choosing && armed === null && (
        <p className="flex flex-wrap gap-2">
          <button
            onClick={() => setChoosing(true)}
            disabled={busy}
            className="bg-hgl-blue text-white font-bold rounded px-3 py-1.5 disabled:opacity-50"
          >
            Continue tutoring
          </button>
          <button
            onClick={() => setArmed('declined')}
            disabled={busy}
            className="border border-gray-300 bg-white text-gray-700 rounded px-3 py-1.5 disabled:opacity-50"
          >
            Stop when the hours run out
          </button>
        </p>
      )}
      {choosing && armed === null && (
        <div className="space-y-1">
          <p className="font-semibold">How would you like to continue?</p>
          <p className="flex flex-wrap gap-2">
            {(['5', '10', '15', 'monthly'] as Choice[]).map((c) => (
              <button
                key={c}
                onClick={() => setArmed(c)}
                disabled={busy}
                className="border border-hgl-blue bg-white text-hgl-blue font-semibold rounded px-3 py-1.5 disabled:opacity-50"
              >
                {choiceLabel(c)}
              </button>
            ))}
            <button onClick={() => setChoosing(false)} disabled={busy} className="text-gray-500 underline">
              back
            </button>
          </p>
          <p className="text-amber-800">
            We&apos;ll try to reserve the continuing times with {studentFirst}&apos;s tutor right
            away — if there&apos;s a conflict, our team steps in and sorts it out with you.
          </p>
        </div>
      )}
      {armed !== null && (
        <p className="flex flex-wrap items-center gap-2">
          <span>
            {armed === 'declined'
              ? 'Stop the sessions when the hours run out — confirm?'
              : `${choiceLabel(armed)} — confirm?`}
          </span>
          <button
            onClick={() => (armed === 'declined' ? decide('declined') : decide('confirmed', armed))}
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
