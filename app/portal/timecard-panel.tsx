'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateRange } from '../utils/dates'
import {
  CLASS_WORK_TYPE,
  DEFAULT_TUTORING_WORK_TYPE,
  hoursByWorkType,
  sessionMinutes, prepRows } from '../utils/work-types'

// Client half of the tutor timecard view (Phase 7b §7.2): review the closed
// period, correct exceptions (no-show, actual duration), confirm. Payable
// no-shows/forfeits/late reschedules are listed on purpose — tutors are paid
// for reserved time. Actions call /api/portal/tutoring and refresh the
// server-rendered data.

export type TimecardData = {
  id: string
  period_start: string
  period_end: string
  status: 'open' | 'tutor_confirmed' | 'approved' | 'exported'
  total_hours: number
  tutor_confirmed_at: string | null
}

export type TimecardSession = {
  id: string
  starts_at: string
  duration_minutes: number
  status: string
  reschedule_notice: 'ok' | 'late' | null
  cancel_note: string | null
  work_type: string | null
  /** PL-412B: payable prep minutes for this session (null = none). */
  prep_minutes: number | null
  studentName: string
  subjectName: string
}

/** PL-103: a group-class session taught this period — from the class
 *  schedule, always paid under Class/Workshop. */
export type TimecardClassSession = {
  id: string
  session_date: string
  start_time: string | null
  end_time: string | null
  className: string
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Happened',
  no_show: 'No-show (paid)',
  forfeited: 'Cancelled <24h (paid)',
  rescheduled: 'Late reschedule — original slot (paid)',
}

const CARD_STATUS_STYLES: Record<TimecardData['status'], string> = {
  open: 'bg-amber-100 text-amber-800',
  tutor_confirmed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  exported: 'bg-gray-200 text-gray-600',
}

