import { createHash } from 'crypto'
import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import { GCAL_COLOR_IDS, statusFor } from './calendar-colors'
import {
  GcalApiError,
  createGcalEvent,
  listCalendarEvents,
  loadGcalConnection,
  patchGcalEvent,
  type GcalEventInput,
  type ListedEvent,
  type ServiceAccountKey,
} from './gcal'
import { zonedToUtc } from './tutoring'

// PL-161: the portal takes over the hand-managed International Classes
// Google Calendar IN PLACE — same calendar everyone already subscribes to,
// same color code (calendar-colors.ts), driven by class status transitions:
//  - class-level SPAN event = the commitment window an instructor takes on
//    (all-day, first session → last session)
//  - per-session block events = what lets Kelsie eyeball instructor fit
//  - cancelled → recolor RED, never delete (matching current practice)
//
// Hand edits are never silently overwritten: every write records a hash of
// what the portal wrote; the drift audit compares live events against that
// and reports mismatches (a hand edit) instead of clobbering them. The sync
// only patches when the PORTAL side changed.
//
// The calendar is configuration: app_settings intl_classes_calendar_id
// (+ optional intl_classes_calendar_owner, default billy@). Without the id,
// everything here no-ops — nothing surprises the live calendar until ops
// points the portal at it.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export async function intlCalendarConfig(): Promise<{
  calendarId: string
  owner: string
  /** Jul-28 lesson: CONFIGURATION MUST NOT EQUAL ACTIVATION. The id being
   *  set lets the read-only steps run (adopt, audit); nothing WRITES to the
   *  subscribed calendar until this explicit switch is on. */
  enabled: boolean
} | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['intl_classes_calendar_id', 'intl_classes_calendar_owner', 'intl_classes_sync_enabled'])
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  if (!map.intl_classes_calendar_id) return null
  return {
    calendarId: map.intl_classes_calendar_id,
    owner: map.intl_classes_calendar_owner ?? 'billy@highergroundlearning.com',
    enabled: map.intl_classes_sync_enabled === 'true',
  }
}

type ClassRow = {
  id: string
  class_type: string
  status: string
  delivery_mode: string | null
  start_date: string | null
  intl_gcal_event_id: string | null
  intl_gcal_hash: string | null
  schools: any
  sessions: {
    id: string
    session_date: string
    start_time: string
    end_time: string
    location: string | null
    intl_gcal_event_id: string | null
    intl_gcal_hash: string | null
  }[]
}

async function loadClasses(classId?: string): Promise<ClassRow[]> {
  let q = supabase
    .from('classes')
    .select(
      `id, class_type, status, delivery_mode, start_date, intl_gcal_event_id, intl_gcal_hash,
       schools ( name, nickname, timezone ),
       sessions ( id, session_date, start_time, end_time, location, intl_gcal_event_id, intl_gcal_hash )`
    )
    .neq('status', 'draft')
  if (classId) q = q.eq('id', classId)
  const { data } = await q
  return ((data as any[]) ?? []).map((c) => ({ ...c, schools: one(c.schools) }))
}

const addDaysIso = (iso: string, n: number) =>
  new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10)

function classLabel(c: ClassRow): string {
  return `${c.schools?.nickname ?? c.schools?.name ?? ''} ${c.class_type}`.trim()
}

function classColor(c: ClassRow): string {
  return GCAL_COLOR_IDS[
    statusFor({ status: c.status === 'cancelled' ? 'cancelled' : 'confirmed', deliveryMode: c.delivery_mode })
  ]
}

/** The class-level span event (all-day; Google end date is exclusive). */
function desiredSpan(c: ClassRow, config: { calendarId: string; owner: string }): GcalEventInput | null {
  const days = c.sessions.map((s) => s.session_date).sort()
  const first = days[0] ?? c.start_date
  const last = days.at(-1) ?? c.start_date
  if (!first || !last) return null
  return {
    tutorEmail: config.owner,
    calendarId: config.calendarId,
    summary: `${classLabel(c)}${c.status === 'cancelled' ? ' (cancelled)' : ''}`,
    description: `Managed by the HGL Portal — edit the class there, not here.\n${emailBaseUrl()}/admin?class=${c.id}`,
    location: null,
    startsAt: '',
    endsAt: '',
    timezone: c.schools?.timezone ?? 'America/Denver',
    attendees: [],
    colorId: classColor(c),
    allDay: { startDate: first, endDate: addDaysIso(last, 1) },
  }
}

function desiredSessionEvent(
  c: ClassRow,
  s: ClassRow['sessions'][number],
  config: { calendarId: string; owner: string }
): GcalEventInput {
  const tz = c.schools?.timezone ?? 'America/Denver'
  return {
    tutorEmail: config.owner,
    calendarId: config.calendarId,
    summary: `${classLabel(c)}${c.status === 'cancelled' ? ' (cancelled)' : ''}`,
    description: `Managed by the HGL Portal — edit the class there, not here.\n${emailBaseUrl()}/admin?class=${c.id}`,
    location: s.location ?? null,
    startsAt: zonedToUtc(s.session_date, String(s.start_time).slice(0, 5), tz).toISOString(),
    endsAt: zonedToUtc(s.session_date, String(s.end_time).slice(0, 5), tz).toISOString(),
    timezone: tz,
    attendees: [],
    colorId: classColor(c),
  }
}

