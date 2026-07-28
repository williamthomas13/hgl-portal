'use client'

import { useEffect, useState } from 'react'

// PL-132: the tutor's upcoming list, with the three things Scarlett asked
// for after using it on a phone:
//   1. A raw https://meet.google.com/… URL is clutter that wraps badly — it
//      becomes a labeled Join button.
//   2. Each row's student opens their session-note history. It is the same
//      history a substitute receives at handoff (PL-111/112): the tutor's
//      handoff file is also their own memory, and it should be one tap from
//      the schedule rather than a hunt.
//   3. Class/workshop sessions are visually distinct from 1-on-1. They are
//      different prep and a different pay type — the timecard already
//      distinguishes them (PL-103), so the schedule should too.

export type UpcomingRow = {
  id: string
  kind: 'one_on_one' | 'class'
  startsAt: string
  endsAt: string
  /** Student for 1-on-1; class label for a class/workshop. */
  who: string
  subject: string
  /** Free-text location; a meet/zoom URL is rendered as a Join button. */
  location: string | null
  /** Only 1-on-1 rows can open a note history. */
  studentId: string | null
  /** PL-179: set when this session is COVERED — someone else's student is
   *  where autopilot fails, so the context finds the substitute here. */
  covering?: { from: string; note: string | null } | null
}

type NoteRow = { startsAt: string | null; note: string; nextTime: string | null }

const MEETING_URL = /^https?:\/\/\S+$/i

// PL-210: Join is live from 30 minutes before the start through 30 minutes
// after the end. Outside that window the button goes muted (not hidden — the
// online/in-person distinction is information the tutor should still see).
const JOIN_WINDOW_MS = 30 * 60 * 1000

function fmt(iso: string, opts: Intl.DateTimeFormatOptions, tz: string) {
  return new Date(iso).toLocaleString('en-US', { timeZone: tz, ...opts })
}

export default function UpcomingSessions({ rows, timezone }: { rows: UpcomingRow[]; timezone: string }) {
  const [openStudent, setOpenStudent] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, NoteRow[] | 'loading' | 'error'>>({})
  // PL-210: re-check the join window each minute so the button goes live
  // while the page sits open — no reload needed right before a session.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  async function toggleNotes(studentId: string) {
    if (openStudent === studentId) {
      setOpenStudent(null)
      return
    }
    setOpenStudent(studentId)
    if (notes[studentId] && notes[studentId] !== 'error') return
    setNotes((n) => ({ ...n, [studentId]: 'loading' }))
    try {
      const res = await fetch('/api/portal/tutoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'student_notes', student_id: studentId }),
      })
      const json = await res.json().catch(() => ({}))
      setNotes((n) => ({ ...n, [studentId]: res.ok ? (json.notes ?? []) : 'error' }))
    } catch {
      setNotes((n) => ({ ...n, [studentId]: 'error' }))
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 italic">No upcoming sessions on the books.</p>
  }

  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {rows.map((s) => {
        const isMeetingUrl = Boolean(s.location && MEETING_URL.test(s.location.trim()))
        const history = s.studentId ? notes[s.studentId] : undefined
        return (
          <li key={`${s.kind}-${s.id}`} className="py-2">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
              <span className="font-semibold text-hgl-slate">
                {fmt(s.startsAt, { weekday: 'short', month: 'short', day: 'numeric' }, timezone)}
              </span>
              <span>
                {fmt(s.startsAt, { hour: 'numeric', minute: '2-digit' }, timezone)}–
                {fmt(s.endsAt, { hour: 'numeric', minute: '2-digit' }, timezone)}
              </span>
              {/* PL-132: class vs 1-on-1, matching the timecard's work-type split. */}
              {s.kind === 'class' && (
                <span className="text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">
                  Class
                </span>
              )}
              {/* PL-179: a covered session announces itself — same visual
                  weight as the Class badge, one glance. */}
              {s.covering && (
                <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
                  Covering for {s.covering.from}
                </span>
              )}
              <span className="text-gray-600">
                {s.studentId ? (
                  <button
                    type="button"
                    onClick={() => toggleNotes(s.studentId!)}
                    className="font-semibold text-hgl-blue underline hover:text-hgl-slate"
                  >
                    {s.who}
                  </button>
                ) : (
                  s.who
                )}
                {s.subject ? ` · ${s.subject}` : ''}
              </span>
              {isMeetingUrl ? (
                now >= new Date(s.startsAt).getTime() - JOIN_WINDOW_MS &&
                now <= new Date(s.endsAt).getTime() + JOIN_WINDOW_MS ? (
                  <a
                    href={s.location!.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold bg-hgl-blue text-white rounded px-2.5 py-1 hover:bg-hgl-blue-hover"
                  >
                    Join
                  </a>
                ) : (
                  <span
                    className="text-xs font-bold bg-gray-100 text-gray-400 rounded px-2.5 py-1 cursor-default"
                    title="The Join link goes live 30 minutes before the session"
                  >
                    Join · online
                  </span>
                )
              ) : (
                s.location && <span className="text-gray-400 text-xs truncate max-w-56">{s.location}</span>
              )}
            </div>

            {/* PL-179: the hand-over note's EXISTENCE is visible without a
                tap — short notes render inline; the full handoff bundle
                (note + the student's history) is one anchor away. */}
            {s.covering && (
              <div className="mt-1 ml-1 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-900">
                {s.covering.note ? (
                  <>
                    <span className="font-semibold">{s.covering.from}&apos;s note:</span>{' '}
                    {s.covering.note.length > 180 ? `${s.covering.note.slice(0, 180)}…` : s.covering.note}{' '}
                  </>
                ) : (
                  <span>No hand-over note yet from {s.covering.from}. </span>
                )}
                <a href="#covered-handoff" className="underline font-semibold">
                  full handoff ↓
                </a>
                {s.studentId && (
                  <>
                    {' · '}
                    <button type="button" onClick={() => toggleNotes(s.studentId!)} className="underline font-semibold">
                      {s.who.split(' ')[0]}&apos;s note history
                    </button>
                  </>
                )}
              </div>
            )}

            {s.studentId && openStudent === s.studentId && (
              <div className="mt-2 ml-1 border-l-2 border-gray-200 pl-3 text-xs">
                {history === 'loading' && <p className="text-gray-400">Loading {s.who}&apos;s notes…</p>}
                {history === 'error' && (
                  <p className="text-red-600">
                    Couldn&apos;t load the notes.{' '}
                    <button type="button" onClick={() => toggleNotes(s.studentId!)} className="underline">
                      Try again
                    </button>
                  </p>
                )}
                {Array.isArray(history) && history.length === 0 && (
                  <p className="text-gray-500">No session notes for {s.who} yet.</p>
                )}
                {Array.isArray(history) && history.length > 0 && (
                  <ul className="space-y-1">
                    {history.map((n, i) => (
                      <li key={i} className="text-gray-700">
                        <span className="text-gray-400">
                          {n.startsAt
                            ? fmt(n.startsAt, { month: 'short', day: 'numeric' }, timezone)
                            : '—'}
                          :
                        </span>{' '}
                        {n.note}
                        {n.nextTime && <span className="text-gray-500"> · Next time: {n.nextTime}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
