'use client'

import { useState } from 'react'

// PL-156 client half: one box, one send. The POST is JS-executed behind a
// visible tap, so nothing can send a note by merely opening the link.

export default function CoverageNoteForm({
  token,
  subFirstName,
  studentFirst,
  alreadySent,
}: {
  token: string
  subFirstName: string
  studentFirst: string
  alreadySent: string | null
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    if (!note.trim()) return
    setBusy(true)
    setError('')
    // PL-151: busy resets in a finally; the note stays in the box on failure
    // so nothing anyone typed is ever lost to a bad connection.
    try {
      const res = await fetch('/api/coverage/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, note }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setSent(true)
      else setError(json.error ?? `Something went wrong (the server returned ${res.status}).`)
    } catch {
      setError("Couldn't reach the server — your note is still here. Try again.")
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 p-4">
        <p className="font-semibold text-green-900">Sent to {subFirstName}.</p>
        <p className="text-sm text-green-800 mt-1">
          It&apos;s saved with {studentFirst}&apos;s handoff too, so it&apos;s there when they
          prepare. You can close this page.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {alreadySent && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
          You already sent {subFirstName} a note on{' '}
          {new Date(alreadySent).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
          Anything you send now goes to them as well.
        </p>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={7}
        maxLength={4000}
        autoFocus
        placeholder={`Where ${studentFirst} is stuck, what to bring, anything not to repeat…`}
        className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-hgl-blue"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={send}
        disabled={busy || !note.trim()}
        className="bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-40"
      >
        {busy ? 'Sending…' : `Send to ${subFirstName}`}
      </button>
    </div>
  )
}