function hashDesired(d: GcalEventInput): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        s: d.summary,
        st: d.allDay?.startDate ?? d.startsAt,
        en: d.allDay?.endDate ?? d.endsAt,
        c: d.colorId,
        l: d.location,
      })
    )
    .digest('hex')
}

export type IntlSyncResult = {
  configured: boolean
  created: number
  patched: number
  unchanged: number
  errors: string[]
}

/** Make the shared calendar match the portal — creates missing events,
 *  patches events whose PORTAL side changed, leaves the rest alone. */
export async function syncInternationalCalendar(classId?: string): Promise<IntlSyncResult> {
  const result: IntlSyncResult = { configured: false, created: 0, patched: 0, unchanged: 0, errors: [] }
  const config = await intlCalendarConfig()
  // The sync WRITES to the subscribed calendar — configured is not enough,
  // the explicit enable switch gates it (adopt first, enable second).
  if (!config?.enabled) return result
  const conn = await loadGcalConnection()
  if (!conn?.key || conn.status !== 'connected') {
    result.errors.push('Google connection unavailable')
    return result
  }
  result.configured = true

  const push = async (
    desired: GcalEventInput,
    stored: { id: string | null; hash: string | null },
    save: (eventId: string, hash: string) => Promise<void>
  ) => {
    const wantHash = hashDesired(desired)
    if (stored.id && stored.hash === wantHash) {
      result.unchanged++
      return
    }
    try {
      if (stored.id) {
        try {
          await patchGcalEvent(conn.key as ServiceAccountKey, stored.id, desired)
          await save(stored.id, wantHash)
          result.patched++
          return
        } catch (e) {
          if (!(e instanceof GcalApiError && (e.status === 404 || e.status === 410))) throw e
          // hand-deleted — recreate below (the portal is the source of truth)
        }
      }
      const id = await createGcalEvent(conn.key as ServiceAccountKey, desired)
      await save(id, wantHash)
      result.created++
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message.slice(0, 200) : String(e))
    }
  }

  for (const c of await loadClasses(classId)) {
    const span = desiredSpan(c, config)
    if (span) {
      await push(span, { id: c.intl_gcal_event_id, hash: c.intl_gcal_hash }, async (eventId, hash) => {
        await supabase.from('classes').update({ intl_gcal_event_id: eventId, intl_gcal_hash: hash }).eq('id', c.id)
      })
    }
    for (const s of c.sessions) {
      const desired = desiredSessionEvent(c, s, config)
      await push(desired, { id: s.intl_gcal_event_id, hash: s.intl_gcal_hash }, async (eventId, hash) => {
        await supabase.from('sessions').update({ intl_gcal_event_id: eventId, intl_gcal_hash: hash }).eq('id', s.id)
      })
    }
  }
  return result
}

export type IntlReconcileResult = {
  configured: boolean
  adoptedSpans: number
  adoptedSessions: number
  unmatched: { summary: string | null; start: string | null; end: string | null; allDay: boolean }[]
}

/**
 * One-time adoption of the HAND-MADE events (PL-154 machinery, applied to
 * the shared calendar): a timed event matching a portal session's exact
 * start+end is adopted; an all-day event overlapping a class window whose
 * title resembles the class is adopted as its span. Anything unmatched goes
 * in the report — NEVER silently deleted.
 */
