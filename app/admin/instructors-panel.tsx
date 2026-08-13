'use client'

import { useState } from 'react'
import { supabase } from '../utils/supabase'
import InstructorEditor from './instructor-editor'
import { ConfirmAction } from './tutoring/confirm'

// Instructor management (PHASE4_SPEC §5/§10). PL-226: THIS is the place to
// add and edit instructors (instructors = tutors — one table, one profile).
// The edit button opens the full profile editor (identity + phone + the
// whole tutoring profile); the 1-on-1→Tutors panel is a read-only
// representation + finder that points here.

export type Instructor = {
  id: string
  email: string
  name: string | null
  phone: string | null
  default_meeting_link: string | null
  /** PL-327: per-type email preferences (absorbed the Class-emails toggle). */
  pref_notes_reminders: 'on' | 'weekly' | 'off'
  pref_class_digests: 'on' | 'weekly' | 'off'
  pref_fyi_copies: boolean
  /** PL-176: false = hidden from active pickers/rosters; history intact. */
  active: boolean
}

export default function InstructorsPanel({
  instructors,
  onChange,
}: {
  instructors: Instructor[]
  onChange: () => void
}) {
  const [message, setMessage] = useState('')
  // PL-176: Active / Inactive tabs (active default).
  const [view, setView] = useState<'active' | 'inactive'>('active')
  // PL-226: the full-profile editor — 'new' opens create mode.
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const activeRows = instructors.filter((i) => i.active)
  const inactiveRows = instructors.filter((i) => !i.active)
  const visible = view === 'active' ? activeRows : inactiveRows

  // PL-176: "Remove" read as delete — scary and wrong for people who may
  // return. Inactive = hidden from new scheduling pickers, history (classes,
  // sessions, timecards) untouched, reversible.
  async function handleMakeInactive(i: Instructor) {
    // Going inactive turns their preference-able comms off through the
    // existing cascade (digest sends stop, upcoming session events removed).
    if (i.pref_class_digests !== 'off' || i.pref_fyi_copies) {
      const res = await fetch('/api/admin/instructor-comms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructorId: i.id, enabled: false }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setMessage(json.error ?? 'Could not turn their comms off — nothing changed.')
        return
      }
    }
    const { error } = await supabase.from('instructors').update({ active: false }).eq('id', i.id)
    if (error) setMessage('Error: ' + error.message)
    else onChange()
  }

  async function handleMakeActive(i: Instructor) {
    const { error } = await supabase.from('instructors').update({ active: true }).eq('id', i.id)
    if (error) setMessage('Error: ' + error.message)
    else {
      setMessage(
        `${i.name ?? i.email} is active again — they appear in scheduling pickers. Class emails + calendar stay OFF until you turn them on.`
      )
      onChange()
    }
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-6">
        Online classes created with a blank location auto-fill the instructor&apos;s default
        meeting link. Instructors sign in at /login with their email to see their classes and
        rosters.
      </p>

      {/* PL-176: Active / Inactive tabs */}
      <div className="flex rounded-md overflow-hidden border border-gray-300 w-fit mb-4 text-xs font-semibold">
        {(['active', 'inactive'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 ${view === v ? 'bg-hgl-slate text-white' : 'bg-white text-gray-600'}`}
          >
            {v === 'active' ? `Active (${activeRows.length})` : `Inactive (${inactiveRows.length})`}
          </button>
        ))}
      </div>
      {view === 'inactive' && visible.length === 0 && (
        <p className="text-sm text-gray-500 italic mb-4">Nobody is inactive.</p>
      )}
      {visible.length > 0 && (
        /* PL-318: scroll container + a real Actions column — the buttons were
           rendering past the card border (PL-275 overflow pattern). */
        <div className="overflow-x-auto mb-6">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              {/* PL-342: five columns that FIT — the meeting link rides under
                  the email (a width hog gone), phone and prefs never wrap, so
                  Actions is plainly on-card at normal widths. */}
              {['Name', 'Email & meeting link', 'Phone', 'Email prefs', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {visible.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50 transition text-sm">
                <td className="px-4 py-2 font-semibold text-hgl-slate whitespace-nowrap">{i.name ?? '—'}</td>
                <td className="px-4 py-2">
                  <a href={`mailto:${i.email}`} className="text-hgl-blue hover:underline">
                    {i.email}
                  </a>
                  {/* PL-342: the default Zoom link lives under the email now. */}
                  {i.default_meeting_link && (
                    <span
                      className="block text-[11px] text-gray-400 truncate max-w-64"
                      title={i.default_meeting_link}
                    >
                      {i.default_meeting_link}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                  {i.phone ? (
                    <a href={`tel:${i.phone.replace(/[^\d+]/g, '')}`} className="text-hgl-blue hover:underline">
                      {i.phone}
                    </a>
                  ) : (
                    <span className="italic text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs whitespace-nowrap">
                  {/* PL-327/342: ONE line of compact chips — the full
                      three-control detail lives in the profile editor; tutors
                      self-serve the same three from their portal. */}
                  <span
                    className="inline-flex items-center gap-1"
                    title="Session-note reminders · class digests+pings · FYI copies of family emails. Change them in the profile editor. T5 timecards, T3-T schedule changes, and SUB coverage stay mandatory."
                  >
                    {(
                      [
                        ['notes', i.pref_notes_reminders],
                        ['digests', i.pref_class_digests],
                        ['FYI', i.pref_fyi_copies ? 'on' : 'off'],
                      ] as const
                    ).map(([label, value]) => (
                      <span
                        key={label}
                        className={`inline-block px-1.5 py-0.5 rounded-full border text-[10px] leading-none ${
                          value === 'off'
                            ? 'bg-gray-100 border-gray-200 text-gray-400'
                            : 'bg-white border-gray-300 text-gray-600'
                        }`}
                      >
                        {label} {value}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-2 text-left whitespace-nowrap">
                  {/* PL-226: the full profile (identity + tutoring) edits here. */}
                  <button
                    onClick={() => setEditing(i.id)}
                    className="text-xs text-hgl-blue underline mr-3"
                    title="Name, email, phone, subjects, timezone, offer windows, pay — the whole profile"
                  >
                    edit profile
                  </button>
                  {i.active ? (
                    <ConfirmAction
                      label="Make inactive"
                      message={`Make ${i.name ?? i.email} inactive? Hidden from new scheduling pickers; every class, session, and timecard stays; their class emails + calendar turn off. Reversible from the Inactive tab.`}
                      confirmLabel="Yes, make inactive"
                      className="text-gray-600 text-xs hover:underline"
                      confirmClassName="text-red-700 text-xs font-semibold underline"
                      onConfirm={() => handleMakeInactive(i)}
                    />
                  ) : (
                    <button onClick={() => handleMakeActive(i)} className="text-green-700 text-xs font-semibold hover:underline">
                      Make active
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* PL-226: adding opens the SAME full editor — every field available
          from the first save, no prompt() hacks anywhere. */}
      <button
        onClick={() => setEditing('new')}
        className="bg-hgl-slate text-white py-2 px-4 rounded text-sm font-semibold hover:opacity-90"
      >
        Add an instructor
      </button>

      {editing && (
        <InstructorEditor
          instructorId={editing === 'new' ? null : editing}
          onClose={(changed) => {
            setEditing(null)
            if (changed) {
              setMessage('Saved.')
              onChange()
            }
          }}
        />
      )}

      {message && (
        <div className={`mt-4 p-3 rounded text-center text-sm font-semibold ${
          message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}>
          {message}
        </div>
      )}
    </div>
  )
}
