'use client'

import { useState } from 'react'

// PL-41 client actions — PL-186: the APPROVE press is a native <form>
// submitting a server action, so it works from first paint (before
// hydration, or with JS off entirely); the outcome renders server-side via
// the redirect. Decline keeps the client flow — it needs a typed note, so
// hydration has long finished by the time anyone presses it.

export default function ConfirmActions({
  token,
  studentFirst,
  approveAction,
}: {
  token: string
  studentFirst: string
  approveAction: (formData: FormData) => Promise<void>
}) {
  const [view, setView] = useState<'idle' | 'declining'>('idle')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'declined' | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function decline() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/tutoring/schedule-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'decline', note: note.trim() || undefined }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? 'Something went wrong — please try again.')
        return
      }
      setDone('declined')
    } catch {
      setError('Something went wrong — please try again, or just reply to our email.')
    } finally {
      setBusy(false)
    }
  }

  if (done === 'declined') {
    return (
      <div className="p-4 rounded bg-blue-50 border border-blue-200 text-hgl-slate text-sm">
        <strong>Got it — we&apos;ll be in touch.</strong> Nothing is locked in; we&apos;ll adjust
        {' '}{studentFirst}&apos;s times and send a fresh schedule to confirm.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {view !== 'declining' ? (
        <>
          <form action={approveAction}>
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="w-full bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50"
            >
              Confirm this schedule
            </button>
          </form>
          <button
            onClick={() => setView('declining')}
            className="w-full text-sm text-hgl-blue underline"
          >
            These times don&apos;t quite work
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            What would work better?
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. Mondays are tough — Tuesdays or Wednesdays after 5 would be great"
            className="block w-full border border-gray-300 rounded-md p-2"
          />
          <div className="flex gap-2">
            <button
              onClick={decline}
              disabled={busy}
              className="bg-hgl-slate text-white font-bold py-2 px-4 rounded-md hover:opacity-90 disabled:opacity-50"
            >
              Send it over
            </button>
            <button onClick={() => setView('idle')} className="py-2 px-4 rounded border border-gray-300 text-gray-600">
              Back
            </button>
          </div>
        </div>
      )}
      {error && <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
    </div>
  )
}
