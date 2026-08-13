'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { autoTutorColor } from '../../utils/calendar-colors'
import { classifyNotice, isoWeekday, zonedToUtc } from '../../utils/tutoring'
import { DateHint } from '../ui'
import { WEEKDAYS, fmtTime, wallClock, type RecurrenceSlotUI, type SessionRow, type Tutor } from './types'
import type { WizardDraft } from './engagement-wizard'

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

// PL-337: a dragged proposal — weekly slot rows ONLY (the engagement's
// recurrence model; the popover deliberately offers no other cadence, so a
// proposal can never express something the wizard can't store).
type DragState =
  | { kind: 'create'; dayIso: string; startY: number; endY: number }
  | { kind: 'move'; index: number; y: number; grabOffset: number }
  | { kind: 'resize'; index: number; y: number }

/** 'HH:MM' → "4:00 PM". */
function fmtHHMMLocal(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const snapQuarter = (hours: number) => Math.round(hours * 4) / 4
const hoursToHHMM = (hours: number) => {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const hhmmToHours = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h + m / 60
}

export default function ScheduleView({
  tutors,
  refreshSignal,
  focusSessionId = null,
  focusAction = null,
  onUseProposal,
  onDraftsChanged,
}: {
  tutors: Tutor[]
  refreshSignal: number
  /** PL-262: the reschedule-request alert deep-links a session — jump to its
   *  tutor + week and open its dialog. */
  focusSessionId?: string | null
  focusAction?: 'ack' | 'reschedule' | null
  /** PL-337 C: "Use this schedule" hands the dragged proposal to the wizard
   *  as a prefill — nothing mutates until the wizard's normal Create. */
  onUseProposal?: (payload: Partial<WizardDraft>) => void
  /** PL-338 E: the proposal saved as a draft — the card/dashboard recount. */
  onDraftsChanged?: () => void
}) {
  const activeTutors = useMemo(() => tutors.filter((t) => t.tutoring_active), [tutors])
  const [mode, setMode] = useState<'week' | 'day'>('week')
  // PL-285: the week view is multi-select now — null = "all tutors" (the
  // default), a Set = an explicit pick. Kept as null rather than a filled Set
  // so the default survives the tutors list arriving async.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null)

  // PL-283: per-tutor color — assigned wins, else a stable palette pick
  // computed against every assigned color (all instructors, not just active).
  const tutorColor = useMemo(() => {
    const assigned = new Map(
      tutors.filter((t) => t.calendar_color).map((t) => [t.id, t.calendar_color as string])
    )
    const taken = Array.from(assigned.values())
    return (id: string) => assigned.get(id) ?? autoTutorColor(id, taken)
  }, [tutors])
  const tutorNameFor = useMemo(() => {
    const m = new Map(tutors.map((t) => [t.id, t.name ?? t.email]))
    return (id: string) => m.get(id) ?? null
  }, [tutors])
  const [anchor, setAnchor] = useState(() => new Date())
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [busy, setBusy] = useState<{ start: string; end: string; title: string | null; private: boolean }[]>([])
  const [selected, setSelected] = useState<SessionRow | null>(null)
  const [message, setMessage] = useState('')
  // PL-262: the deep-linked session's dialog opens with the right action
  // ready — consumed once so closing the dialog behaves normally after.
  const [pendingFocusAction, setPendingFocusAction] = useState(focusAction)
  useEffect(() => {
    if (!focusSessionId) return
    let stale = false
    ;(async () => {
      const { data } = await supabase.from('tutoring_sessions').select(SELECT).eq('id', focusSessionId).maybeSingle()
      if (stale || !data) return
      const [row] = normalize([data])
      if (!row) return
      // Land on the session's tutor + week so the grid behind the dialog
      // shows its context, then open the dialog itself.
      setSelectedIds(new Set([row.tutor_id]))
      setAnchor(new Date(row.starts_at))
      setSelected(row)
    })()
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSessionId])
  // PL-17: hidden tutor calendars in day mode (Google-style show/hide).
  const [hiddenTutorIds, setHiddenTutorIds] = useState<Set<string>>(new Set())
  // PL-18: open the 24h scroller at a sane morning hour.
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = SCROLL_TO * HOUR_PX
  }, [])

  // PL-285: the effective week-mode selection (null = everyone).
  const selectedTutors = useMemo(
    () => (selectedIds === null ? activeTutors : activeTutors.filter((t) => selectedIds.has(t.id))),
    [selectedIds, activeTutors]
  )
  // Exactly one tutor selected keeps the old single-tutor behaviors: their
  // timezone and their Google freebusy shading. More than one → Denver (no
  // single wall clock exists) and no shading.
  const tutor = selectedTutors.length === 1 ? selectedTutors[0] : null
  const tz = mode === 'week' && tutor ? (tutor.timezone ?? 'America/Denver') : 'America/Denver'

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

  // PL-180: sessions whose calendar event was edited outside the portal —
  // the grid marks them so the pending decision is visible in place.
  const [driftIds, setDriftIds] = useState<Set<string>>(new Set())
  // Stable dependency for the selection (a Set is a fresh object per render).
  const selectedKey = useMemo(
    () => (selectedIds === null ? 'all' : [...selectedIds].sort().join(',')),
    [selectedIds]
  )
  const load = useCallback(async () => {
    // PL-285: nothing selected = nothing to fetch (and .in() with an empty
    // list is a PostgREST error, not an empty result).
    if (mode === 'week' && selectedTutors.length === 0) {
      setSessions([])
      return
    }
    let q = supabase
      .from('tutoring_sessions')
      .select(SELECT)
      .gte('starts_at', new Date(rangeStart).toISOString())
      .lte('starts_at', new Date(rangeEnd).toISOString())
      .order('starts_at')
    if (mode === 'week' && selectedIds !== null)
      q = q.in('tutor_id', selectedTutors.map((t) => t.id))
    const { data, error } = await q
    if (!error) setSessions(normalize(data ?? []))
    const { data: drift } = await supabase.from('calendar_drift').select('session_id')
    setDriftIds(new Set(((drift ?? []) as { session_id: string }[]).map((d) => d.session_id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedKey, selectedTutors.length, rangeStart, rangeEnd])

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
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((json) => setBusy(json?.available ? json.busy : []))
      .catch(() => setBusy([]))
  }, [mode, tutor, rangeStart, rangeEnd])

  function shift(days: number) {
    setAnchor((a) => new Date(a.getTime() + days * 86_400_000))
  }

  // -------------------------------------------------------------------------
  // PL-337: drag-to-propose. Dragging on empty grid (week mode, exactly one
  // tutor selected) creates dashed PROPOSED blocks — weekly slot rows, the
  // only cadence the engagement can store. The blocks project onto every
  // future week while paging (each week's own busy data + sessions render
  // behind them), a horizon summary checks ~3 months ahead in chunked
  // freebusy calls, and "Use this schedule" prefills the wizard. Nothing
  // mutates until the wizard's normal Create. Proposal lifetime = component
  // state: survives scrolling, not navigation (the wizard-draft rule).
  // -------------------------------------------------------------------------
  const [proposal, setProposal] = useState<RecurrenceSlotUI[]>([])
  const [proposalStartWeek, setProposalStartWeek] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [horizonWeeks, setHorizonWeeks] = useState(12)
  const [proposalMsg, setProposalMsg] = useState('')
  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'tutoring_proposal_horizon_weeks')
      .maybeSingle()
      .then(({ data }) => {
        const n = Number(data?.value ?? 12)
        // Scarlett wants up to 6 months; the route math stays sane below 1.
        if (Number.isFinite(n)) setHorizonWeeks(Math.min(26, Math.max(1, n)))
      })
  }, [])
  // Switching tutors drops the proposal — it was drawn against ONE tutor's
  // calendar; silently re-aiming it at another would fake a clean check.
  const proposalTutorRef = useRef<string | null>(null)
  useEffect(() => {
    if (proposal.length === 0) {
      proposalTutorRef.current = tutor?.id ?? null
      return
    }
    if (tutor?.id !== proposalTutorRef.current) {
      setProposal([])
      setProposalStartWeek(null)
      setProposalMsg('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor?.id])

  const columnYToHours = (colEl: HTMLElement, clientY: number) => {
    const rect = colEl.getBoundingClientRect()
    return Math.min(DAY_END, Math.max(DAY_START, (clientY - rect.top) / HOUR_PX + DAY_START))
  }

  function beginCreateDrag(e: React.PointerEvent<HTMLDivElement>, dayIso: string) {
    if (mode !== 'week' || !tutor || e.button !== 0) return
    // A drag starting on a session chip is the chip's own interaction.
    if ((e.target as HTMLElement).closest('button')) return
    const y = columnYToHours(e.currentTarget, e.clientY)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragState({ kind: 'create', dayIso, startY: y, endY: y })
  }

  function columnPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState) return
    const y = columnYToHours(e.currentTarget, e.clientY)
    setDragState((d) => {
      if (!d) return d
      if (d.kind === 'create') return { ...d, endY: y }
      return { ...d, y }
    })
  }

  function columnPointerUp() {
    if (!dragState) return
    if (dragState.kind === 'create') {
      const a = snapQuarter(Math.min(dragState.startY, dragState.endY))
      const b = snapQuarter(Math.max(dragState.startY, dragState.endY))
      const durationMinutes = Math.round((b - a) * 60)
      // A plain click (no real drag) creates nothing — accidental blocks are
      // worse than one more deliberate drag.
      if (durationMinutes >= 15) {
        const slot: RecurrenceSlotUI = {
          weekday: isoWeekday(dragState.dayIso),
          start_time: hoursToHHMM(a),
          duration_minutes: Math.min(480, durationMinutes),
        }
        setProposal((p) => [...p, slot])
        if (!proposalStartWeek) setProposalStartWeek(range.days[0])
        setProposalMsg('')
      }
    } else if (dragState.kind === 'move') {
      const start = snapQuarter(dragState.y - dragState.grabOffset)
      setProposal((p) =>
        p.map((s, i) =>
          i === dragState.index
            ? {
                ...s,
                start_time: hoursToHHMM(
                  Math.max(DAY_START, Math.min(DAY_END - s.duration_minutes / 60, start))
                ),
              }
            : s
        )
      )
    } else {
      const end = snapQuarter(dragState.y)
      setProposal((p) =>
        p.map((s, i) => {
          if (i !== dragState.index) return s
          const startH = hhmmToHours(s.start_time)
          const minutes = Math.round((end - startH) * 60)
          return { ...s, duration_minutes: Math.max(15, Math.min(480, minutes)) }
        })
      )
    }
    setDragState(null)
  }

  function beginBlockDrag(e: React.PointerEvent<HTMLDivElement>, index: number) {
    if (e.button !== 0) return
    e.stopPropagation()
    const colEl = (e.currentTarget as HTMLElement).parentElement as HTMLElement
    const y = columnYToHours(colEl, e.clientY)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const nearBottom = e.clientY > rect.bottom - 8
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const slot = proposal[index]
    setDragState(
      nearBottom
        ? { kind: 'resize', index, y }
        : { kind: 'move', index, y, grabOffset: y - hhmmToHours(slot.start_time) }
    )
  }

  function blockPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.kind === 'create') return
    const colEl = (e.currentTarget as HTMLElement).parentElement as HTMLElement
    const y = columnYToHours(colEl, e.clientY)
    setDragState((d) => (d && d.kind !== 'create' ? { ...d, y } : d))
  }

  /** The proposed blocks that belong on a day column, with live drag echo. */
  function proposalBlocksForDay(dayIso: string) {
    if (mode !== 'week' || !tutor || proposal.length === 0) return []
    // Forward projection only: every week from the proposal's own week on.
    if (proposalStartWeek && range.days[0] < proposalStartWeek) return []
    const weekday = isoWeekday(dayIso)
    const out: { index: number; startH: number; durH: number }[] = []
    proposal.forEach((s, index) => {
      if (s.weekday !== weekday) return
      let startH = hhmmToHours(s.start_time)
      let durH = s.duration_minutes / 60
      if (dragState && dragState.kind === 'move' && dragState.index === index) {
        startH = Math.max(
          DAY_START,
          Math.min(DAY_END - durH, snapQuarter(dragState.y - dragState.grabOffset))
        )
      }
      if (dragState && dragState.kind === 'resize' && dragState.index === index) {
        durH = Math.max(0.25, snapQuarter(dragState.y) - startH)
      }
      out.push({ index, startH, durH })
    })
    // The in-flight create drag echoes live on its own day.
    if (dragState?.kind === 'create' && dragState.dayIso === dayIso) {
      const a = Math.min(dragState.startY, dragState.endY)
      const b = Math.max(dragState.startY, dragState.endY)
      if (b - a >= 0.1) out.push({ index: -1, startH: snapQuarter(a), durH: Math.max(0.25, snapQuarter(b) - snapQuarter(a)) })
    }
    return out
  }

  // PL-337 B: the horizon summary — the proposed recurrence checked
  // ~horizonWeeks ahead against the same veto inputs the picker uses: the
  // tutor's Google freebusy (which already carries the PL-159 portal holds)
  // plus the tutor's portal sessions. The freebusy route caps one request at
  // 45 days, so the horizon stitches sequential 44-day chunks; how far the
  // Google side ACTUALLY reached is reported, never implied.
  const [horizon, setHorizon] = useState<
    | null
    | {
        checking: boolean
        conflict: { when: Date; label: string } | null
        gcalThrough: string | null // ISO date the Google check reached, null = not connected/failed
        weeks: number
      }
  >(null)
  const proposalKey = useMemo(
    () => proposal.map((s) => `${s.weekday}:${s.start_time}:${s.duration_minutes}`).join('|'),
    [proposal]
  )
  useEffect(() => {
    if (proposal.length === 0 || !tutor || !proposalStartWeek) {
      setHorizon(null)
      return
    }
    let stale = false
    const tutorTz = tutor.timezone ?? 'America/Denver'
    setHorizon({ checking: true, conflict: null, gcalThrough: null, weeks: horizonWeeks })
    ;(async () => {
      const horizonDays = horizonWeeks * 7
      const fromMs = zonedToUtc(proposalStartWeek, '00:00', tutorTz).getTime()
      const toMs = fromMs + horizonDays * 86_400_000
      // 1. Google freebusy, stitched in 44-day chunks (under the 45-day cap).
      const busyBlocks: { start: string; end: string; title: string | null }[] = []
      let gcalThrough: string | null = null
      for (let chunkStart = fromMs; chunkStart < toMs; chunkStart += 44 * 86_400_000) {
        const chunkEnd = Math.min(chunkStart + 44 * 86_400_000, toMs)
        try {
          const res = await fetch('/api/gcal/freebusy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tutorId: tutor.id,
              timeMin: new Date(chunkStart).toISOString(),
              timeMax: new Date(chunkEnd).toISOString(),
            }),
          })
          const json = res.ok ? await res.json().catch(() => null) : null
          if (!json?.available) break // not connected / errored — stop stitching
          busyBlocks.push(...(json.busy ?? []))
          gcalThrough = new Date(chunkEnd).toISOString()
        } catch {
          break
        }
        if (stale) return
      }
      // 2. The tutor's portal sessions across the whole horizon.
      const { data: portalRows } = await supabase
        .from('tutoring_sessions')
        .select('starts_at, ends_at, status, students ( first_name )')
        .eq('tutor_id', tutor.id)
        .in('status', ['proposed', 'confirmed'])
        .gte('starts_at', new Date(fromMs).toISOString())
        .lt('starts_at', new Date(toMs).toISOString())
      if (stale) return
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const portal = ((portalRows as any[]) ?? []).map((r) => ({
        start: r.starts_at,
        end: r.ends_at,
        title: `${(Array.isArray(r.students) ? r.students[0] : r.students)?.first_name ?? 'a student'}'s session`,
      }))
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const all = [...busyBlocks, ...portal]
      // 3. Walk the occurrences week by week, earliest conflict wins.
      let conflict: { when: Date; label: string } | null = null
      outer: for (let w = 0; w < horizonWeeks; w++) {
        const weekMon = new Date(new Date(proposalStartWeek + 'T12:00:00Z').getTime() + w * 7 * 86_400_000)
          .toISOString()
          .slice(0, 10)
        const sorted = [...proposal].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
        for (const s of sorted) {
          const dayIso = new Date(new Date(weekMon + 'T12:00:00Z').getTime() + (s.weekday - 1) * 86_400_000)
            .toISOString()
            .slice(0, 10)
          const start = zonedToUtc(dayIso, s.start_time, tutorTz).getTime()
          if (start < Date.now()) continue
          const end = start + s.duration_minutes * 60_000
          const hit = all.find((b) => new Date(b.start).getTime() < end && new Date(b.end).getTime() > start)
          if (hit) {
            conflict = { when: new Date(start), label: hit.title ?? 'busy per Google Calendar' }
            break outer
          }
        }
      }
      if (!stale) setHorizon({ checking: false, conflict, gcalThrough, weeks: horizonWeeks })
    })()
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalKey, tutor?.id, proposalStartWeek, horizonWeeks])

  /** PL-337 C: the wizard prefill payload — tutor, slots, start date. */
  function proposalPayload(): Partial<WizardDraft> {
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: tutor?.timezone ?? 'America/Denver' })
    const firstDates = proposal
      .map((s) =>
        new Date(new Date((proposalStartWeek ?? range.days[0]) + 'T12:00:00Z').getTime() + (s.weekday - 1) * 86_400_000)
          .toISOString()
          .slice(0, 10)
      )
      .sort()
    const startDate = firstDates.find((d) => d >= todayIso) ?? firstDates[0] ?? ''
    return {
      savedAt: new Date().toISOString(),
      tutorId: tutor?.id ?? '',
      slots: proposal,
      startDate,
      sessionsPerWeek: Math.min(5, Math.max(1, proposal.length)),
      durationMinutes: proposal[0]?.duration_minutes ?? 60,
      requireApproval: true,
    }
  }

  async function saveProposalAsDraft() {
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase.from('tutoring_schedule_drafts').insert({
      created_by: auth.user?.email ?? 'staff',
      student_label: null,
      payload: proposalPayload(),
    })
    if (error) {
      setProposalMsg('Error: the draft did not save — ' + error.message)
      return
    }
    setProposal([])
    setProposalStartWeek(null)
    setProposalMsg('Saved under Schedules in progress — resume it from there any time.')
    onDraftsChanged?.()
  }

  /** Blocks (top/height px + label) that overlap a given calendar date in tz.
   *  PL-337: all-day and overnight events used to render as a 10px sliver on
   *  their start day only (an event ending 00:00 next day computed height 0)
   *  — a proposed block over an all-day busy day read as clean while the
   *  horizon check flagged it. Days inside a multi-day span now shade fully. */
  function blocksForDay(dayIso: string, items: typeof busy) {
    const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz })
    return items
      .filter((b) => {
        const startDay = dayOf(b.start)
        // An event ending exactly at midnight belongs to the previous day.
        const endDay = dayOf(new Date(new Date(b.end).getTime() - 1).toISOString())
        return startDay <= dayIso && dayIso <= endDay
      })
      .map((b) => {
        const startDay = dayOf(b.start)
        const s = startDay < dayIso ? { hour: DAY_START, minute: 0 } : wallClock(b.start, tz)
        // The RAW end day here: an event ending exactly at next-midnight has
        // wallClock hour 0, which used to compute a zero-height block.
        const e = dayOf(b.end) > dayIso ? { hour: DAY_END, minute: 0 } : wallClock(b.end, tz)
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

  // PL-285: toggle one tutor in the week-mode multi-select ("all" expands to
  // an explicit set the first time someone narrows it).
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const base = prev === null ? new Set(activeTutors.map((t) => t.id)) : new Set(prev)
      if (base.has(id)) base.delete(id)
      else base.add(id)
      return base
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
        {/* PL-285: multi-select tutor chips (PL-283 colors double as the
            legend) with Select all / Deselect all. */}
        {mode === 'week' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeTutors.map((t) => {
              const on = selectedIds === null || selectedIds.has(t.id)
              const color = tutorColor(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleSelected(t.id)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-semibold ${
                    on ? 'bg-white text-gray-800' : 'bg-gray-100 text-gray-400 border-gray-200'
                  }`}
                  style={on ? { borderColor: color } : {}}
                  title={on ? 'Shown — click to hide' : 'Hidden — click to show'}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: color, opacity: on ? 1 : 0.35 }}
                  />
                  {t.name ?? t.email}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setSelectedIds(null)}
              className="text-xs text-hgl-blue underline ml-1"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-500 underline"
            >
              Deselect all
            </button>
          </div>
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
          {mode === 'week' &&
            selectedTutors.length > 1 &&
            ' · Google busy shading shows when exactly one tutor is selected'}
          {mode === 'week' && tutor && proposal.length === 0 && ' · drag on empty grid to propose weekly times'}
        </span>
      </div>

      {/* PL-337: the proposal panel — the dragged blocks' controls + the
          horizon summary. Dashed styling everywhere says "not real yet";
          nothing here mutates anything. */}
      {proposal.length > 0 && tutor && (
        <div className="border-2 border-dashed border-sky-400 bg-sky-50/60 rounded-lg p-3 space-y-2">
          <p className="font-semibold text-hgl-slate">
            Proposed schedule for {tutor.name ?? tutor.email}{' '}
            <span className="font-normal text-xs text-gray-500">
              — nothing is saved yet; repeats weekly (weekly times are the only cadence a schedule
              stores — add another day by dragging again, drag a block to move it, drag its bottom
              edge to resize)
            </span>
          </p>
          <div className="space-y-1">
            {proposal.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={s.weekday}
                  onChange={(e) =>
                    setProposal((p) => p.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))
                  }
                  className="border border-gray-300 rounded p-1 bg-white"
                >
                  {WEEKDAYS.map((d, di) => (
                    <option key={d} value={di + 1}>
                      {d}
                    </option>
                  ))}
                </select>
                <span className="text-gray-700">
                  {fmtHHMMLocal(s.start_time)} · {s.duration_minutes} min
                </span>
                <button
                  onClick={() => {
                    setProposal((p) => p.filter((_, j) => j !== i))
                    if (proposal.length === 1) {
                      setProposalStartWeek(null)
                      setProposalMsg('')
                    }
                  }}
                  className="text-gray-500 underline"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
          {/* The horizon summary — checked span named, certainty never
              implied (freebusy only shows events that EXIST; far-out weeks
              may just be unfilled calendars). */}
          <p className="text-xs text-gray-600">
            {!horizon || horizon.checking ? (
              'Checking the weeks ahead…'
            ) : horizon.conflict ? (
              <>
                <span className="font-semibold text-red-700">
                  First conflict:{' '}
                  {horizon.conflict.when.toLocaleString('en-US', {
                    timeZone: tutor.timezone ?? 'America/Denver',
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}{' '}
                  — {horizon.conflict.label}.
                </span>{' '}
                <button
                  onClick={() => setAnchor(new Date(horizon.conflict!.when))}
                  className="text-hgl-blue underline"
                >
                  jump to that week
                </button>
              </>
            ) : (
              <>
                <span className="font-semibold text-green-700">
                  No conflicts on the calendar for the next {horizon.weeks} weeks
                </span>{' '}
                {horizon.gcalThrough
                  ? `(Google Calendar checked through ${new Date(horizon.gcalThrough).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, portal sessions the same span — far-out weeks may simply be unfilled calendars).`
                  : `(the tutor's Google Calendar isn't connected or didn't answer — portal sessions checked for the whole span).`}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={() => {
                onUseProposal?.(proposalPayload())
                setProposal([])
                setProposalStartWeek(null)
                setProposalMsg('')
              }}
              className="bg-hgl-slate text-white text-xs font-bold py-1.5 px-4 rounded hover:opacity-90"
              title="Prefill the New student schedule wizard with this tutor, these weekly times, and the start date — you pick the student, subject, and rate there; nothing is created until its Create button"
            >
              Use this schedule
            </button>
            {/* PL-338 E: same draft model as the wizard's Save as draft. */}
            <button
              onClick={saveProposalAsDraft}
              className="border border-hgl-slate text-hgl-slate text-xs font-semibold py-1.5 px-3 rounded hover:bg-white"
            >
              Save as draft
            </button>
            <button
              onClick={() => {
                setProposal([])
                setProposalStartWeek(null)
                setProposalMsg('')
              }}
              className="text-xs text-gray-500 underline"
            >
              Clear proposal
            </button>
          </div>
        </div>
      )}
      {proposalMsg && (
        <p className={`text-xs font-semibold ${proposalMsg.startsWith('Error') ? 'text-red-700' : 'text-green-700'}`}>
          {proposalMsg}
        </p>
      )}

      {activeTutors.length === 0 ? (
        <p className="text-gray-500 italic">No active tutors yet — enable tutoring on an instructor below.</p>
      ) : mode === 'week' && selectedTutors.length === 0 ? (
        <p className="text-gray-500 italic">
          No tutors selected — click a tutor above, or use Select all.
        </p>
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
                  {/* PL-283 */}
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: tutorColor(t.id) }}
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
                    {mode === 'week' ? (
                      new Date(dayIso + 'T12:00:00Z').toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })
                    ) : (
                      <>
                        {/* PL-283 */}
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-1"
                          style={{ background: colTutor ? tutorColor(colTutor.id) : '#9CA3AF' }}
                        />
                        {colTutor?.name ?? colTutor?.email}
                      </>
                    )}
                  </div>
                  <div
                    className={`relative bg-white ${mode === 'week' && tutor ? 'cursor-crosshair' : ''}`}
                    style={{ height: (DAY_END - DAY_START) * HOUR_PX }}
                    // PL-337 A: drag on empty grid creates a proposed block.
                    onPointerDown={(e) => beginCreateDrag(e, dayIso)}
                    onPointerMove={columnPointerMove}
                    onPointerUp={columnPointerUp}
                  >
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
                      // PL-283: live chips (proposed/confirmed) wear the
                      // tutor's color — tint + border, dashed = proposed.
                      // Terminal states (completed/rescheduled/XCL) keep the
                      // status styling; the 4px left bar still names the
                      // tutor at a glance.
                      const color = tutorColor(s.tutor_id)
                      const terminal = ['completed', 'rescheduled', 'forfeited', 'no_show'].includes(s.status)
                      const sTutorName = tutorNameFor(s.tutor_id)
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSelected(s)}
                          className={`absolute inset-x-0.5 rounded border px-1 py-0.5 text-left text-[11px] leading-tight overflow-hidden ${
                            terminal
                              ? (STATUS_STYLES[s.status] ?? 'bg-gray-100 border-gray-300')
                              : `text-gray-900 ${s.status === 'proposed' ? 'border-dashed' : ''}`
                          }`}
                          style={{
                            top,
                            height,
                            ...(terminal
                              ? { borderLeftColor: color, borderLeftWidth: 4, borderLeftStyle: 'solid' }
                              : { background: `${color}26`, borderColor: color, borderLeftWidth: 4 }),
                          }}
                          title={`${s.students?.first_name ?? ''} ${s.students?.last_name ?? ''} · ${s.status}${sTutorName ? ` · ${sTutorName}` : ''}${driftIds.has(s.id) ? ' · calendar edited outside the portal — decide on the banner above' : ''}`}
                        >
                          <span className="font-semibold">
                            {fmtTime(s.starts_at, tz)} {s.students?.first_name}
                            {s.reschedule_requested_at && s.status === 'confirmed' && ' ⟳'}
                            {driftIds.has(s.id) && <span className="text-amber-600"> ⚠</span>}
                          </span>
                          <br />
                          {s.tutoring_engagements?.subjects?.name}
                          {(s.status === 'forfeited' || s.status === 'no_show') && ' · XCL'}
                        </button>
                      )
                    })}
                    {/* PL-337: the dashed proposed blocks — projected onto
                        every future week, each week's own busy data +
                        sessions behind them, conflicts flagged in place. */}
                    {mode === 'week' &&
                      proposalBlocksForDay(dayIso).map((b) => {
                        const topPx = (b.startH - DAY_START) * HOUR_PX
                        const hPx = Math.max(12, b.durH * HOUR_PX)
                        const busyHit = busyBlocks.find((bb) => bb.top < topPx + hPx && bb.top + bb.height > topPx)
                        const sessionHit = colSessions.find((s) => {
                          if (!['proposed', 'confirmed'].includes(s.status)) return false
                          const st = wallClock(s.starts_at, tz)
                          const sTop = (st.hour + st.minute / 60 - DAY_START) * HOUR_PX
                          const sH = (s.duration_minutes / 60) * HOUR_PX
                          return sTop < topPx + hPx && sTop + sH > topPx
                        })
                        const conflictLabel = busyHit
                          ? busyHit.label
                          : sessionHit
                            ? `${sessionHit.students?.first_name ?? 'a student'}'s session`
                            : null
                        return (
                          <div
                            key={`prop-${b.index}-${dayIso}`}
                            className={`absolute inset-x-0.5 rounded border-2 border-dashed px-1 py-0.5 text-[11px] leading-tight overflow-hidden select-none z-10 ${
                              conflictLabel
                                ? 'border-red-500 bg-red-100/70 text-red-800'
                                : 'border-sky-500 bg-sky-100/70 text-sky-900'
                            } ${b.index >= 0 ? 'cursor-move' : ''}`}
                            style={{ top: topPx, height: hPx }}
                            onPointerDown={b.index >= 0 ? (e) => beginBlockDrag(e, b.index) : undefined}
                            onPointerMove={b.index >= 0 ? blockPointerMove : undefined}
                            onPointerUp={b.index >= 0 ? columnPointerUp : undefined}
                            title={
                              conflictLabel
                                ? `Proposed — conflicts with ${conflictLabel}`
                                : 'Proposed — weekly; drag to move, drag the bottom edge to resize'
                            }
                          >
                            <span className="font-semibold">
                              {fmtHHMMLocal(hoursToHHMM(b.startH))} proposed
                            </span>
                            {conflictLabel && (
                              <>
                                <br />
                                conflicts with {conflictLabel}
                              </>
                            )}
                            {b.index >= 0 && (
                              <span
                                className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                                aria-hidden
                              />
                            )}
                          </div>
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
          initialAction={pendingFocusAction === 'reschedule' ? 'reschedule' : 'none'}
          ackFocus={pendingFocusAction === 'ack'}
          onClose={(msg) => {
            setSelected(null)
            setPendingFocusAction(null)
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

/** PL-262: "got your message" one-clicker on the pending-request banner —
 *  sends the parent the T3 ack (idempotent per request stamp server-side). */
function AckButton({ sessionId, preArmed = false }: { sessionId: string; preArmed?: boolean }) {
  const [armed, setArmed] = useState(preArmed)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  if (result) {
    return (
      <p className={`mt-1 font-semibold ${result.startsWith('Error') ? 'text-red-700' : 'text-green-700'}`}>
        {result}
      </p>
    )
  }
  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="mt-1 text-amber-900 font-semibold underline"
      >
        Acknowledge — email the family we got it
      </button>
    )
  }
  return (
    <span className="mt-1 inline-flex flex-wrap items-center gap-2">
      <span>Send the family a &ldquo;got your message, we&apos;re on it&rdquo; email?</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const res = await fetch('/api/admin/tutoring/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'ack_reschedule', id: sessionId }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) setResult('Error: ' + (json.error ?? 'could not send'))
            else setResult(json.already ? 'Already acknowledged — no second email sent.' : '✓ Acknowledgment sent to the family.')
          } catch {
            setResult('Error: could not reach the server.')
          } finally {
            setBusy(false)
          }
        }}
        className="text-green-700 font-semibold underline disabled:opacity-50"
      >
        {busy ? 'sending…' : 'Yes, send it'}
      </button>
      <button type="button" onClick={() => setArmed(false)} className="text-gray-500 underline">
        cancel
      </button>
    </span>
  )
}

function SessionDialog({
  session,
  tz,
  onClose,
  initialAction = 'none',
  ackFocus = false,
}: {
  session: SessionRow
  tz: string
  onClose: (message?: string) => void
  /** PL-262: the alert email's deep link can open straight into Reschedule. */
  initialAction?: 'none' | 'reschedule'
  /** PL-262: the alert email's ack link pre-arms the Acknowledge confirm. */
  ackFocus?: boolean
}) {
  const [action, setAction] = useState<'none' | 'reschedule' | 'edit_time' | 'forfeit' | 'no_show' | 'delete'>(initialAction)
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
    const json = await res.json().catch(() => ({}))
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
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
              <p>
                <span className="font-bold">Family asked to move this session</span> (
                {new Date(session.reschedule_requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                ){session.reschedule_request_note ? ` — “${session.reschedule_request_note}”` : ''}. Use
                Reschedule below; they and the tutor get the change email automatically.
              </p>
              {/* PL-262: tell the family a human saw it, without waiting for
                  the actual reschedule. Inline arm-then-confirm. */}
              <AckButton sessionId={session.id} preArmed={ackFocus} />
            </div>
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
              <input type="time" step={300} value={newTime} onChange={(e) => setNewTime(e.target.value)} className="border border-gray-300 rounded p-1.5" />
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
