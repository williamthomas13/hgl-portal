'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import {
  MIN_TRACKABLE_MINUTES,
  isPastSession,
  recordStatusLabel,
  type AttendanceRecord,
  type SessionForAttendance,
} from '../utils/attendance'

// Feature B2 attendance UI (docs/COMMS_ATTENDANCE_PARENT_SPEC.md): sessions
// list with per-session state, then a tap-roster — one row per student,
// default Present, chips for Absent / Late / Left early (Late + Left early
// combine; 10+ minutes only), optional minutes stepper and note. Built for a
// phone in a classroom: big targets, one Save all. Writes ride the signed-in
// user's RLS (instructors: own classes; staff: everything), so this same
// component serves the instructor portal and the admin class view.

type RosterEntry = { enrollmentId: string; studentName: string }

type Draft = {
  present: boolean
  late: boolean
  leftEarly: boolean
  minutesLate: number | null
  minutesLeftEarly: number | null
  note: string
}

const DEFAULT_DRAFT: Draft = {
  present: true,
  late: false,
  leftEarly: false,
  minutesLate: null,
  minutesLeftEarly: null,
  note: '',
}

function draftFromRecord(r: AttendanceRecord): Draft {
  return {
    present: r.present,
    late: r.arrived_late,
    leftEarly: r.left_early,
    minutesLate: r.minutes_late,
    minutesLeftEarly: r.minutes_left_early,
    note: r.note ?? '',
  }
}

function MinuteStepper({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (v: number) => void
}) {
  const v = value ?? MIN_TRACKABLE_MINUTES
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-gray-500">{label}</span>
      <button
        type="button"
        onClick={() => onChange(Math.max(MIN_TRACKABLE_MINUTES, v - 5))}
        className="w-7 h-7 rounded border border-gray-300 font-bold"
      >
        −
      </button>
      <span className="w-10 text-center font-semibold">{v}m</span>
      <button type="button" onClick={() => onChange(v + 5)} className="w-7 h-7 rounded border border-gray-300 font-bold">
        +
      </button>
      <button type="button" onClick={() => onChange(v + 15)} className="px-1.5 h-7 rounded border border-gray-300">
        +15
      </button>
    </span>
  )
}

