'use client'

import { useState } from 'react'

// PL-41 client actions: one-tap confirm, or "different times" with a note.

export default function ConfirmActions({ token, studentFirst }: { token: string; studentFirst: string }) {
  const [view, setView] = useState<'idle' | 'declining'>('idle')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'approved' | 'declined' | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function call(action: 'approve' | 'decline') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/tutoring/schedule-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action, note: note.trim() || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again.')
        return
      }
      setDone(action === 'approve' ? 'approved' : 'declined')
    } catch {
      setError('Something went wrong — please try again, or just reply to our email.')
    } finally {
      setBusy(false)
    }
  }

  if (done === 'approved') {
    return (
      <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
        <strong>Locked in — thank you!</strong> A welcome email with calendar links and the PDF
        schedule is on its way, and every session is in your parent portal.
      </div>
    )
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
          <button
            onClick={() => call('approve')}
            disabled={busy}
            className="w-full bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50"
          >
            {busy ? 'Confirming…' : 'Confirm this schedule'}
          </button>
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
              onClick={() => call('decline')}
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
