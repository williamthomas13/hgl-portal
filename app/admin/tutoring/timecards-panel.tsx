'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { ConfirmAction } from './confirm'
import {
  CLASS_WORK_TYPE,
  DEFAULT_TUTORING_WORK_TYPE,
  hoursByWorkType,
  sessionMinutes,
} from '../../utils/work-types'

// Staff timecard review (Phase 7b §7.3): per-period list, approve, CSV
// export for manual entry into QBO Payroll. Hours only — no pay rates, no
// dollar amounts, anywhere. Flow: open → tutor confirmed → approved →
// exported; the cross-check ritual disappears because the timecard and the
// family invoice derive from the same session rows.

type Row = {
  id: string
  tutor_id: string
  period_start: string
  period_end: string
  status: 'open' | 'tutor_confirmed' | 'approved' | 'exported'
  total_hours: number
  tutor_confirmed_at: string | null
  approved_by: string | null
  approved_at: string | null
  instructors: { name: string | null; email: string } | null
}

const STATUS_STYLES: Record<Row['status'], string> = {
  open: 'bg-amber-100 text-amber-800',
  tutor_confirmed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  exported: 'bg-gray-200 text-gray-600',
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const PAYROLL_TZ = 'America/Denver'
const denverDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: PAYROLL_TZ })

/** PL-104 payroll handoff: hours by pay-type title for one card. */
type SummaryLine = { workType: string; hours: number }

/** PL-104 quick-verify: one scheduled thing in the period, next to its
 *  claimed state on the card. */
type VerifyRow = {
  key: string
  when: string
  label: string
  hours: number
  status: string
  payable: boolean
  onCard: boolean
}