export default function TimecardPanel({
  timecards,
  actionableId,
  sessions,
  classSessions = [],
  notedSessionIds = [],
  workTypes = [],
  timezone,
  salaried = false,
}: {
  timecards: TimecardData[]
  actionableId: string | null
  sessions: TimecardSession[]
  classSessions?: TimecardClassSession[]
  /** PL-257: session ids on this card that already have a session note. */
  notedSessionIds?: string[]
  /** The tutor's selectable work types: the standard six + own pay-type titles. */
  workTypes?: string[]
  timezone: string
  /** PL-212: salaried tutors confirm hours for the record, not for pay. */
  salaried?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [noShowArming, setNoShowArming] = useState('') // session id

  const actionable = timecards.find((t) => t.id === actionableId) ?? null

  async function call(body: Record<string, unknown>, done: string) {
    setBusy(true)
    setMessage('')
    const res = await fetch('/api/portal/tutoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    setNoShowArming('')
    setMessage(res.ok ? done : 'Error: ' + json.error)
    if (res.ok) router.refresh()
  }

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString('en-US', { timeZone: timezone, ...opts })

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-6">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">Timecards</h2>
      {salaried ? (
        <p className="text-xs text-gray-500 mb-4">
          The card assumes every scheduled session happened as planned — the portal can&apos;t know
          when a student didn&apos;t show or a session ran a different length, so if that happened,
          mark it on the card to keep our records right.{' '}
          <span className="font-semibold text-purple-700">
            You&apos;re salaried — hours are tracked for records; they aren&apos;t paid hourly.
          </span>
        </p>
      ) : (
        <p className="text-xs text-gray-500 mb-4">
          The card assumes every scheduled session happened as planned — the portal can&apos;t know
          when a student didn&apos;t show or a session ran a different length, so if that happened,
          mark it on the card to keep our records right. Marking a no-show doesn&apos;t change your
          pay — you&apos;re paid for the reserved time either way. Hours only; pay runs through
          payroll as usual (1st–15th pays the 20th, 16th–end pays the 5th).
        </p>
      )}

      {timecards.length === 0 && (
        <p className="text-sm text-gray-500 italic">
          No timecards yet — the first one appears after a pay period with sessions closes.
        </p>
      )}

      {actionable && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-semibold text-hgl-slate">
              {formatDateRange(actionable.period_start, actionable.period_end)}
            </span>
            {/* PL-409: payroll runs on Salt Lake City time — label, no math. */}
            <span className="text-xs text-gray-400">Salt Lake City time</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${CARD_STATUS_STYLES[actionable.status]}`}>
              {actionable.status.replace('_', ' ')}
            </span>
            <span className="ml-auto font-bold text-hgl-slate">{Number(actionable.total_hours)} h</span>
          </div>

          <ul className="divide-y divide-gray-100 text-sm mb-3">
            {sessions.map((s) => (
              <li key={s.id} className="py-2">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
                  <span className="font-semibold text-hgl-slate">
                    {fmt(s.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                  <span>{fmt(s.starts_at, { hour: 'numeric', minute: '2-digit' })}</span>
                  <span className="text-gray-600">{s.studentName} · {s.subjectName}</span>
                  <span className="text-gray-500 text-xs">{(s.duration_minutes / 60).toFixed(2)} h</span>
                  <span className="text-xs text-gray-500">{STATUS_LABELS[s.status] ?? s.status}</span>
                  {/* PL-103: the paper timecard's hour columns — attribute the
                      session's hours to a work type while the card is open. */}
                  {actionable.status === 'open' ? (
                    <select
                      value={s.work_type ?? DEFAULT_TUTORING_WORK_TYPE}
                      disabled={busy}
                      onChange={(e) =>
                        call(
                          { action: 'set_work_type', session_id: s.id, work_type: e.target.value },
                          'Work type updated.'
                        )
                      }
                      className="border border-gray-200 rounded p-0.5 text-xs bg-white text-gray-600"
                      title="Which pay type these hours count under (rates live in payroll, not here)"
                    >
                      {workTypes.map((w) => (
                        <option key={w} value={w}>{w}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 border border-gray-200 rounded px-1">
                      {s.work_type ?? DEFAULT_TUTORING_WORK_TYPE}
                    </span>
                  )}
                  {/* PL-412B: per-session prep time — its own 'Prep Time' pay
                      line; deliberately NOT on calendars (tied to the
                      session, not scheduled time). */}
                  {actionable.status === 'open' ? (
                    <PrepControl
                      prepMinutes={s.prep_minutes}
                      disabled={busy}
                      onSave={(m) =>
                        call(
                          { action: 'set_prep_minutes', session_id: s.id, prep_minutes: m },
                          m > 0 ? 'Prep time saved — it counts toward your hours as Prep Time.' : 'Prep time cleared.'
                        )
                      }
                    />
                  ) : (
                    (s.prep_minutes ?? 0) > 0 && (
                      <span className="text-[10px] uppercase tracking-wide text-gray-500 border border-gray-200 rounded px-1">
                        prep {s.prep_minutes} min
                      </span>
                    )
                  )}
                  {actionable.status === 'open' && s.status === 'completed' && (
                    <span className="ml-auto flex gap-2 text-xs items-center">
                      {noShowArming === s.id ? (
                        <span className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          <span className="text-amber-900">Student didn&apos;t show? You&apos;re still paid.</span>
                          <button
                            disabled={busy}
                            onClick={() => call({ action: 'no_show', session_id: s.id }, 'Marked no-show.')}
                            className="text-red-700 font-semibold underline"
                          >
                            Yes, no-show
                          </button>
                          <button onClick={() => setNoShowArming('')} className="text-gray-500 underline">
                            cancel
                          </button>
                        </span>
                      ) : (
                        // PL-261: no "ran shorter/longer" — sessions bill and
                        // pay at their scheduled length, always.
                        <button onClick={() => setNoShowArming(s.id)} className="text-red-600 underline">
                          no-show…
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {s.cancel_note && <p className="text-xs text-gray-500 mt-0.5">note: {s.cancel_note}</p>}
              </li>
            ))}
            {/* PL-103: group-class sessions taught — from the class schedule,
                paid under Class/Workshop. */}
            {classSessions.map((c) => {
              const hours = sessionMinutes(c.start_time, c.end_time) / 60
              return (
                <li key={c.id} className="py-2">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
                    <span className="font-semibold text-hgl-slate">
                      {new Date(c.session_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </span>
                    {c.start_time && <span>{c.start_time.slice(0, 5)}</span>}
                    <span className="text-gray-600">{c.className}</span>
                    <span className="text-gray-500 text-xs">
                      {hours > 0 ? `${hours.toFixed(2)} h` : 'missing times — 0 h, tell the office'}
                    </span>
                    <span className="text-xs text-gray-500">Class session taught</span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 border border-gray-200 rounded px-1">
                      {CLASS_WORK_TYPE}
                    </span>
                  </div>
                </li>
              )
            })}
            {sessions.length === 0 && classSessions.length === 0 && (
              <li className="py-2 text-gray-500 italic">No payable sessions this period.</li>
            )}
          </ul>

          {/* PL-103: hours by work type — the paper timecard's columns. */}
          {(() => {
            const byType = hoursByWorkType([
              ...sessions.map((s) => ({
                workType: s.work_type ?? DEFAULT_TUTORING_WORK_TYPE,
                hours: s.duration_minutes / 60,
              })),
              ...classSessions.map((c) => ({
                workType: CLASS_WORK_TYPE,
                hours: sessionMinutes(c.start_time, c.end_time) / 60,
              })),
              // PL-412B: prep minutes sum separately under 'Prep Time'.
              ...prepRows(sessions),
            ])
            if (byType.length === 0) return null
            return (
              <p className="text-xs text-gray-500 mb-3">
                <span className="font-semibold text-gray-600">Hours by type:</span>{' '}
                {byType.map((t, i) => (
                  <span key={t.workType}>
                    {i > 0 && ' · '}
                    {t.workType} <span className="font-semibold">{t.hours}</span>
                  </span>
                ))}
              </p>
            )
          })()}

          {/* PL-257: the tutor sees the SAME missing-notes state the admin
              approval gate enforces, and confirm fails closed until it's
              clear (the server re-checks regardless). */}
          {(() => {
            const noted = new Set(notedSessionIds)
            const missingNotes = sessions.filter((s) => s.status === 'completed' && !noted.has(s.id))
            return (
              <>
                {actionable.status === 'open' && missingNotes.length > 0 && (
                  <div className="mb-3 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm">
                    {/* PL-113 lesson: explicit {' '} at line-broken inline
                        boundaries — JSX eats the newline-adjacent space. */}
                    <p className="font-semibold text-amber-900">
                      {missingNotes.length} session{missingNotes.length === 1 ? '' : 's'} on this
                      timecard {missingNotes.length === 1 ? 'is' : 'are'}{' '}
                      missing notes — your timecard can&apos;t be confirmed (or approved) until
                      every session has one:
                    </p>
                    <ul className="mt-1 ml-5 list-disc text-amber-900">
                      {missingNotes.map((s) => (
                        <li key={s.id}>
                          {fmt(s.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })} —{' '}
                          {s.studentName}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-amber-800">
                      Add each note in the <span className="font-semibold">Session notes</span>{' '}
                      section above — a couple of sentences is plenty.
                    </p>
                  </div>
                )}
                {actionable.status === 'open' && (
                  <button
                    disabled={busy || missingNotes.length > 0}
                    title={
                      missingNotes.length > 0
                        ? 'Every session needs a note before the timecard can be confirmed.'
                        : undefined
                    }
                    onClick={() =>
                      call({ action: 'confirm_timecard', timecard_id: actionable.id }, 'Timecard confirmed — thank you!')
                    }
                    className="bg-hgl-slate text-white py-2 px-5 rounded hover:opacity-90 disabled:opacity-50"
                  >
                    Confirm timecard ({Number(actionable.total_hours)} h)
                  </button>
                )}
              </>
            )
          })()}
          {actionable.status === 'tutor_confirmed' && (
            <p className="text-sm text-green-700">
              ✓ Confirmed{actionable.tutor_confirmed_at ? ` on ${fmt(actionable.tutor_confirmed_at, { month: 'short', day: 'numeric' })}` : ''} — awaiting office approval.
            </p>
          )}
        </div>
      )}

      {timecards.filter((t) => t.id !== actionableId).length > 0 && (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="py-1 pr-4">Period</th>
              <th className="py-1 pr-4">Hours</th>
              <th className="py-1">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {timecards
              .filter((t) => t.id !== actionableId)
              .map((t) => (
                <tr key={t.id}>
                  <td className="py-1.5 pr-4 text-hgl-slate">{formatDateRange(t.period_start, t.period_end)}</td>
                  <td className="py-1.5 pr-4">{Number(t.total_hours)}</td>
                  <td className="py-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${CARD_STATUS_STYLES[t.status]}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {message && (
        <div
          className={`mt-3 p-3 rounded text-center text-sm font-semibold ${
            message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}

/** PL-412B: the "Prep time" checkbox that reveals a minutes field. Soft note
 *  above 15 minutes (never a blocker); unchecking clears the minutes. */
function PrepControl({
  prepMinutes,
  disabled,
  onSave,
}: {
  prepMinutes: number | null
  disabled: boolean
  onSave: (minutes: number) => void
}) {
  const [open, setOpen] = useState((prepMinutes ?? 0) > 0)
  const [mins, setMins] = useState(prepMinutes != null ? String(prepMinutes) : '')
  const n = Number(mins)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <label className="inline-flex items-center gap-1 text-gray-600">
        <input
          type="checkbox"
          checked={open}
          disabled={disabled}
          onChange={(e) => {
            setOpen(e.target.checked)
            if (!e.target.checked) {
              setMins('')
              if ((prepMinutes ?? 0) > 0) onSave(0)
            }
          }}
        />
        Prep time
      </label>
      {open && (
        <>
          <input
            type="number"
            min={0}
            max={480}
            step={5}
            value={mins}
            disabled={disabled}
            onChange={(e) => setMins(e.target.value)}
            onBlur={() => {
              if (mins === '') return
              if (Number.isFinite(n) && n >= 0 && n <= 480 && Math.round(n) !== (prepMinutes ?? 0)) {
                onSave(Math.round(n))
              }
            }}
            className="w-14 border border-gray-200 rounded p-0.5 bg-white"
            title="Prep minutes for this session — paid as Prep Time"
          />
          <span className="text-gray-500">min</span>
          {n > 15 && (
            <span className="text-amber-700">more than 15 minutes per session is uncommon</span>
          )}
        </>
      )}
    </span>
  )
}