export async function reconcileInternationalCalendar(): Promise<IntlReconcileResult> {
  const result: IntlReconcileResult = { configured: false, adoptedSpans: 0, adoptedSessions: 0, unmatched: [] }
  const config = await intlCalendarConfig()
  if (!config) return result
  const conn = await loadGcalConnection()
  if (!conn?.key || conn.status !== 'connected') return result
  result.configured = true

  const now = Date.now()
  const events = await listCalendarEvents(
    conn.key,
    config.owner,
    config.calendarId,
    new Date(now - 60 * 86_400_000).toISOString(),
    new Date(now + 400 * 86_400_000).toISOString()
  )
  const claimed = new Set<string>()
  const classes = await loadClasses()
  // Our own already-managed events are spoken for.
  for (const c of classes) {
    if (c.intl_gcal_event_id) claimed.add(c.intl_gcal_event_id)
    for (const s of c.sessions) if (s.intl_gcal_event_id) claimed.add(s.intl_gcal_event_id)
  }

  const near = (a: string | null, b: string) => a != null && Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= 60_000

  for (const c of classes) {
    const tz = c.schools?.timezone ?? 'America/Denver'
    for (const s of c.sessions) {
      if (s.intl_gcal_event_id) continue
      const startsAt = zonedToUtc(s.session_date, String(s.start_time).slice(0, 5), tz).toISOString()
      const endsAt = zonedToUtc(s.session_date, String(s.end_time).slice(0, 5), tz).toISOString()
      const match = events.find((e) => !claimed.has(e.id) && !e.allDay && near(e.start, startsAt) && near(e.end, endsAt))
      if (match) {
        claimed.add(match.id)
        // hash stays NULL: the next sync patches the adopted event into the
        // portal's shape — adoption IS the take-over.
        await supabase.from('sessions').update({ intl_gcal_event_id: match.id }).eq('id', s.id)
        result.adoptedSessions++
      }
    }
    if (!c.intl_gcal_event_id) {
      const days = c.sessions.map((s) => s.session_date).sort()
      const first = days[0] ?? c.start_date
      const last = days.at(-1) ?? c.start_date
      if (!first || !last) continue
      const label = classLabel(c).toLowerCase()
      const spanStart = zonedToUtc(first, '00:00', tz).getTime()
      const spanEnd = zonedToUtc(addDaysIso(last, 1), '00:00', tz).getTime()
      const match = events.find((e) => {
        if (claimed.has(e.id) || !e.allDay || !e.start || !e.end) return false
        const overlaps = new Date(e.start).getTime() < spanEnd && new Date(e.end).getTime() > spanStart
        if (!overlaps) return false
        const t = (e.summary ?? '').toLowerCase()
        return Boolean(
          t &&
            (t.includes(c.class_type.toLowerCase()) ||
              label.includes(t) ||
              (c.schools?.nickname && t.includes(String(c.schools.nickname).toLowerCase())))
        )
      })
      if (match) {
        claimed.add(match.id)
        await supabase.from('classes').update({ intl_gcal_event_id: match.id }).eq('id', c.id)
        result.adoptedSpans++
      }
    }
  }

  result.unmatched = events
    .filter((e) => !claimed.has(e.id))
    .map((e) => ({ summary: e.summary, start: e.start, end: e.end, allDay: e.allDay }))
  return result
}

export type IntlDriftRow = {
  what: string
  eventId: string
  problem: string
}

/** The drift audit: adopted/created events whose live state differs from
 *  what the portal last wrote — i.e. a hand edit (or hand delete). Reported,
 *  never overwritten (the sync only patches when the PORTAL changed). */
export async function auditInternationalCalendar(): Promise<{ configured: boolean; drift: IntlDriftRow[] }> {
  const config = await intlCalendarConfig()
  if (!config) return { configured: false, drift: [] }
  const conn = await loadGcalConnection()
  if (!conn?.key || conn.status !== 'connected') return { configured: false, drift: [] }

  const now = Date.now()
  const events = await listCalendarEvents(
    conn.key,
    config.owner,
    config.calendarId,
    new Date(now - 60 * 86_400_000).toISOString(),
    new Date(now + 400 * 86_400_000).toISOString()
  )
  const byId = new Map(events.map((e) => [e.id, e]))
  const drift: IntlDriftRow[] = []

  const compare = (what: string, eventId: string, hash: string | null, desired: GcalEventInput) => {
    // Only audit events we have WRITTEN (hash present) — an adopted-but-not-
    // yet-synced event is expected to differ.
    if (!hash || hash !== hashDesired(desired)) return
    const live = byId.get(eventId)
    if (!live) {
      drift.push({ what, eventId, problem: 'deleted by hand in Google (the portal still has it)' })
      return
    }
    const liveStart = desired.allDay ? live.start : live.start
    const wantStart = desired.allDay
      ? zonedToUtc(desired.allDay.startDate, '00:00', desired.timezone).toISOString()
      : new Date(desired.startsAt).toISOString()
    const summaryDiff = (live.summary ?? '') !== desired.summary
    const colorDiff = (live.colorId ?? null) !== (desired.colorId ?? null)
    const timeDiff = liveStart != null && Math.abs(new Date(liveStart).getTime() - new Date(wantStart).getTime()) > 60_000
    if (summaryDiff || colorDiff || timeDiff) {
      const parts = [
        summaryDiff ? `title is now "${live.summary}"` : null,
        colorDiff ? 'color changed' : null,
        timeDiff ? 'time moved' : null,
      ].filter(Boolean)
      drift.push({ what, eventId, problem: `hand-edited in Google (${parts.join(', ')}) — portal not overwriting` })
    }
  }

  for (const c of await loadClasses()) {
    const span = desiredSpan(c, config)
    if (span && c.intl_gcal_event_id) compare(`${classLabel(c)} (span)`, c.intl_gcal_event_id, c.intl_gcal_hash, span)
    for (const s of c.sessions) {
      if (!s.intl_gcal_event_id) continue
      compare(
        `${classLabel(c)} — ${s.session_date}`,
        s.intl_gcal_event_id,
        s.intl_gcal_hash,
        desiredSessionEvent(c, s, config)
      )
    }
  }
  return { configured: true, drift }
}
