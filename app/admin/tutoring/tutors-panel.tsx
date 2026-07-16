'use client'

import { useState } from 'react'
import { supabase } from '../../utils/supabase'
import { TimezoneSelect } from '../ui'
import { WEEKDAYS } from './types'
import type { OfferWindowUI, Subject, Tutor } from './types'

// Tutor management (Phase 7a §2/§3): tutors ARE instructors — this panel
// flips the tutoring flag on an instructors row and fills in the tutoring
// profile (subjects, timezone, calendar id, default location). Matching
// notes live in tutor_notes (staff-only table) so a tutor reading their own
// instructors row never sees them.

export default function TutorsPanel({
  tutors,
  subjects,
  notes,
  onChange,
}: {
  tutors: Tutor[]
  subjects: Subject[]
  notes: Record<string, string>
  onChange: () => void
}) {
  const [editing, setEditing] = useState<Tutor | null>(null)
  const [message, setMessage] = useState('')

  async function toggleActive(t: Tutor) {
    const { error } = await supabase
      .from('instructors')
      .update({ tutoring_active: !t.tutoring_active })
      .eq('id', t.id)
    if (error) setMessage('Error: ' + error.message)
    else onChange()
  }

  const active = tutors.filter((t) => t.tutoring_active)
  const inactive = tutors.filter((t) => !t.tutoring_active)

  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-500">
        Tutors are the same people as instructors — turning tutoring on here makes them schedulable
        for 1-on-1 students. Their Google Workspace address is where sessions get pushed; they
        keep blocking their availability in Google Calendar as always.
      </p>

      {active.length > 0 && (
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              {['Tutor', 'Subjects', 'Timezone', 'Offer windows', 'Default location', 'Matching notes', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {active.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50 transition align-top">
                <td className="px-3 py-2">
                  <div className="font-semibold text-hgl-slate">{t.name ?? '—'}</div>
                  <div className="text-xs text-hgl-blue">{t.email}</div>
                  {t.google_calendar_id && (
                    <div className="text-xs text-gray-400">cal: {t.google_calendar_id}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600 max-w-48">
                  {t.subjects.length ? t.subjects.join(', ') : <span className="italic text-gray-400">none set</span>}
                </td>
                <td className="px-3 py-2 text-gray-600">{t.timezone}</td>
                <td className="px-3 py-2 text-gray-600 max-w-44">
                  {(t.offer_windows ?? []).length > 0 ? (
                    <span className="text-xs">
                      {t.offer_windows.map((w) => `${WEEKDAYS[w.weekday - 1]} ${w.start_time}–${w.end_time}`).join(' · ')}
                    </span>
                  ) : (
                    <span className="italic text-gray-400 text-xs">session hours ±2h (default)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600 max-w-40 truncate">{t.default_location ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600 max-w-56">
                  <span className="line-clamp-2">{notes[t.id] || <span className="italic text-gray-400">—</span>}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(t)} className="text-xs text-hgl-blue underline mr-3">
                    edit
                  </button>
                  <button onClick={() => toggleActive(t)} className="text-xs text-gray-500 underline">
                    stop tutoring
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {inactive.length > 0 && (
        <div className="text-xs text-gray-500">
          Not tutoring:{' '}
          {inactive.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ' · '}
              {t.name ?? t.email}{' '}
              <button onClick={() => toggleActive(t)} className="text-hgl-blue underline">
                enable
              </button>
            </span>
          ))}
        </div>
      )}

      {editing && (
        <TutorEditor
          tutor={editing}
          subjects={subjects}
          initialNotes={notes[editing.id] ?? ''}
          onClose={(changed) => {
            setEditing(null)
            if (changed) onChange()
          }}
        />
      )}

      {message && <div className="p-3 rounded bg-red-100 text-red-700 font-semibold text-center">{message}</div>}
    </div>
  )
}

function TutorEditor({
  tutor,
  subjects,
  initialNotes,
  onClose,
}: {
  tutor: Tutor
  subjects: Subject[]
  initialNotes: string
  onClose: (changed: boolean) => void
}) {
  const [picked, setPicked] = useState<string[]>(tutor.subjects)
  const [timezone, setTimezone] = useState(tutor.timezone)
  const [calendarId, setCalendarId] = useState(tutor.google_calendar_id ?? '')
  const [location, setLocation] = useState(tutor.default_location ?? '')
  const [windows, setWindows] = useState<OfferWindowUI[]>(tutor.offer_windows ?? [])
  const [notes, setNotes] = useState(initialNotes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (windows.some((w) => !w.start_time || !w.end_time || w.end_time <= w.start_time)) {
      setError('Each offer window needs a start time before its end time.')
      return
    }
    setSaving(true)
    setError('')
    const { error: e1 } = await supabase
      .from('instructors')
      .update({
        subjects: picked,
        timezone: timezone || 'America/Denver',
        google_calendar_id: calendarId.trim() || null,
        default_location: location.trim() || null,
        offer_windows: windows,
      })
      .eq('id', tutor.id)
    const { error: e2 } = await supabase
      .from('tutor_notes')
      .upsert({ instructor_id: tutor.id, notes: notes.trim() || null, updated_at: new Date().toISOString() })
    if (e1 || e2) {
      setError('Error: ' + (e1?.message ?? e2?.message))
      setSaving(false)
      return
    }
    onClose(true)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-hgl-slate">
          {tutor.name ?? tutor.email} — tutoring profile
        </h3>

        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Subjects</label>
          <div className="flex flex-wrap gap-2">
            {subjects.map((s) => (
              <label
                key={s.id}
                className={`px-2 py-1 rounded border cursor-pointer text-xs ${
                  picked.includes(s.name)
                    ? 'bg-hgl-slate text-white border-hgl-slate'
                    : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={picked.includes(s.name)}
                  onChange={() =>
                    setPicked((p) => (p.includes(s.name) ? p.filter((x) => x !== s.name) : [...p, s.name]))
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Timezone</label>
          <TimezoneSelect value={timezone} onChange={setTimezone} />
        </div>

        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">
            Google calendar id (blank = their primary calendar, i.e. their email)
          </label>
          <input
            type="text"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            placeholder={tutor.email}
            className="w-full border border-gray-300 rounded-md p-2"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">
            Offer windows — when the portal may offer this tutor&apos;s open times to families
            rescheduling a session themselves (their local time). Leave empty to default to their
            existing session hours ±2 hours. Families only ever see the 2–3 offered times, never
            the calendar.
          </label>
          <div className="space-y-1.5">
            {windows.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={w.weekday}
                  onChange={(e) =>
                    setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))
                  }
                  className="border border-gray-300 rounded p-1.5 text-sm"
                >
                  {WEEKDAYS.map((d, di) => (
                    <option key={d} value={di + 1}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={w.start_time}
                  onChange={(e) =>
                    setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))
                  }
                  className="border border-gray-300 rounded p-1.5 text-sm"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="time"
                  value={w.end_time}
                  onChange={(e) =>
                    setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))
                  }
                  className="border border-gray-300 rounded p-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}
                  className="text-xs text-gray-500 underline"
                >
                  remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setWindows((ws) => [...ws, { weekday: 1, start_time: '15:00', end_time: '19:00' }])
              }
              className="text-xs text-hgl-blue underline"
            >
              + add window
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">
            Default location (online link or address — prefills new student schedules)
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="https://meet.google.com/… or the SLC office"
            className="w-full border border-gray-300 rounded-md p-2"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">
            Matching notes (staff-only — personality, style, who they click with; tutors never see this)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-md p-2"
          />
        </div>

        {error && <div className="p-2 rounded bg-red-100 text-red-700 text-sm font-semibold">{error}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={() => onClose(false)} className="py-2 px-4 rounded border border-gray-300 text-gray-600">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-hgl-slate text-white py-2 px-4 rounded hover:opacity-90 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
