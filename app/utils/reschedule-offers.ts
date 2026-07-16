import { supabaseAdmin as supabase } from './supabase-admin'
import { freeBusy, loadGcalConnection } from './gcal'
import {
  addDaysIso,
  classifyNotice,
  isoWeekday,
  validOfferWindows,
  validRecurrence,
  zonedToUtc,
  type OfferWindow,
} from './tutoring'
import { billingMonth } from './tutoring-billing'

// Pick-from-offered-slots (docs/PHASE7_SPEC.md v1.4 §8, July 15): compute the
// replacement slots the portal may OFFER a parent for a ≥24h reschedule.
// Candidates = the tutor's Google freebusy gaps ∩ Ops-Director-approved offer
// windows (instructors.offer_windows; default = the tutor's recurring-session
// hours ±2h), same billing month as the original, ≥24h out, and not
// displacing another portal session (tutor's or student's).
//
// The no-self-booking principle lives HERE: the parent-facing route shows only
// `offered` (2–3 slots), and the pick handler re-runs this computation and
// accepts a time only if it is in `candidates` — client-supplied instants are
// never trusted, and the tutor's calendar is never exposed.

const ORG_TZ = 'America/Denver' // billing months are Denver calendar months (7c)
const STEP_MINUTES = 30
const OFFER_COUNT = 3

export type CandidateSlot = { starts_at: string; ends_at: string }

export type OfferComputation = {
  /** Original-session context the pick handler needs (null = hard guard failed). */
  session: {
    id: string
    engagement_id: string
    student_id: string
    tutor_id: string
    starts_at: string
    ends_at: string
    status: string
    rate_snapshot: number
    gcal_event_id: string | null
  } | null
  /** Every slot the parent may legally take, sorted by start. */
  candidates: CandidateSlot[]
  /** The 2–3 shown in the portal: distinct days nearest the original. */
  offered: CandidateSlot[]
  /** Why the list is empty — for logs/alerts, never parent-facing copy. */
  reason: string | null
}

const none = (session: OfferComputation['session'], reason: string): OfferComputation => ({
  session,
  candidates: [],
  offered: [],
  reason,
})

type Interval = { start: number; end: number }

const overlaps = (aStart: number, aEnd: number, list: Interval[]) =>
  list.some((b) => aStart < b.end && aEnd > b.start)

const hhmmToMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const minutesToHhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** YYYY-MM-DD of an instant on the wall clock of `tz`. */
const dateIn = (at: Date, tz: string) => at.toLocaleDateString('en-CA', { timeZone: tz })

/** Minutes-past-midnight of an instant on the wall clock of `tz`. */
function wallMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

/** Unset offer windows default to the tutor's existing recurring-session
 *  hours ±2h (spec §8) — across ALL their active engagements. */
async function defaultWindows(tutorId: string): Promise<OfferWindow[]> {
  const { data } = await supabase
    .from('tutoring_engagements')
    .select('recurrence')
    .eq('tutor_id', tutorId)
    .eq('status', 'active')
  const out: OfferWindow[] = []
  for (const row of data ?? []) {
    if (!validRecurrence(row.recurrence)) continue
    for (const slot of row.recurrence) {
      const start = Math.max(0, hhmmToMinutes(slot.start_time) - 120)
      const end = Math.min(24 * 60 - 1, hhmmToMinutes(slot.start_time) + slot.duration_minutes + 120)
      if (end > start) out.push({ weekday: slot.weekday, start_time: minutesToHhmm(start), end_time: minutesToHhmm(end) })
    }
  }
  return out
}

