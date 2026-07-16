'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Parent reschedule (Phase 7d §8, incl. the July 15 pick-from-offered-slots
// addition). ≥24h: the portal offers 2–3 pre-approved replacement times to
// tap and the move completes instantly — the parent only ever sees the
// offered options, never the tutor's calendar (no-self-booking). If nothing
// fits, or inside 24h (the $40/hour policy), it falls back to the free-text
// request the Ops Director handles by hand. §8: never a wall — the human
// path is always on screen.

type Slot = { starts_at: string; ends_at: string }

export default function RescheduleRequest({
  sessionId,
  startsAt,
  alreadyRequested,
  timezone,
  contactEmail,
  contactPhone,
}: {
  sessionId: string
  startsAt: string
  alreadyRequested: boolean
  timezone: string
  contactEmail: string
  contactPhone: string
}) {
  const [mode, setMode] = useState<'closed' | 'loading' | 'pick' | 'form' | 'sent' | 'moved'>(
    alreadyRequested ? 'sent' : 'closed'
  )
  const [slots, setSlots] = useState<Slot[]>([])
  const [confirming, setConfirming] = useState<Slot | null>(null)
  const [movedTo, setMovedTo] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const hoursAway = (new Date(startsAt).getTime() - Date.now()) / 3600_000
  const late = hoursAway < 24

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

  async function post(payload: Record<string, unknown>) {
    return fetch('/api/portal/tutoring-family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, ...payload }),
    })
  }

  async function open() {
    setError('')
    if (late) {
      setMode('form') // inside 24h: $40/hr policy — request path only
      return
    }
    setMode('loading')
    try {
      const res = await post({ action: 'offer_slots' })
      const json = res.ok ? await res.json() : { slots: [] }
      if (Array.isArray(json.slots) && json.slots.length > 0) {
        setSlots(json.slots)
        setMode('pick')
      } else {
        setMode('form') // nothing offerable — human path
      }
    } catch {
      setMode('form')
    }
  }

  async function pick(slot: Slot) {
    setBusy(true)
    setError('')
    const res = await post({ action: 'pick_slot', starts_at: slot.starts_at })
    setBusy(false)
    if (res.ok) {
      const json = await res.json()
      setMovedTo(json.new_starts_at ?? slot.starts_at)
      setMode('moved')
      router.refresh()
    } else if (res.status === 409) {
      // Someone got there first — re-offer.
      setConfirming(null)
      setError('That time just became unavailable — here are fresh options.')
      await open()
    } else {
      setConfirming(null)
      setError("That didn't go through — try again, or just get in touch and we'll move it for you.")
    }
  }

  async function submitRequest() {
    setBusy(true)
    setError('')
    const res = await post({ action: 'reschedule_request', note })
    setBusy(false)
    if (res.ok) {
      setMode('sent')
      router.refresh()
    } else {
      setError("That didn't go through — try again, or just reply to any of our emails.")
    }
  }

  const humanLine = (
    <span className="block text-gray-500">
      None of these work?{' '}
      <button onClick={() => setMode('form')} className="text-hgl-blue underline">
        tell us what would
      </button>{' '}
      or get in touch — <a href={`mailto:${contactEmail}`} className="text-hgl-blue underline">{contactEmail}</a> ·{' '}
      {contactPhone} — and we&apos;ll figure it out.
    </span>
  )

  if (mode === 'moved') {
    return (
      <span className="text-xs text-green-700 font-semibold">
        all set — moved to {movedTo ? fmt(movedTo) : 'the new time'}; confirmation email on its way
      </span>
    )
  }

  if (mode === 'sent') {
    return <span className="text-xs text-amber-700 font-semibold">change requested — we&apos;re on it</span>
  }

  if (mode === 'closed') {
    return (
      <button onClick={open} className="text-xs text-hgl-blue underline">
        request a change…
      </button>
    )
  }

  if (mode === 'loading') {
    return <span className="text-xs text-gray-400">checking available times…</span>
  }

  if (mode === 'pick') {
    return (
      <span className="block w-full mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-xs space-y-1.5">
        <span className="block text-gray-600">
          Good news — these times are open with your tutor. Tap one and the change happens right
          away (free with this much notice):
        </span>
        {confirming ? (
          <span className="block space-y-1.5">
            <span className="block font-semibold text-hgl-slate">
              Move the session to {fmt(confirming.starts_at)}?
            </span>
            <span className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => pick(confirming)}
                className="bg-hgl-slate text-white rounded px-3 py-1 font-semibold disabled:opacity-50"
              >
                {busy ? 'Moving…' : 'Yes, move it'}
              </button>
              <button disabled={busy} onClick={() => setConfirming(null)} className="text-gray-500 underline">
                back
              </button>
            </span>
          </span>
        ) : (
          <span className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <button
                key={s.starts_at}
                onClick={() => setConfirming(s)}
                className="border border-hgl-slate text-hgl-slate rounded px-2.5 py-1 font-semibold hover:bg-hgl-slate hover:text-white transition"
              >
                {fmt(s.starts_at)}
              </button>
            ))}
          </span>
        )}
        {humanLine}
        <span className="block">
          <button onClick={() => setMode('closed')} className="text-gray-500 underline">
            never mind
          </button>
        </span>
        {error && <span className="block text-red-600 font-semibold">{error}</span>}
      </span>
    )
  }

  // mode === 'form' — the free-text request path (fallback + the <24h case)
  return (
    <span className="block w-full mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-xs space-y-1.5">
      {late ? (
        <span className="block text-amber-800">
          This session is less than 24 hours away, so per our scheduling policy a change carries a{' '}
          <strong>$40/hour reschedule fee</strong> (the tutor is already booked for the slot). Send
          the request anyway and we&apos;ll sort out the details — emergencies are always our call to
          make together, so don&apos;t hesitate to get in touch.
        </span>
      ) : (
        <span className="block text-gray-600">
          Plenty of notice — this change is free. Tell us what works better and we&apos;ll confirm the
          new time, or reach us directly at{' '}
          <a href={`mailto:${contactEmail}`} className="text-hgl-blue underline">{contactEmail}</a> · {contactPhone}.
        </span>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What would work better? (days, times — anything helps)"
        className="w-full border border-gray-300 rounded p-1.5"
      />
      <span className="flex gap-2">
        <button
          disabled={busy}
          onClick={submitRequest}
          className="bg-hgl-slate text-white rounded px-3 py-1 font-semibold disabled:opacity-50"
        >
          Send request
        </button>
        <button onClick={() => setMode('closed')} className="text-gray-500 underline">
          cancel
        </button>
      </span>
      {error && <span className="block text-red-600 font-semibold">{error}</span>}
    </span>
  )
}
