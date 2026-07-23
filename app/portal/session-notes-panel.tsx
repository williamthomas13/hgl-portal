'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// PL-111: the tutor's session-note surface — short, low-friction, right
// under their sessions. One note per completed session: what we worked on,
// optionally what to pick up next time. Notes land on the student's record
// and are PARENT-VISIBLE on the family portal (the inline hint says so).

export type NoteSession = {
  id: string
  starts_at: string
  studentName: string
  subjectName: string
  note: string | null
  next_time: string | null
}

export default function SessionNotesPanel({
  sessions,
  timezone,
}: {
  sessions: NoteSession[]
  timezone: string
}) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [nextTime, setNextTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  if (sessions.length === 0) return null
  const missing = sessions.filter((s) => !s.note)

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

  function open(s: NoteSession) {
    setOpenId(s.id)
    setNote(s.note ?? '')
    setNextTime(s.next_time ?? '')
    setMessage('')
  }

  async function save(sessionId: string) {
    setBusy(true)
    setMessage('')
    const res = await fetch('/api/portal/tutoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_note', session_id: sessionId, note, next_time: nextTime }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) {
      setMessage('Error: ' + json.error)
      return
    }
    setOpenId(null)
    setMessage('✓ Note saved.')
    router.refresh()
  }

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-purple-400 p-6">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">
        Session notes
        {missing.length > 0 && (
          <span className="ml-2 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
            {missing.length} missing
          </span>
        )}
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        A line or two per session — what you worked on, and anything to pick up next time.
        Families read these on their family portal, so keep them parent-friendly. Your timecard
        can&apos;t be approved while notes are missing.
      </p>
      {message && <p className="text-sm mb-2">{message}</p>}
      <ul className="divide-y divide-gray-100 text-sm">
        {sessions.map((s) => (
          <li key={s.id} id={`note-${s.id}`} className="py-2">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
              <span className="font-semibold text-hgl-slate">{fmt(s.starts_at)}</span>
              <span className="text-gray-600">
                {s.studentName}
                {s.subjectName ? ` · ${s.subjectName}` : ''}
              </span>
              {s.note ? (
                <span className="text-xs text-green-700">note ✓</span>
              ) : (
                <span className="text-xs font-semibold text-amber-700">note missing</span>
              )}
              {openId !== s.id && (
                <button onClick={() => open(s)} className="text-xs text-hgl-blue underline ml-auto">
                  {s.note ? 'edit note' : 'add note…'}
                </button>
              )}
            </div>
            {openId !== s.id && s.note && (
              <p className="text-xs text-gray-600 mt-0.5">
                {s.note}
                {s.next_time && <span className="text-gray-400"> · Next time: {s.next_time}</span>}
              </p>
            )}
            {openId === s.id && (
              <div className="mt-2 space-y-1.5">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="What you worked on (parents will see this)"
                  className="w-full border border-gray-300 rounded p-2 text-sm"
                  autoFocus
                />
                <input
                  type="text"
                  value={nextTime}
                  onChange={(e) => setNextTime(e.target.value)}
                  placeholder="For next time (optional)"
                  className="w-full border border-gray-200 rounded p-1.5 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    disabled={busy || !note.trim()}
                    onClick={() => save(s.id)}
                    className="bg-hgl-slate text-white text-xs font-semibold rounded px-3 py-1.5 disabled:opacity-40"
                  >
                    Save note
                  </button>
                  <button onClick={() => setOpenId(null)} className="text-xs text-gray-500 underline">
                    cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
