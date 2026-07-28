'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CALENDAR_COLORS, type CalendarStatus } from '../../utils/calendar-colors'

// PL-160: a REAL calendar — GCal-style week/month, one combined view of
// 1-on-1 sessions, class sessions, and PL-159 proposed holds, in Kelsie's
// exact color language. Read-only v1: every block deep-links its record;
// scheduling actions stay on their existing surfaces. Rendered in
// America/Denver with the label visible (PL-118). The PL-161 instructor-fit
// suggester overlays this view.

const TZ = 'America/Denver'

type Block = {
  id: string
  kind: 'tutoring' | 'class'
  title: string
  startsAt: string
  endsAt: string
  status: CalendarStatus
  portalStatus: string
  tutorId: string | null
  tutorName: string | null
  classId: string | null
  schoolId: string | null
  schoolName: string | null
  href: string
}

const dayIso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z')
  return new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10)
}
/** Monday of the week containing iso (Denver wall dates). */
const mondayOf = (iso: string) => {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay()
  return addDays(iso, -((dow + 6) % 7))
}
const firstOfMonth = (iso: string) => iso.slice(0, 8) + '01'
const fmtTime = (instant: string) =>
  new Date(instant).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const denverDay = (instant: string) => new Date(instant).toLocaleDateString('en-CA', { timeZone: TZ })
const denverHour = (instant: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h + m / 60
}

type FitCandidate = {
  id: string
  name: string
  current: boolean
  available: boolean
  googleChecked: boolean
  hardConflicts: string[]
  travelConflicts: string[]
}
type FitResult = {
  classLabel: string
  classId: string
  inPerson: boolean
  sessionCount: number
  googleUp: boolean
  note?: string
  candidates: FitCandidate[]
}

