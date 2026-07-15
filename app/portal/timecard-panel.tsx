'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
  studentName: string
  subjectName: string
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

const DURATIONS = [30, 45, 60, 75, 90, 105, 120, 150, 180]

export default function TimecardPanel({
  timecards,
  actionableId,
  sessions,
  timezone,
}: {
  timecards: TimecardData[]
  actionableId: string | null
  sessions: TimecardSession[]
  timezone: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [adjusting, setAdjusting] = useState('') // session id
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
    const json = await res.json()
    setBusy(false)
    setAdjusting('')
    setNoShowArming('')
    setMessage(res.ok ? done : 'Error: ' + json.error)
    if (res.ok) router.refresh()
  }

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString('en-US', { timeZone: timezone, ...opts })

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-6">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">Timecards</h2>
      <p className="text-xs text-gray-400 mb-4">
        Built from the schedule automatically — review the period, fix any exception, confirm.
        Hours only; pay runs through payroll as usual (1st–15th pays the 20th, 16th–end pays the 5th).
      </p>

      {timecards.length === 0 && (
        <p className="text-sm text-gray-500 italic">
          No timecards yet — the first one appears after a pay period with sessions closes.
        </p>
      )}

      {actionable && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-semibold text-hgl-slate">
              {actionable.period_start} → {actionable.period_end}
            </span>
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
                  <span className="text-xs text-gray-400">{STATUS_LABELS[s.status] ?? s.status}</span>
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
                      ) : adjusting === s.id ? (
                        <span className="inline-flex items-center gap-1">
                          ran
                          <select
                            defaultValue={s.duration_minutes}
                            disabled={busy}
                            onChange={(e) =>
                              call(
                                { action: 'adjust_duration', session_id: s.id, duration_minutes: Number(e.target.value) },
                                'Duration corrected.'
                              )
                            }
                            className="border border-gray-300 rounded p-1 bg-white"
                          >
                            {DURATIONS.map((m) => (
                              <option key={m} value={m}>{m} min</option>
                            ))}
                          </select>
                          <button onClick={() => setAdjusting('')} className="text-gray-500 underline">
                            cancel
                          </button>
                        </span>
                      ) : (
                        <>
                          <button onClick={() => setNoShowArming(s.id)} className="text-red-600 underline">
                            no-show…
                          </button>
                          <button onClick={() => setAdjusting(s.id)} className="text-hgl-blue underline">
                            ran shorter/longer…
                          </button>
                        </>
                      )}
                    </span>
                  )}
                </div>
                {s.cancel_note && <p className="text-xs text-gray-400 mt-0.5">note: {s.cancel_note}</p>}
              </li>
            ))}
            {sessions.length === 0 && (
              <li className="py-2 text-gray-500 italic">No payable sessions this period.</li>
            )}
          </ul>

          {actionable.status === 'open' && (
            <button
              disabled={busy}
              onClick={() =>
                call({ action: 'confirm_timecard', timecard_id: actionable.id }, 'Timecard confirmed — thank you!')
              }
              className="bg-hgl-slate text-white py-2 px-5 rounded hover:opacity-90 disabled:opacity-50"
            >
              Confirm timecard ({Number(actionable.total_hours)} h)
            </button>
          )}
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
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
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
                  <td className="py-1.5 pr-4 text-hgl-slate">{t.period_start} → {t.period_end}</td>
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
