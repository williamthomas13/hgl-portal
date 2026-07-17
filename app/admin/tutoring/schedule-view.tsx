'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { classifyNotice, zonedToUtc } from '../../utils/tutoring'
import { DateHint } from '../ui'
import { fmtTime, wallClock, type SessionRow, type Tutor } from './types'

// Calendar views (Phase 7a §5): per-tutor week (with freebusy shading from
// the tutor's own Google Calendar) and all-tutors day. Edit-dialog session
// actions — reschedule (24h auto-classified, overridable), forfeit, no-show,
// time edit, delete — per spec; drag-to-reschedule is explicitly later.
//
// PL-18: the grid spans the full 24 hours (cross-timezone tutors put real
// sessions outside 07:00–20:00) inside a vertical scroller that opens at
// 07:00. PL-17: day mode gets a Google-style show/hide rail per tutor.

const DAY_START = 0 // full 24h grid (PL-18); the scroller opens at SCROLL_TO
const DAY_END = 24
const SCROLL_TO = 7
const HOUR_PX = 44

const STATUS_STYLES: Record<string, string> = {
  proposed: 'bg-blue-100 border-blue-300 text-blue-800',
  confirmed: 'bg-green-100 border-green-400 text-green-900',
  completed: 'bg-gray-200 border-gray-300 text-gray-600',
  rescheduled: 'bg-gray-100 border-gray-200 text-gray-400 line-through',
  forfeited: 'bg-red-100 border-red-300 text-red-700',
  no_show: 'bg-red-100 border-red-300 text-red-700',
}

const SELECT = `
  id, engagement_id, student_id, tutor_id, starts_at, ends_at, duration_minutes,
  status, reschedule_notice, gcal_event_id, cancel_note,
  reschedule_requested_at, reschedule_request_note,
  students ( first_name, last_name ),
  tutoring_engagements ( location, subjects ( name ) )
`

