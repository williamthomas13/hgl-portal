'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// Per-class calendar landing page — the target of every "Download the course
// calendar" email button. Offers Google subscription, Apple/ICS, and PDF.

type Session = {
  id: string
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

type ClassInfo = {
  id: string
  class_type: string
  default_location: string | null
  schools: { nickname: string } | null
  sessions: Session[] | null
}

import { formatDateFull as formatDate } from '../../../utils/dates'

function formatTime(t: string | null) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

export default function ClassCalendarPage() {
  const params = useParams()
  const classId = params.id as string
  const [info, setInfo] = useState<ClassInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchClass() {
      // Sanitized server payload — the browser has no DB access (Phase 3 RLS).
      try {
        const response = await fetch(`/api/class-info/${classId}`)
        if (response.ok) setInfo((await response.json()) as ClassInfo)
      } catch {
        // fall through to "Class not found"
      }
      setLoading(false)
    }
    if (classId) fetchClass()
  }, [classId])

  if (loading) return <div className="p-10 text-center">Loading calendar...</div>
  if (!info) return <div className="p-10 text-center">Class not found.</div>

  const label = `${info.schools?.nickname ?? 'HGL'} — ${info.class_type}`
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const icsPath = `/api/classes/${classId}/calendar.ics`
  const icsUrl = `${origin}${icsPath}`
  const webcalUrl = icsUrl.replace(/^https?:\/\//, 'webcal://')
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
  const sessions = [...(info.sessions ?? [])].sort((a, b) =>
    a.session_date.localeCompare(b.session_date)
  )

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        <h1 className="text-2xl font-bold text-hgl-slate mb-1">Course calendar</h1>
        <h2 className="text-lg text-gray-600 font-semibold mb-6">{label}</h2>

        <div className="grid grid-cols-1 gap-3 mb-8">
          <a
            href={googleUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-center bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition"
          >
            Add to Google Calendar
          </a>
          <a
            href={webcalUrl}
            className="block text-center bg-hgl-slate text-white font-bold py-3 px-4 rounded-md hover:opacity-90 transition"
          >
            Add to Apple Calendar
          </a>
          <div className="grid grid-cols-2 gap-3">
            <a
              href={`${icsPath}?download=1`}
              className="block text-center border-2 border-hgl-slate text-hgl-slate font-bold py-2 px-4 rounded-md hover:bg-gray-50 transition"
            >
              Download .ics
            </a>
            <a
              href={`/api/classes/${classId}/schedule.pdf`}
              className="block text-center border-2 border-hgl-slate text-hgl-slate font-bold py-2 px-4 rounded-md hover:bg-gray-50 transition"
            >
              Download PDF schedule
            </a>
          </div>
          <p className="text-xs text-gray-500 text-center">
            Google and Apple buttons subscribe to the calendar — schedule changes update
            automatically. Downloads are a one-time snapshot.
          </p>
        </div>

        <h3 className="font-semibold text-hgl-slate mb-3">Sessions</h3>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Session dates to be announced.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const start = formatTime(s.start_time)
              const end = formatTime(s.end_time)
              const loc = s.location ?? info.default_location
              return (
                <li key={s.id} className="text-sm bg-gray-50 rounded px-3 py-2">
                  <strong>{formatDate(s.session_date)}</strong>
                  {start && ` · ${start}${end ? ` – ${end}` : ''}`}
                  {loc && ` · ${loc}`}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
