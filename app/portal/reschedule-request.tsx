'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Parent reschedule request (Phase 7d §8): the parent asks, the Ops
// Director makes the actual move. ≥24h notice = free per the signed policy;
// inside 24h the $40/hour terms show BEFORE sending — and the copy offers
// the human path instead of a dead end (§8: never a wall).

export default function RescheduleRequest({
  sessionId,
  startsAt,
  alreadyRequested,
}: {
  sessionId: string
  startsAt: string
  alreadyRequested: boolean
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<'idle' | 'sent' | 'error'>(alreadyRequested ? 'sent' : 'idle')
  const router = useRouter()

  const hoursAway = (new Date(startsAt).getTime() - Date.now()) / 3600_000
  const late = hoursAway < 24

  if (state === 'sent') {
    return <span className="text-xs text-amber-700 font-semibold">change requested — we&apos;re on it</span>
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-hgl-blue underline">
        request a change…
      </button>
    )
  }

  async function submit() {
    setBusy(true)
    const res = await fetch('/api/portal/tutoring-family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reschedule_request', session_id: sessionId, note }),
    })
    setBusy(false)
    if (res.ok) {
      setState('sent')
      router.refresh()
    } else {
      setState('error')
    }
  }

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
          new time.
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
          onClick={submit}
          className="bg-hgl-slate text-white rounded px-3 py-1 font-semibold disabled:opacity-50"
        >
          Send request
        </button>
        <button onClick={() => setOpen(false)} className="text-gray-500 underline">
          cancel
        </button>
      </span>
      {state === 'error' && (
        <span className="block text-red-600 font-semibold">
          That didn&apos;t go through — try again, or just reply to any of our emails.
        </span>
      )}
    </span>
  )
}