function startOfWeekIso(anchor: Date, tz: string): string {
  // Monday of the anchor's week, as a calendar date in tz.
  const dateIso = anchor.toLocaleDateString('en-CA', { timeZone: tz })
  const dow = new Date(dateIso + 'T12:00:00Z').getUTCDay() // 0=Sun
  const back = dow === 0 ? 6 : dow - 1
  const d = new Date(dateIso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(dateIso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(rows: any[]): SessionRow[] {
  return (rows ?? []).map((r) => ({
    ...r,
    students: Array.isArray(r.students) ? r.students[0] : r.students,
    tutoring_engagements: (() => {
      const e = Array.isArray(r.tutoring_engagements) ? r.tutoring_engagements[0] : r.tutoring_engagements
      if (!e) return null
      return { ...e, subjects: Array.isArray(e.subjects) ? e.subjects[0] : e.subjects }
    })(),
  }))
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function ScheduleView({ tutors, refreshSignal }: { tutors: Tutor[]; refreshSignal: number }) {
  const activeTutors = useMemo(() => tutors.filter((t) => t.tutoring_active), [tutors])
  const [mode, setMode] = useState<'week' | 'day'>('week')
  const [tutorId, setTutorId] = useState('')
  const [anchor, setAnchor] = useState(() => new Date())
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [busy, setBusy] = useState<{ start: string; end: string; title: string | null; private: boolean }[]>([])
  const [selected, setSelected] = useState<SessionRow | null>(null)
  const [message, setMessage] = useState('')
  // PL-17: hidden tutor calendars in day mode (Google-style show/hide).
  const [hiddenTutorIds, setHiddenTutorIds] = useState<Set<string>>(new Set())
  // PL-18: open the 24h scroller at a sane morning hour.
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = SCROLL_TO * HOUR_PX
  }, [])

  const tutor = activeTutors.find((t) => t.id === tutorId) ?? activeTutors[0] ?? null
  const tz = mode === 'week' ? (tutor?.timezone ?? 'America/Denver') : 'America/Denver'

  // Visible range: Mon–Sun of the anchor week, or the anchor day.
  const range = useMemo(() => {
    if (mode === 'week') {
      const from = startOfWeekIso(anchor, tz)
      return { days: Array.from({ length: 7 }, (_, i) => addDaysIso(from, i)) }
    }
    return { days: [anchor.toLocaleDateString('en-CA', { timeZone: tz })] }
  }, [mode, anchor, tz])

  const rangeStart = useMemo(
    () => new Date(range.days[0] + 'T00:00:00Z').getTime() - 86_400_000, // pad a day each side for tz skew
    [range]
  )
  const rangeEnd = useMemo(
    () => new Date(range.days[range.days.length - 1] + 'T23:59:59Z').getTime() + 86_400_000,
    [range]
  )

  const load = useCallback(async () => {
    let q = supabase
      .from('tutoring_sessions')
      .select(SELECT)
      .gte('starts_at', new Date(rangeStart).toISOString())
      .lte('starts_at', new Date(rangeEnd).toISOString())
      .order('starts_at')
    if (mode === 'week' && tutor) q = q.eq('tutor_id', tutor.id)
    const { data, error } = await q
    if (!error) setSessions(normalize(data ?? []))
  }, [mode, tutor, rangeStart, rangeEnd])

  useEffect(() => {
    load()
  }, [load, refreshSignal])

  // Freebusy shading (week mode): the tutor's own availability blocking plus
  // pushed events, rendered behind the sessions. Failure = no shading.
  useEffect(() => {
    setBusy([])
    if (mode !== 'week' || !tutor) return
    fetch('/api/gcal/freebusy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tutorId: tutor.id,
        timeMin: new Date(rangeStart).toISOString(),
        timeMax: new Date(rangeEnd).toISOString(),
      }),
    })
      .then((r) => r.json())
      .then((json) => setBusy(json.available ? json.busy : []))
      .catch(() => setBusy([]))
  }, [mode, tutor, rangeStart, rangeEnd])

  function shift(days: number) {
    setAnchor((a) => new Date(a.getTime() + days * 86_400_000))
  }

  /** Blocks (top/height px + label) that overlap a given calendar date in tz. */
  function blocksForDay(dayIso: string, items: typeof busy) {
    return items
      .filter((b) => new Date(b.start).toLocaleDateString('en-CA', { timeZone: tz }) === dayIso)
      .map((b) => {
        const s = wallClock(b.start, tz)
        const e = wallClock(b.end, tz)
        const top = Math.max(0, (s.hour + s.minute / 60 - DAY_START) * HOUR_PX)
        const bottom = Math.min(DAY_END - DAY_START, e.hour + e.minute / 60 - DAY_START) * HOUR_PX
        const label = b.title ?? (b.private ? 'busy (private event)' : 'busy')
        return { top, height: Math.max(10, bottom - top), label }
      })
      .filter((b) => b.height > 0 && b.top < (DAY_END - DAY_START) * HOUR_PX)
  }

  const columns =
    mode === 'week'
      ? range.days
      : activeTutors.filter((t) => !hiddenTutorIds.has(t.id)).map((t) => t.id)

  function toggleTutorVisible(id: string) {
    setHiddenTutorIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md overflow-hidden border border-gray-300">
          {(['week', 'day'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-semibold ${
                mode === m ? 'bg-hgl-slate text-white' : 'bg-white text-gray-600'
              }`}
            >
              {m === 'week' ? 'Tutor week' : 'All tutors · day'}
            </button>
          ))}
        </div>
        {mode === 'week' && (
          <select
            value={tutor?.id ?? ''}
            onChange={(e) => setTutorId(e.target.value)}
            className="border border-gray-300 rounded-md p-1.5 bg-white"
          >
            {activeTutors.map((t) => (
              <option key={t.id} value={t.id}>{t.name ?? t.email}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button onClick={() => shift(mode === 'week' ? -7 : -1)} className="px-2 py-1 border rounded">‹</button>
          <button onClick={() => setAnchor(new Date())} className="px-2 py-1 border rounded text-xs">today</button>
          <button onClick={() => shift(mode === 'week' ? 7 : 1)} className="px-2 py-1 border rounded">›</button>
        </div>
        <span className="text-gray-500 text-xs">
          {mode === 'week'
            ? `${range.days[0]} → ${range.days[6]} · times in ${tz}`
            : `${range.days[0]} · times in ${tz}`}
          {mode === 'week' && busy.length > 0 && ' · gray = busy per Google Calendar'}
        </span>
      </div>

      {activeTutors.length === 0 ? (
        <p className="text-gray-500 italic">No active tutors yet — enable tutoring on an instructor below.</p>
      ) : (
        <div className="flex gap-3">
          {/* PL-17: Google-style show/hide rail (day mode, where each tutor
              is a column). Week mode keeps the single-tutor picker above. */}
          {mode === 'day' && activeTutors.length > 1 && (
            <div className="w-36 shrink-0 pt-8 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Tutors</p>
              {activeTutors.map((t) => (
                <label key={t.id} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!hiddenTutorIds.has(t.id)}
                    onChange={() => toggleTutorVisible(t.id)}
                  />
                  <span className="truncate">{t.name ?? t.email}</span>
                </label>
              ))}
            </div>
          )}
          <div ref={scrollerRef} className="overflow-auto flex-1" style={{ maxHeight: 15 * HOUR_PX }}>
          <div className="flex min-w-full" style={{ minWidth: columns.length * 130 + 48 }}>
            {/* Hour gutter */}
            <div className="w-12 shrink-0 pt-8">
              {Array.from({ length: DAY_END - DAY_START }, (_, i) => (
                <div key={i} className="text-right pr-1 text-[10px] text-gray-400" style={{ height: HOUR_PX }}>
                  {String(DAY_START + i).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            {columns.map((col) => {
              const dayIso = mode === 'week' ? (col as string) : range.days[0]
              const colTutor = mode === 'day' ? activeTutors.find((t) => t.id === col) : tutor
              const colSessions = sessions.filter(
                (s) =>
                  new Date(s.starts_at).toLocaleDateString('en-CA', { timeZone: tz }) === dayIso &&
                  (mode === 'week' || s.tutor_id === col)
              )
              const busyBlocks = mode === 'week' ? blocksForDay(dayIso, busy) : []
              return (
                <div key={col} className="flex-1 min-w-32 border-l border-gray-200">
                  <div className="h-8 text-center text-xs font-semibold text-hgl-slate truncate px-1 sticky top-0 bg-gray-50 z-10">
                    {mode === 'week'
                      ? new Date(dayIso + 'T12:00:00Z').toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          timeZone: 'UTC',
                        })
                      : colTutor?.name ?? colTutor?.email}
                  </div>
                  <div className="relative bg-white" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
                    {Array.from({ length: DAY_END - DAY_START }, (_, i) => (
                      <div key={i} className="absolute w-full border-t border-gray-100" style={{ top: i * HOUR_PX }} />
                    ))}
                    {busyBlocks.map((b, i) => (
                      <div
                        key={`busy-${i}`}
                        className="absolute inset-x-0 bg-gray-200/70 overflow-hidden px-1"
                        style={{ top: b.top, height: b.height }}
                        title={`${b.label} — per the tutor's Google Calendar`}
                      >
                        {b.height >= 18 && (
                          <span className="text-[9px] text-gray-500 leading-tight">{b.label}</span>
                        )}
                      </div>
                    ))}
                    {colSessions.map((s) => {
                      const start = wallClock(s.starts_at, tz)
                      const top = (start.hour + start.minute / 60 - DAY_START) * HOUR_PX
                      const height = Math.max(18, (s.duration_minutes / 60) * HOUR_PX)
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSelected(s)}
                          className={`absolute inset-x-0.5 rounded border px-1 py-0.5 text-left text-[11px] leading-tight overflow-hidden ${
                            STATUS_STYLES[s.status] ?? 'bg-gray-100 border-gray-300'
                          }`}
                          style={{ top, height }}
                          title={`${s.students?.first_name ?? ''} ${s.students?.last_name ?? ''} · ${s.status}`}
                        >
                          <span className="font-semibold">
                            {fmtTime(s.starts_at, tz)} {s.students?.first_name}
                            {s.reschedule_requested_at && s.status === 'confirmed' && ' ⟳'}
                          </span>
                          <br />
                          {s.tutoring_engagements?.subjects?.name}
                          {(s.status === 'forfeited' || s.status === 'no_show') && ' · XCL'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          </div>
        </div>
      )}

      {message && (
        <div
          className={`p-3 rounded text-center font-semibold ${
            message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}

      {selected && (
        <SessionDialog
          session={selected}
          tz={tz}
          onClose={(msg) => {
            setSelected(null)
            if (msg) {
              setMessage(msg)
              load()
            }
          }}
        />
      )}
    </div>
  )
}

function SessionDialog({
  session,
  tz,
  onClose,
}: {
  session: SessionRow
  tz: string
  onClose: (message?: string) => void
}) {
  const [action, setAction] = useState<'none' | 'reschedule' | 'edit_time' | 'forfeit' | 'no_show' | 'delete'>('none')
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [duration, setDuration] = useState(session.duration_minutes)
  const [note, setNote] = useState('')
  const [noticeOverride, setNoticeOverride] = useState<'' | 'ok' | 'late'>('')
  const [busy, setBusy] = useState(false)

  const upcoming = session.status === 'proposed' || session.status === 'confirmed'
  const autoNotice = classifyNotice(new Date(session.starts_at))

  async function call(body: Record<string, unknown>, done: string) {
    setBusy(true)
    const res = await fetch('/api/admin/tutoring/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setBusy(false)
    onClose(res.ok ? done : 'Error: ' + json.error)
  }

  function newInstants(): { starts: string; ends: string } | null {
    if (!newDate || !newTime) return null
    // The picked wall clock is in the display timezone.
    const start = zonedToUtc(newDate, newTime, tz)
    return {
      starts: start.toISOString(),
      ends: new Date(start.getTime() + duration * 60_000).toISOString(),
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4 text-sm max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-lg font-bold text-hgl-slate">
            {session.students?.first_name} {session.students?.last_name} —{' '}
            {session.tutoring_engagements?.subjects?.name}
          </h3>
          <p className="text-gray-500">
            {new Date(session.starts_at).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {fmtTime(session.starts_at, tz)}–{fmtTime(session.ends_at, tz)} ({tz})
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Status: <span className="font-semibold">{session.status}</span>
            {session.reschedule_notice && ` (${session.reschedule_notice} notice)`}
            {session.gcal_event_id ? ' · on Google Calendar' : ' · not yet on Google Calendar'}
            {session.cancel_note && ` · note: ${session.cancel_note}`}
          </p>
          {session.reschedule_requested_at && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
              <span className="font-bold">Family asked to move this session</span> (
              {new Date(session.reschedule_requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              ){session.reschedule_request_note ? ` — “${session.reschedule_request_note}”` : ''}. Use
              Reschedule below; they and the tutor get the change email automatically.
            </p>
          )}
        </div>

        {upcoming && action === 'none' && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setAction('reschedule')} className="border border-gray-300 rounded py-2 hover:bg-gray-50">
              Reschedule…
            </button>
            <button onClick={() => setAction('edit_time')} className="border border-gray-300 rounded py-2 hover:bg-gray-50">
              Edit time…
            </button>
            <button
              onClick={() => setAction('forfeit')}
              className="border border-red-200 text-red-700 rounded py-2 hover:bg-red-50"
            >
              Forfeit…
            </button>
            <button
              onClick={() => setAction('no_show')}
              className="border border-red-200 text-red-700 rounded py-2 hover:bg-red-50"
            >
              No-show…
            </button>
          </div>
        )}

        {session.status === 'completed' && action === 'none' && (
          <button
            onClick={() => setAction('no_show')}
            className="w-full border border-red-200 text-red-700 rounded py-2 hover:bg-red-50"
          >
            Actually a no-show (correct the auto-completion)…
          </button>
        )}

        {(action === 'forfeit' || action === 'no_show' || action === 'delete') && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">
              {action === 'forfeit' &&
                (autoNotice === 'late'
                  ? 'Forfeit this session? Inside 24 hours the prepaid slot is forfeited (the tutor is still paid), and the calendar event stays, XCL-marked.'
                  : 'Forfeit this session? The family gave notice but no reschedule is wanted — the prepaid slot is forfeited and the calendar event stays, XCL-marked.')}
              {action === 'no_show' &&
                'Mark this session a no-show? Treated like a forfeit (tutor still paid), labeled separately for reporting; the calendar event stays, XCL-marked.'}
              {action === 'delete' &&
                'Delete this session entirely? Use this for entry mistakes only — policy changes are reschedules or forfeits. The calendar event is removed.'}
            </p>
            {action !== 'delete' && (
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (why, who asked)"
                className="w-full border border-gray-300 rounded p-1.5"
              />
            )}
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => {
                  if (action === 'forfeit') {
                    call({ action: 'cancel', id: session.id, outcome: 'forfeited', note }, 'Session forfeited — calendar XCL-marked.')
                  } else if (action === 'no_show') {
                    call({ action: 'cancel', id: session.id, outcome: 'no_show', note }, 'Marked no-show — calendar XCL-marked.')
                  } else {
                    call({ action: 'delete', id: session.id }, 'Session deleted.')
                  }
                }}
                className="bg-red-700 text-white py-2 px-4 rounded hover:opacity-90 disabled:opacity-50"
              >
                {action === 'forfeit' ? 'Yes, forfeit' : action === 'no_show' ? 'Yes, mark no-show' : 'Yes, delete'}
              </button>
              <button onClick={() => setAction('none')} className="py-2 px-4 rounded border border-gray-300 text-gray-600">
                Back
              </button>
            </div>
          </div>
        )}

        {(action === 'reschedule' || action === 'edit_time') && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-gray-500">
              {action === 'reschedule' ? (
                <>
                  New slot (times in {tz}). Notice is auto-classified:{' '}
                  <span className={`font-bold ${autoNotice === 'late' ? 'text-red-600' : 'text-green-700'}`}>
                    {autoNotice === 'late' ? '< 24h — $40/hour late-reschedule policy applies (7c bills it)' : '≥ 24h — free reschedule'}
                  </span>
                </>
              ) : (
                `Correct this session's time (no policy classification — use Reschedule for family-requested changes). Times in ${tz}.`
              )}
            </p>
            <div className="flex gap-2 items-center flex-wrap">
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="border border-gray-300 rounded p-1.5" />
              <DateHint value={newDate} />
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="border border-gray-300 rounded p-1.5" />
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="border border-gray-300 rounded p-1.5 bg-white">
                {[30, 45, 60, 90, 120, 150, 180].map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </div>
            {action === 'reschedule' && (
              <label className="block text-xs text-gray-600">
                Notice override (emergencies — Ops Director discretion):{' '}
                <select
                  value={noticeOverride}
                  onChange={(e) => setNoticeOverride(e.target.value as '' | 'ok' | 'late')}
                  className="border border-gray-300 rounded p-1 bg-white"
                >
                  <option value="">auto ({autoNotice})</option>
                  <option value="ok">treat as free (ok)</option>
                  <option value="late">treat as late</option>
                </select>
              </label>
            )}
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (why, who asked)"
              className="w-full border border-gray-300 rounded p-1.5"
            />
            <button
              disabled={busy || !newDate || !newTime}
              onClick={() => {
                const t = newInstants()
                if (!t) return
                if (action === 'reschedule') {
                  call(
                    {
                      action: 'reschedule',
                      id: session.id,
                      new_starts_at: t.starts,
                      new_ends_at: t.ends,
                      ...(noticeOverride ? { notice: noticeOverride } : {}),
                      note,
                    },
                    'Rescheduled — replacement scheduled and calendar updated.'
                  )
                } else {
                  call(
                    { action: 'update_time', id: session.id, starts_at: t.starts, ends_at: t.ends },
                    'Time updated — calendar patched.'
                  )
                }
              }}
              className="bg-hgl-slate text-white py-2 px-4 rounded hover:opacity-90 disabled:opacity-50"
            >
              {action === 'reschedule' ? 'Reschedule' : 'Save time'}
            </button>
          </div>
        )}

        <div className="flex justify-between border-t pt-3">
          {upcoming && action === 'none' && (
            <button onClick={() => setAction('delete')} className="text-red-600 text-xs underline">
              Delete (entry mistake)…
            </button>
          )}
          <button onClick={() => onClose()} className="ml-auto py-2 px-4 rounded border border-gray-300 text-gray-600">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