export default function AdminCalendarPage() {
  const [view, setView] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(() => dayIso(new Date()))
  const [blocks, setBlocks] = useState<Block[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // PL-161: the instructor-fit suggester overlays this view — visual-first,
  // because trust is earned: the candidate's busy/free renders against the
  // class blocks so Kelsie sees exactly what the ranking saw. Advisory only;
  // assignment stays on the class page.
  const [suggestClassId, setSuggestClassId] = useState('')
  const [fit, setFit] = useState<FitResult | null>(null)
  const [fitLoading, setFitLoading] = useState(false)
  const [overlayTutor, setOverlayTutor] = useState('')
  const [overlayBusy, setOverlayBusy] = useState<{ start: string; end: string; title: string | null }[]>([])
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('suggest')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c) setSuggestClassId(c)
  }, [])
  useEffect(() => {
    if (!suggestClassId) {
      setFit(null)
      return
    }
    let stale = false
    setFitLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/instructor-fit?classId=${suggestClassId}`)
        const json = await res.json().catch(() => ({}))
        if (!stale) setFit(res.ok ? json : null)
      } catch {
        if (!stale) setFit(null)
      }
      if (!stale) setFitLoading(false)
    })()
    return () => {
      stale = true
    }
  }, [suggestClassId])

  // Filters (compose): person, school/class, status.
  const [personFilter, setPersonFilter] = useState('')
  const [placeFilter, setPlaceFilter] = useState('') // school:{id} or class:{id}
  const [statusFilter, setStatusFilter] = useState('')

  const rangeStartIso = view === 'week' ? mondayOf(anchor) : mondayOf(firstOfMonth(anchor))
  const days = view === 'week' ? 7 : 42
  const rangeEndIso = addDays(rangeStartIso, days)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const from = new Date(rangeStartIso + 'T00:00:00-07:00').toISOString()
      const to = new Date(rangeEndIso + 'T23:59:59-06:00').toISOString()
      const res = await fetch(`/api/admin/calendar?from=${from}&to=${to}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setError(json.error ?? `The server returned ${res.status}.`)
      else setBlocks(json.blocks ?? [])
    } catch {
      setError("Couldn't reach the server — try again.")
    }
    setLoading(false)
  }, [rangeStartIso, rangeEndIso])

  useEffect(() => {
    load()
  }, [load])

  // PL-161: the picked candidate's Google busy for the visible range.
  useEffect(() => {
    if (!overlayTutor) {
      setOverlayBusy([])
      return
    }
    let stale = false
    ;(async () => {
      try {
        const from = new Date(rangeStartIso + 'T00:00:00-07:00').toISOString()
        const to = new Date(addDays(rangeStartIso, Math.min(days, 42)) + 'T23:59:59-06:00').toISOString()
        const res = await fetch('/api/gcal/freebusy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tutorId: overlayTutor, timeMin: from, timeMax: to }),
        })
        const json = await res.json().catch(() => ({}))
        if (!stale) setOverlayBusy(json.busy ?? [])
      } catch {
        if (!stale) setOverlayBusy([])
      }
    })()
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayTutor, rangeStartIso, days])

  const people = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of blocks) if (b.tutorId && b.tutorName) m.set(b.tutorId, b.tutorName)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [blocks])
  const places = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of blocks) {
      if (b.schoolId && b.schoolName) m.set(`school:${b.schoolId}`, `School: ${b.schoolName}`)
      if (b.classId) m.set(`class:${b.classId}`, `Class: ${b.title}`)
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [blocks])

  const visible = blocks.filter((b) => {
    if (personFilter && b.tutorId !== personFilter) return false
    if (placeFilter.startsWith('school:') && b.schoolId !== placeFilter.slice(7)) return false
    if (placeFilter.startsWith('class:') && b.classId !== placeFilter.slice(6)) return false
    if (statusFilter && b.status !== statusFilter) return false
    return true
  })

  const byDay = useMemo(() => {
    const m = new Map<string, Block[]>()
    for (const b of visible) {
      const day = denverDay(b.startsAt)
      m.set(day, [...(m.get(day) ?? []), b])
    }
    return m
  }, [visible])

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(rangeStartIso, i))
  const monthDays = Array.from({ length: 42 }, (_, i) => addDays(mondayOf(firstOfMonth(anchor)), i))
  const monthLabel = new Date(anchor + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
  const step = (dir: 1 | -1) =>
    setAnchor((a) => {
      if (view === 'week') return addDays(a, 7 * dir)
      const d = new Date(firstOfMonth(a) + 'T12:00:00Z')
      d.setUTCMonth(d.getUTCMonth() + dir)
      return d.toISOString().slice(0, 10)
    })

  const HOUR_START = 7
  const HOUR_END = 22
  const HOUR_PX = 48

  const blockChip = (b: Block, compact = false) => {
    const c = CALENDAR_COLORS[b.status]
    return (
      <a
        key={b.id}
        href={b.href}
        title={`${b.title} · ${fmtTime(b.startsAt)}–${fmtTime(b.endsAt)} · ${b.portalStatus}${b.tutorName ? ` · ${b.tutorName}` : ''}`}
        className="block rounded px-1.5 py-0.5 text-[11px] leading-tight overflow-hidden hover:opacity-85"
        style={{
          background: c.bg,
          color: c.text,
          // PL-161: the suggested-for class's blocks are outlined so the
          // overlay comparison reads at a glance.
          ...(suggestClassId && b.classId === suggestClassId ? { outline: '2px solid #7C3AED', outlineOffset: '-1px' } : {}),
        }}
      >
        {compact ? (
          <span className="truncate block">
            {fmtTime(b.startsAt)} {b.title}
          </span>
        ) : (
          <>
            <span className="font-semibold block truncate">{b.title}</span>
            <span className="block truncate">
              {fmtTime(b.startsAt)}–{fmtTime(b.endsAt)}
              {b.kind === 'class' ? ' · class' : ''}
            </span>
          </>
        )}
      </a>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-hgl-slate">Calendar</h1>
            <p className="text-sm text-gray-500">
              1-on-1 sessions, class sessions, and proposed holds — all times in{' '}
              <span className="font-semibold">America/Denver</span>. Read-only: click any block to
              open its record.
            </p>
          </div>
          <a href="/admin" className="text-sm text-gray-500 underline hover:text-hgl-slate">
            ← Back to admin
          </a>
        </div>

        {/* Controls */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-center gap-2 text-sm">
          <div className="flex rounded-md overflow-hidden border border-gray-300">
            {(['week', 'month'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-semibold ${view === v ? 'bg-hgl-slate text-white' : 'bg-white text-gray-600'}`}
              >
                {v === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
          <button onClick={() => step(-1)} className="border rounded px-2 py-1">
            ‹
          </button>
          <button
            onClick={() => {
              // Always refetch — a status change elsewhere must recolor even
              // when the anchor doesn't move.
              setAnchor(dayIso(new Date()))
              load()
            }}
            className="border rounded px-2 py-1 text-xs font-semibold"
          >
            today
          </button>
          <button onClick={() => step(1)} className="border rounded px-2 py-1">
            ›
          </button>
          <span className="font-semibold text-hgl-slate">
            {view === 'week' ? `Week of ${rangeStartIso}` : monthLabel}
          </span>
          <span className="text-xs text-gray-400">· America/Denver</span>
          <span className="flex-1" />
          <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className="border rounded p-1.5">
            <option value="">everyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select value={placeFilter} onChange={(e) => setPlaceFilter(e.target.value)} className="border rounded p-1.5 max-w-56">
            <option value="">all schools & classes</option>
            {places.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded p-1.5">
            <option value="">all statuses</option>
            {(Object.keys(CALENDAR_COLORS) as CalendarStatus[]).map((s) => (
              <option key={s} value={s}>
                {CALENDAR_COLORS[s].label}
              </option>
            ))}
          </select>
        </div>

        {/* Legend — Kelsie's color language, verbatim */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          {(Object.keys(CALENDAR_COLORS) as CalendarStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded" style={{ background: CALENDAR_COLORS[s].bg }} />
              {CALENDAR_COLORS[s].label}
            </span>
          ))}
        </div>

        {/* PL-161: instructor-fit suggester panel (advisory only) */}
        {suggestClassId && (
          <div className="bg-white border border-purple-200 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <h2 className="font-bold text-hgl-slate">
                Who could teach {fit?.classLabel ?? 'this class'}?
                {fit ? ` · ${fit.sessionCount} session${fit.sessionCount === 1 ? '' : 's'}` : ''}
                {fit?.inPerson ? ' · in person (travel window applies)' : ''}
              </h2>
              <button
                onClick={() => {
                  setSuggestClassId('')
                  setOverlayTutor('')
                }}
                className="text-xs text-gray-500 underline"
              >
                close suggestions
              </button>
            </div>
            {fitLoading && <p className="text-xs text-gray-400 animate-pulse">Checking every active instructor…</p>}
            {fit?.note && <p className="text-xs text-gray-500 italic">{fit.note}</p>}
            {fit && !fit.googleUp && (
              <p className="text-xs text-amber-700 mb-2">
                Google availability is unreachable right now — rankings below use portal commitments only.
              </p>
            )}
            {fit && (
              <ul className="divide-y divide-gray-100">
                {fit.candidates.map((c) => (
                  <li key={c.id} className="py-2 flex flex-wrap items-start gap-2">
                    <button
                      onClick={() => setOverlayTutor(overlayTutor === c.id ? '' : c.id)}
                      className={`text-xs font-bold px-2 py-1 rounded ${
                        overlayTutor === c.id ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700'
                      }`}
                      title="Show this instructor's busy time on the calendar below — see exactly what the ranking saw"
                    >
                      {overlayTutor === c.id ? 'shown below' : 'show on calendar'}
                    </button>
                    <span className="font-semibold text-hgl-slate">{c.name}</span>
                    {c.current && <span className="text-[10px] uppercase font-bold bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">currently assigned</span>}
                    {c.available ? (
                      <span className="text-xs text-green-700 font-semibold">
                        free for every session{c.googleChecked ? '' : ' (portal data only — Google not checked)'}
                        {c.travelConflicts.length > 0 ? ` · ${c.travelConflicts.length} travel-window overlap${c.travelConflicts.length === 1 ? '' : 's'}` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-red-700 font-semibold">
                        conflicts with {c.hardConflicts.length} session{c.hardConflicts.length === 1 ? '' : 's'}
                      </span>
                    )}
                    {(c.hardConflicts.length > 0 || c.travelConflicts.length > 0) && (
                      <ul className="w-full ml-6 text-xs text-gray-600 list-disc">
                        {c.hardConflicts.map((x, i) => (
                          <li key={`h${i}`} className="text-red-700">{x}</li>
                        ))}
                        {c.travelConflicts.map((x, i) => (
                          <li key={`t${i}`} className="text-amber-700">{x}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-400 mt-2">
              Suggestions are advisory — assignment stays your explicit choice on the class page.
              Class sessions are outlined in purple below{overlayTutor ? '; the selected instructor’s busy time is shaded gray' : ''}.
            </p>
          </div>
        )}

        {error && <div className="p-3 rounded bg-red-100 text-red-700 text-sm font-semibold">{error}</div>}
        {loading && <p className="text-sm text-gray-400 animate-pulse">Loading…</p>}

        {view === 'week' ? (
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
                <div />
                {weekDays.map((d) => (
                  <div key={d} className="px-2 py-2 text-xs font-bold text-hgl-slate border-l border-gray-100">
                    {new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })}
                    {d === dayIso(new Date()) && <span className="ml-1 text-hgl-blue">· today</span>}
                  </div>
                ))}
              </div>
              <div className="grid relative" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
                {/* hour gutter */}
                <div className="relative" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
                  {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                    <div key={i} className="absolute right-1 text-[10px] text-gray-400" style={{ top: i * HOUR_PX - 6 }}>
                      {((HOUR_START + i + 11) % 12) + 1} {HOUR_START + i < 12 ? 'AM' : 'PM'}
                    </div>
                  ))}
                </div>
                {weekDays.map((d) => {
                  const dayBlocks = (byDay.get(d) ?? []).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                  const dayOverlay = overlayBusy.filter((o) => denverDay(o.start) === d)
                  return (
                    <div key={d} className="relative border-l border-gray-100" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
                      {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                        <div key={i} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: i * HOUR_PX }} />
                      ))}
                      {/* PL-161: the picked candidate's busy time, shaded so
                          the fit (or the clash) is visible, not asserted. */}
                      {dayOverlay.map((o, i) => {
                        const startH = Math.max(denverHour(o.start), HOUR_START)
                        const endH = Math.min(Math.max(denverHour(o.end), startH + 0.3), HOUR_END)
                        return (
                          <div
                            key={`ov-${i}`}
                            className="absolute left-0 right-0 bg-gray-500/25 border border-gray-400/40 rounded-sm"
                            style={{ top: (startH - HOUR_START) * HOUR_PX, height: (endH - startH) * HOUR_PX }}
                            title={`busy: ${o.title ?? 'private event'}`}
                          />
                        )
                      })}
                      {dayBlocks.map((b, i) => {
                        const startH = Math.max(denverHour(b.startsAt), HOUR_START)
                        const endH = Math.min(Math.max(denverHour(b.endsAt), startH + 0.4), HOUR_END)
                        // naive overlap fanning: nth overlapping block indents
                        const overlaps = dayBlocks.filter(
                          (o, j) => j < i && o.startsAt < b.endsAt && o.endsAt > b.startsAt
                        ).length
                        return (
                          <div
                            key={b.id}
                            className="absolute"
                            style={{
                              top: (startH - HOUR_START) * HOUR_PX + 1,
                              height: Math.max((endH - startH) * HOUR_PX - 2, 18),
                              left: 2 + overlaps * 14,
                              right: 2,
                              zIndex: 1 + overlaps,
                            }}
                          >
                            {blockChip(b)}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <div className="min-w-[900px] grid grid-cols-7">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="px-2 py-1.5 text-xs font-bold text-hgl-slate border-b border-gray-200">
                  {d}
                </div>
              ))}
              {monthDays.map((d) => {
                const inMonth = d.slice(0, 7) === anchor.slice(0, 7)
                const dayBlocks = (byDay.get(d) ?? []).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                return (
                  <div
                    key={d}
                    className={`min-h-24 border-b border-l border-gray-100 p-1 space-y-0.5 ${inMonth ? '' : 'bg-gray-50 opacity-60'}`}
                  >
                    <div className={`text-[11px] ${d === dayIso(new Date()) ? 'font-bold text-hgl-blue' : 'text-gray-400'}`}>
                      {Number(d.slice(8, 10))}
                    </div>
                    {dayBlocks.slice(0, 4).map((b) => blockChip(b, true))}
                    {dayBlocks.length > 4 && (
                      <div className="text-[10px] text-gray-400">+{dayBlocks.length - 4} more</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