export default function TimecardsPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  // PL-104: per-card expansions — payroll handoff summary (hours by pay-type
  // title, copyable) and quick-verify (the period's schedule next to the
  // claimed hours). Titles only — no amounts anywhere.
  const [detail, setDetail] = useState<{ id: string; mode: 'summary' | 'verify' } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [summary, setSummary] = useState<SummaryLine[]>([])
  const [verify, setVerify] = useState<VerifyRow[]>([])
  const [copied, setCopied] = useState(false)

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function openSummary(r: Row) {
    setDetail({ id: r.id, mode: 'summary' })
    setDetailLoading(true)
    setCopied(false)
    const [{ data: tut }, { data: cls }] = await Promise.all([
      supabase.from('tutoring_sessions').select('duration_minutes, work_type').eq('timecard_id', r.id),
      supabase.from('sessions').select('start_time, end_time').eq('timecard_id', r.id),
    ])
    setSummary(
      hoursByWorkType([
        ...((tut as any[]) ?? []).map((s) => ({
          workType: s.work_type ?? DEFAULT_TUTORING_WORK_TYPE,
          hours: s.duration_minutes / 60,
        })),
        ...((cls as any[]) ?? []).map((s) => ({
          workType: CLASS_WORK_TYPE,
          hours: sessionMinutes(s.start_time, s.end_time) / 60,
        })),
      ])
    )
    setDetailLoading(false)
  }

  async function openVerify(r: Row) {
    setDetail({ id: r.id, mode: 'verify' })
    setDetailLoading(true)
    // Pad a day each side, then filter to the Denver payroll calendar — the
    // same dates recompute uses, without re-deriving wall-clock bounds here.
    const fromPad = new Date(r.period_start + 'T00:00:00Z')
    fromPad.setUTCDate(fromPad.getUTCDate() - 1)
    const toPad = new Date(r.period_end + 'T00:00:00Z')
    toPad.setUTCDate(toPad.getUTCDate() + 2)
    const [{ data: tut }, { data: cls }] = await Promise.all([
      supabase
        .from('tutoring_sessions')
        .select('id, starts_at, duration_minutes, status, reschedule_notice, timecard_id, students ( first_name, last_name )')
        .eq('tutor_id', r.tutor_id)
        .gte('starts_at', fromPad.toISOString())
        .lt('starts_at', toPad.toISOString())
        .order('starts_at'),
      supabase
        .from('sessions')
        .select('id, session_date, start_time, end_time, timecard_id, classes!inner ( class_type, instructor_id, status, schools ( nickname ) )')
        .eq('classes.instructor_id', r.tutor_id)
        .gte('session_date', r.period_start)
        .lte('session_date', r.period_end)
        .order('session_date'),
    ])
    const today = new Date().toLocaleDateString('en-CA', { timeZone: PAYROLL_TZ })
    const out: VerifyRow[] = []
    for (const s of (tut as any[]) ?? []) {
      const d = denverDate(s.starts_at)
      if (d < r.period_start || d > r.period_end) continue
      const student = one<any>(s.students)
      const payable =
        ['completed', 'forfeited', 'no_show'].includes(s.status) ||
        (s.status === 'rescheduled' && s.reschedule_notice === 'late')
      out.push({
        key: 't' + s.id,
        when: d,
        label: student ? `${student.first_name} ${student.last_name}` : '1-on-1 session',
        hours: s.duration_minutes / 60,
        status: s.status === 'rescheduled' ? `rescheduled (${s.reschedule_notice ?? '—'} notice)` : s.status.replace('_', ' '),
        payable,
        onCard: s.timecard_id === r.id,
      })
    }
    for (const s of (cls as any[]) ?? []) {
      const c = one<any>(s.classes)
      const past = s.session_date < today
      out.push({
        key: 'c' + s.id,
        when: s.session_date,
        label: `${[one<any>(c?.schools)?.nickname, c?.class_type].filter(Boolean).join(' ')} (class)`,
        hours: sessionMinutes(s.start_time, s.end_time) / 60,
        status: c?.status === 'cancelled' ? 'class cancelled' : past ? 'on the schedule, past' : 'on the schedule, upcoming',
        payable: c?.status !== 'cancelled' && past,
        onCard: s.timecard_id === r.id,
      })
    }
    out.sort((a, b) => a.when.localeCompare(b.when))
    setVerify(out)
    setDetailLoading(false)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  function summaryText(r: Row) {
    const name = r.instructors?.name ?? r.instructors?.email ?? ''
    return [
      `${name} — ${r.period_start} → ${r.period_end}`,
      ...summary.map((l) => `${l.workType}: ${l.hours} h`),
      `Total: ${Number(r.total_hours)} h`,
    ].join('\n')
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('timecards')
      .select(
        'id, tutor_id, period_start, period_end, status, total_hours, tutor_confirmed_at, approved_by, approved_at, instructors ( name, email )'
      )
      .order('period_start', { ascending: false })
      .limit(120)
    if (!error) {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      setRows(((data as any[]) ?? []).map((r) => ({ ...r, instructors: one(r.instructors) })))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function call(body: Record<string, unknown>, done: string) {
    setBusy(true)
    const res = await fetch('/api/admin/tutoring/timecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setBusy(false)
    setMessage(res.ok ? done : 'Error: ' + json.error)
    load()
  }

  /** CSV per spec §7.3 — tutor, period, total hours — then stamp exported. */
  function exportPeriod(periodStart: string) {
    const periodRows = rows.filter((r) => r.period_start === periodStart && r.status === 'approved')
    if (periodRows.length === 0) return
    const csv = [
      'tutor,period_start,period_end,total_hours',
      ...periodRows.map(
        (r) => `"${(r.instructors?.name ?? r.instructors?.email ?? '').replace(/"/g, '""')}",${r.period_start},${r.period_end},${r.total_hours}`
      ),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `hgl-timecards-${periodStart}.csv`
    a.click()
    URL.revokeObjectURL(url)
    call(
      { action: 'mark_exported', ids: periodRows.map((r) => r.id) },
      `Exported ${periodRows.length} timecard${periodRows.length === 1 ? '' : 's'} for ${periodStart} — enter the hours in QBO Payroll.`
    )
  }

  // Group by period for display.
  const periods = [...new Set(rows.map((r) => r.period_start))]

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        No timecards yet — the daily sweep creates them when a pay period with sessions closes
        (1st–15th and 16th–end of month).
      </p>
    )
  }

  return (
    <div className="space-y-5 text-sm">
      {periods.map((p) => {
        const periodRows = rows.filter((r) => r.period_start === p)
        const approvedCount = periodRows.filter((r) => r.status === 'approved').length
        return (
          <div key={p} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="font-bold text-hgl-slate">
                {p} → {periodRows[0].period_end}
              </span>
              <span className="text-xs text-gray-400">
                payday the {Number(p.slice(8, 10)) === 1 ? '20th' : '5th'}
              </span>
              {approvedCount > 0 && (
                <button
                  disabled={busy}
                  onClick={() => exportPeriod(p)}
                  className="ml-auto text-xs font-semibold text-hgl-blue underline"
                >
                  Export CSV + mark exported ({approvedCount})
                </button>
              )}
            </div>
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                  <th className="py-1 pr-4">Tutor</th>
                  <th className="py-1 pr-4">Hours</th>
                  <th className="py-1 pr-4">Status</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {periodRows.map((r) => (
                  <Fragment key={r.id}>
                  <tr>
                    <td className="py-1.5 pr-4 font-semibold text-hgl-slate">
                      {r.instructors?.name ?? r.instructors?.email}
                    </td>
                    <td className="py-1.5 pr-4">{Number(r.total_hours)}</td>
                    <td className="py-1.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[r.status]}`}>
                        {r.status.replace('_', ' ')}
                      </span>
                      {r.status === 'open' && r.tutor_confirmed_at === null && (
                        <span className="text-xs text-gray-400 ml-2">awaiting tutor</span>
                      )}
                      {r.approved_by && (
                        <span className="text-xs text-gray-400 ml-2">by {r.approved_by}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {/* PL-104: schedule-vs-claimed in one click, and the
                          hours-by-title handoff for QBO transcription. */}
                      <button
                        disabled={busy || detailLoading}
                        onClick={() =>
                          detail?.id === r.id && detail.mode === 'verify' ? setDetail(null) : openVerify(r)
                        }
                        className="text-hgl-blue underline text-xs mr-3"
                        title="Scheduled sessions for the period next to the claimed hours"
                      >
                        {detail?.id === r.id && detail.mode === 'verify' ? 'hide verify' : 'verify'}
                      </button>
                      <button
                        disabled={busy || detailLoading}
                        onClick={() =>
                          detail?.id === r.id && detail.mode === 'summary' ? setDetail(null) : openSummary(r)
                        }
                        className="text-hgl-blue underline text-xs mr-3"
                        title="Hours by pay-type title, ready to enter into QBO Payroll"
                      >
                        {detail?.id === r.id && detail.mode === 'summary' ? 'hide summary' : 'payroll summary'}
                      </button>
                      {(r.status === 'open' || r.status === 'tutor_confirmed') && (
                        <ConfirmAction
                          label="approve"
                          message={
                            r.status === 'open'
                              ? 'Tutor has not confirmed yet — approve anyway?'
                              : `Approve ${Number(r.total_hours)} hours?`
                          }
                          confirmLabel="Yes, approve"
                          className="text-green-700 underline text-xs"
                          disabled={busy}
                          onConfirm={() => call({ action: 'approve', ids: [r.id] }, 'Approved.')}
                        />
                      )}
                      {(r.status === 'approved' || r.status === 'exported') && (
                        <ConfirmAction
                          label="reopen"
                          message="Reopen for corrections? It re-totals from the live sessions."
                          confirmLabel="Yes, reopen"
                          className="text-gray-500 underline text-xs"
                          disabled={busy}
                          onConfirm={() => call({ action: 'reopen', ids: [r.id] }, 'Reopened.')}
                        />
                      )}
                    </td>
                  </tr>
                  {detail?.id === r.id && (
                    <tr>
                      <td colSpan={4} className="py-2 pl-4 bg-gray-50">
                        {detailLoading ? (
                          <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                        ) : detail.mode === 'summary' ? (
                          <div className="text-xs space-y-1">
                            <p className="font-semibold text-hgl-slate">
                              Payroll handoff — hours by pay-type title (enter into QBO Payroll; rates live there, not here)
                            </p>
                            {summary.length === 0 ? (
                              <p className="text-gray-500 italic">No hours on this card.</p>
                            ) : (
                              <ul className="text-gray-700">
                                {summary.map((l) => (
                                  <li key={l.workType}>
                                    {l.workType}: <span className="font-semibold">{l.hours} h</span>
                                  </li>
                                ))}
                                <li className="text-gray-500 mt-0.5">Total: {Number(r.total_hours)} h</li>
                              </ul>
                            )}
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(summaryText(r)).then(() => setCopied(true))
                              }}
                              className="text-hgl-blue underline"
                            >
                              {copied ? '✓ copied' : 'copy for QBO'}
                            </button>
                          </div>
                        ) : (
                          <div className="text-xs space-y-1">
                            <p className="font-semibold text-hgl-slate">
                              Quick verify — the period&apos;s schedule next to what the card claims
                            </p>
                            {verify.length === 0 ? (
                              <p className="text-gray-500 italic">Nothing on the schedule this period.</p>
                            ) : (
                              <>
                                <ul className="text-gray-700 space-y-0.5">
                                  {verify.map((v) => {
                                    const mismatch = v.payable !== v.onCard
                                    return (
                                      <li key={v.key} className={mismatch ? 'text-amber-800 font-semibold' : ''}>
                                        {v.when} · {v.label} · {v.hours.toFixed(2)} h · {v.status} ·{' '}
                                        {v.onCard ? 'on the card' : 'not on the card'}
                                        {mismatch &&
                                          (v.payable
                                            ? ' — ⚠ looks payable but is missing (reopen re-totals)'
                                            : ' — ⚠ on the card but not payable (reopen re-totals)')}
                                      </li>
                                    )
                                  })}
                                </ul>
                                <p className="text-gray-500">
                                  Schedule shows{' '}
                                  <span className="font-semibold">
                                    {verify.filter((v) => v.payable).reduce((s, v) => s + v.hours, 0).toFixed(2)} h payable
                                  </span>{' '}
                                  · card claims <span className="font-semibold">{Number(r.total_hours)} h</span>
                                  {Math.abs(verify.filter((v) => v.payable).reduce((s, v) => s + v.hours, 0) - Number(r.total_hours)) < 0.01
                                    ? ' — ✓ matches'
                                    : ' — ⚠ mismatch, worth a look (durations may have been corrected)'}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {message && (
        <div
          className={`p-3 rounded text-center font-semibold ${
            message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