export async function computeRescheduleOffers(sessionId: string): Promise<OfferComputation> {
  const { data: raw } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, engagement_id, student_id, tutor_id, starts_at, ends_at, status,
       rate_snapshot, gcal_event_id,
       instructors!inner ( email, timezone, google_calendar_id, offer_windows )`
    )
    .eq('id', sessionId)
    .maybeSingle()
  if (!raw) return none(null, 'unknown session')
  const tutor: any = one(raw.instructors)
  const session: OfferComputation['session'] = {
    id: raw.id,
    engagement_id: raw.engagement_id,
    student_id: raw.student_id,
    tutor_id: raw.tutor_id,
    starts_at: raw.starts_at,
    ends_at: raw.ends_at,
    status: raw.status,
    rate_snapshot: Number(raw.rate_snapshot),
    gcal_event_id: raw.gcal_event_id,
  }

  if (raw.status !== 'confirmed') return none(session, `session is ${raw.status}`)
  const originalStart = new Date(raw.starts_at)
  if (classifyNotice(originalStart) !== 'ok') return none(session, 'inside 24h — $40/hr path, no self-serve offers')
  if (!tutor?.email) return none(session, 'tutor has no email')

  const tutorTz: string = tutor.timezone ?? ORG_TZ
  const durationMs = new Date(raw.ends_at).getTime() - originalStart.getTime()
  const durationMin = Math.round(durationMs / 60_000)

  // Ops-Director-approved windows; unset → recurring hours ±2h.
  let windows: OfferWindow[] =
    validOfferWindows(tutor.offer_windows) && tutor.offer_windows.length > 0 ? tutor.offer_windows : []
  if (windows.length === 0) windows = await defaultWindows(raw.tutor_id)
  if (windows.length === 0) return none(session, 'no offer windows and no recurrence to derive them from')

  // Search span: ≥24h out through the end of the original's billing month
  // (Denver calendar months, 7c).
  const now = new Date()
  const earliest = new Date(now.getTime() + 24 * 3600_000)
  const monthKey = dateIn(originalStart, ORG_TZ).slice(0, 7)
  const month = billingMonth(monthKey)
  // End of the Denver month, generously bounded for the freebusy query.
  const rangeEnd = new Date(zonedToUtc(month.lastDay, '23:59', ORG_TZ).getTime() + 60_000)
  if (earliest.getTime() >= rangeEnd.getTime()) return none(session, 'billing month exhausted')

  // Google freebusy — busy blocks veto candidates. No connection / API error
  // means we cannot guarantee conflict-free offers, so fall back (§8: the
  // request path always exists).
  let busy: Interval[]
  try {
    const conn = await loadGcalConnection()
    if (!conn?.key || conn.status !== 'connected') return none(session, 'Google Calendar not connected')
    busy = (
      await freeBusy(conn.key, tutor.email, tutor.google_calendar_id, earliest.toISOString(), rangeEnd.toISOString())
    ).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
  } catch (e) {
    console.error(`offer computation: freebusy failed for session ${sessionId}:`, e)
    return none(session, 'freebusy query failed')
  }

  // Portal sessions the candidate must not displace: anything live for this
  // tutor OR this student (the original itself is being moved, so it's
  // excluded — its Google event still shades its old slot via freebusy).
  const { data: liveRows } = await supabase
    .from('tutoring_sessions')
    .select('id, starts_at, ends_at')
    .or(`tutor_id.eq.${raw.tutor_id},student_id.eq.${raw.student_id}`)
    .in('status', ['proposed', 'confirmed'])
    .gte('ends_at', earliest.toISOString())
    .lte('starts_at', rangeEnd.toISOString())
  const portalBusy: Interval[] = (liveRows ?? [])
    .filter((r) => r.id !== raw.id)
    .map((r) => ({ start: new Date(r.starts_at).getTime(), end: new Date(r.ends_at).getTime() }))

  // Generate: every STEP_MINUTES start inside a window, on each calendar day
  // (tutor wall clock) from the 24h line to month end.
  const byWeekday = new Map<number, OfferWindow[]>()
  for (const w of windows) byWeekday.set(w.weekday, [...(byWeekday.get(w.weekday) ?? []), w])
  const firstDay = dateIn(earliest, tutorTz)
  const seen = new Set<number>()
  const candidates: CandidateSlot[] = []
  for (let d = firstDay; d <= month.lastDay; d = addDaysIso(d, 1)) {
    for (const w of byWeekday.get(isoWeekday(d)) ?? []) {
      const windowEnd = hhmmToMinutes(w.end_time)
      for (let t = hhmmToMinutes(w.start_time); t + durationMin <= windowEnd; t += STEP_MINUTES) {
        const start = zonedToUtc(d, minutesToHhmm(t), tutorTz)
        const startMs = start.getTime()
        const endMs = startMs + durationMs
        if (seen.has(startMs)) continue
        if (startMs < earliest.getTime()) continue
        if (startMs === originalStart.getTime()) continue
        if (dateIn(start, ORG_TZ).slice(0, 7) !== monthKey) continue // same billing month
        if (overlaps(startMs, endMs, busy)) continue
        if (overlaps(startMs, endMs, portalBusy)) continue
        seen.add(startMs)
        candidates.push({ starts_at: start.toISOString(), ends_at: new Date(endMs).toISOString() })
      }
    }
  }
  candidates.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  if (candidates.length === 0) return none(session, 'no conflict-free slot in the billing month')

  // Offer 2–3: distinct days nearest the original date, and on each day the
  // slot closest to the original's wall-clock time — "same rhythm" beats
  // "soonest possible".
  const originalDay = dateIn(originalStart, tutorTz)
  const originalWall = wallMinutes(originalStart, tutorTz)
  const dayDistance = (day: string) =>
    Math.abs(new Date(day + 'T12:00:00Z').getTime() - new Date(originalDay + 'T12:00:00Z').getTime())
  const byDay = new Map<string, CandidateSlot[]>()
  for (const c of candidates) {
    const day = dateIn(new Date(c.starts_at), tutorTz)
    byDay.set(day, [...(byDay.get(day) ?? []), c])
  }
  const offered = [...byDay.entries()]
    .sort((a, b) => dayDistance(a[0]) - dayDistance(b[0]) || a[0].localeCompare(b[0]))
    .slice(0, OFFER_COUNT)
    .map(
      ([, slots]) =>
        slots.reduce((best, c) =>
          Math.abs(wallMinutes(new Date(c.starts_at), tutorTz) - originalWall) <
          Math.abs(wallMinutes(new Date(best.starts_at), tutorTz) - originalWall)
            ? c
            : best
        )
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))

  return { session, candidates, offered, reason: null }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