export default function AttendancePanel({
  sessions,
  roster,
  recordedBy,
}: {
  sessions: SessionForAttendance[]
  roster: RosterEntry[]
  recordedBy: string
}) {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}) // key = enrollmentId (for openSession)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const enrollmentIds = useMemo(() => roster.map((r) => r.enrollmentId), [roster])
  const today = new Date().toLocaleDateString('en-CA')
  const pastSessions = useMemo(
    () =>
      [...sessions]
        .filter((s) => isPastSession(s, today))
        .sort((a, b) => b.session_date.localeCompare(a.session_date)),
    [sessions, today]
  )

  const fetchRecords = useCallback(async () => {
    if (enrollmentIds.length === 0) {
      setLoading(false)
      return
    }
    const { data } = await supabase
      .from('attendance_records')
      .select('session_id, enrollment_id, present, arrived_late, left_early, minutes_late, minutes_left_early, note')
      .in('enrollment_id', enrollmentIds)
    setRecords((data as AttendanceRecord[]) ?? [])
    setLoading(false)
  }, [enrollmentIds])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRecords()
  }, [fetchRecords])

  function recordFor(sessionId: string, enrollmentId: string) {
    return records.find((r) => r.session_id === sessionId && r.enrollment_id === enrollmentId) ?? null
  }

  function sessionState(sessionId: string): 'none' | 'partial' | 'complete' {
    const taken = enrollmentIds.filter((id) => recordFor(sessionId, id)).length
    if (taken === 0) return 'none'
    return taken >= enrollmentIds.length ? 'complete' : 'partial'
  }

  function openFor(session: SessionForAttendance) {
    const next: Record<string, Draft> = {}
    for (const entry of roster) {
      const existing = recordFor(session.id, entry.enrollmentId)
      next[entry.enrollmentId] = existing ? draftFromRecord(existing) : { ...DEFAULT_DRAFT }
    }
    setDrafts(next)
    setOpenSession(session.id)
    setMessage('')
  }

  function patchDraft(enrollmentId: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [enrollmentId]: { ...d[enrollmentId], ...patch } }))
  }

  async function saveAll() {
    if (!openSession) return
    setSaving(true)
    setMessage('')
    const rows = roster.map((entry) => {
      const d = drafts[entry.enrollmentId] ?? DEFAULT_DRAFT
      return {
        session_id: openSession,
        enrollment_id: entry.enrollmentId,
        present: d.present,
        arrived_late: d.present && d.late,
        left_early: d.present && d.leftEarly,
        minutes_late: d.present && d.late ? (d.minutesLate ?? MIN_TRACKABLE_MINUTES) : null,
        minutes_left_early: d.present && d.leftEarly ? (d.minutesLeftEarly ?? MIN_TRACKABLE_MINUTES) : null,
        note: d.note.trim() || null,
        recorded_by: recordedBy,
        updated_at: new Date().toISOString(),
      }
    })
    const { error } = await supabase
      .from('attendance_records')
      .upsert(rows, { onConflict: 'session_id,enrollment_id' })
    setSaving(false)
    if (error) {
      setMessage(`⚠ Save failed: ${error.message}`)
      return
    }
    setMessage('✓ Attendance saved.')
    setOpenSession(null)
    fetchRecords()
  }

  if (roster.length === 0) return null

  return (
    <div className="mt-3">
      <h4 className="text-sm font-semibold text-hgl-slate mb-1">Attendance</h4>
      {message && <p className="text-sm mb-2">{message}</p>}
      {loading ? (
        <p className="text-sm text-gray-400 animate-pulse">Loading attendance…</p>
      ) : pastSessions.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          Attendance opens after the first session — nothing to take yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {pastSessions.map((s) => {
            const state = sessionState(s.id)
            const isOpen = openSession === s.id
            const badge =
              state === 'complete'
                ? { text: 'Complete ✓', cls: 'bg-green-100 text-green-700' }
                : state === 'partial'
                  ? { text: 'Partially taken', cls: 'bg-amber-100 text-amber-800' }
                  : { text: 'Not taken', cls: 'bg-gray-200 text-gray-600' }
            return (
              <li key={s.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => (isOpen ? setOpenSession(null) : openFor(s))}
                  className="w-full flex items-center justify-between px-3 py-3 text-sm bg-gray-50 hover:bg-gray-100"
                >
                  <span className="font-semibold text-gray-700">
                    {s.session_date}
                    {s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ''}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${badge.cls}`}>{badge.text}</span>
                </button>

                {isOpen && (
                  <div className="p-3 space-y-3">
                    <p className="text-xs text-gray-400">
                      Everyone starts Present. Late / Left early are for 10+ minutes only — under
                      that, they're simply Present.
                    </p>
                    {roster.map((entry) => {
                      const d = drafts[entry.enrollmentId] ?? DEFAULT_DRAFT
                      const chip = (
                        active: boolean,
                        label: string,
                        onClick: () => void,
                        activeCls: string
                      ) => (
                        <button
                          type="button"
                          onClick={onClick}
                          className={`px-3 py-2 rounded-full text-sm font-semibold border transition ${
                            active ? activeCls : 'bg-white text-gray-500 border-gray-300'
                          }`}
                        >
                          {label}
                        </button>
                      )
                      return (
                        <div key={entry.enrollmentId} className="border-b border-gray-100 pb-3">
                          <p className="font-semibold text-hgl-slate text-sm mb-1.5">{entry.studentName}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {chip(
                              d.present && !d.late && !d.leftEarly,
                              'Present',
                              () => patchDraft(entry.enrollmentId, { ...DEFAULT_DRAFT, note: d.note }),
                              'bg-green-600 text-white border-green-600'
                            )}
                            {chip(
                              !d.present,
                              'Absent',
                              () =>
                                patchDraft(entry.enrollmentId, {
                                  present: false,
                                  late: false,
                                  leftEarly: false,
                                  minutesLate: null,
                                  minutesLeftEarly: null,
                                }),
                              'bg-red-600 text-white border-red-600'
                            )}
                            {chip(
                              d.present && d.late,
                              'Late',
                              () => patchDraft(entry.enrollmentId, { present: true, late: !d.late }),
                              'bg-amber-500 text-white border-amber-500'
                            )}
                            {chip(
                              d.present && d.leftEarly,
                              'Left early',
                              () => patchDraft(entry.enrollmentId, { present: true, leftEarly: !d.leftEarly }),
                              'bg-amber-500 text-white border-amber-500'
                            )}
                          </div>
                          {(d.present && (d.late || d.leftEarly)) && (
                            <div className="flex flex-wrap gap-3 mt-2">
                              {d.late && (
                                <MinuteStepper
                                  label="late"
                                  value={d.minutesLate}
                                  onChange={(v) => patchDraft(entry.enrollmentId, { minutesLate: v })}
                                />
                              )}
                              {d.leftEarly && (
                                <MinuteStepper
                                  label="left early"
                                  value={d.minutesLeftEarly}
                                  onChange={(v) => patchDraft(entry.enrollmentId, { minutesLeftEarly: v })}
                                />
                              )}
                            </div>
                          )}
                          <input
                            type="text"
                            value={d.note}
                            onChange={(e) => patchDraft(entry.enrollmentId, { note: e.target.value })}
                            placeholder="Note (optional, internal — e.g. family emergency)"
                            className="mt-2 w-full border border-gray-200 rounded p-1.5 text-xs"
                          />
                        </div>
                      )
                    })}
                    <button
                      type="button"
                      onClick={saveAll}
                      disabled={saving}
                      className="w-full bg-hgl-blue text-white font-bold py-3 rounded-lg hover:bg-hgl-blue-hover disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save all'}
                    </button>
                  </div>
                )}

                {!isOpen && state !== 'none' && (
                  <ul className="px-3 py-2 text-xs text-gray-500 space-y-0.5">
                    {roster.map((entry) => {
                      const r = recordFor(s.id, entry.enrollmentId)
                      if (!r) return null
                      const label = recordStatusLabel(r)
                      return (
                        <li key={entry.enrollmentId}>
                          {entry.studentName}:{' '}
                          <span className={label === 'Absent' ? 'text-red-600 font-semibold' : label === 'Present' ? 'text-green-700' : 'text-amber-700'}>
                            {label}
                          </span>
                          {r.note ? <span className="text-gray-400"> · {r.note}</span> : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
