import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import {
  GcalApiError,
  createGcalEvent,
  deleteGcalEvent,
  patchGcalEvent,
  getGcalEvent,
  findGcalEventBySessionKey,
  listCalendarEvents,
  loadGcalConnection,
  stopWatchChannel,
  watchCalendarEvents,
  type GcalEventInput,
  type ListedEvent,
  type ServiceAccountKey,
} from './gcal'
import { randomBytes, randomUUID } from 'crypto'
import { PRODUCTION_ORIGIN } from './base-url'
import { sendAdminAlert } from './email'
import { createHash } from 'crypto'
import { ADMIN_EMAIL } from './lifecycle'

// Phase 7a Google Calendar push worker (spec §4). Same shape as the Phase 6
// QBO worker: enqueue rows ride an after() trigger behind every scheduling
// mutation (fast path) and the daily sweep drains stragglers/retries. A
// Google outage never blocks scheduling — rows wait and retry with backoff.
//
// The worker is STATE-DRIVEN: a queue row just means "make Google match this
// session". What that means is derived from the session row at run time:
//   proposed                → PL-159: a visibly tentative "HOLD:" event on
//                             the tutor's calendar (mirrors Kelsie's manual
//                             practice). On confirm the SAME event patches
//                             into a normal confirmed one — id stays stable,
//                             no delete/recreate. An ignored new-schedule
//                             proposal releases its hold after
//                             HOLD_LIFETIME_DAYS (the event is removed; the
//                             proposal itself stays confirmable).
//   confirmed / completed   → create the event, or patch it into shape
//   forfeited / no_show     → keep the event, title prefixed "XCL- " (the
//                             Ops Director's long-standing calendar convention — the
//                             slot stays visible because the tutor is paid)
//   rescheduled             → the reschedule route moves gcal_event_id to the
//                             replacement session; if one is still attached
//                             here (edge), delete it.
// Because enqueues coalesce (one pending row per session), rapid consecutive
// edits collapse into a single push of the final state.

const MAX_ATTEMPTS = 5

/** PL-159: how long an UNANSWERED new-schedule proposal keeps its calendar
 *  hold. Past this, the hold releases (the nudge machinery alerted a human
 *  at +5d; +10d of silence should not reserve a tutor's Tuesday forever).
 *  Confirming later still works — the events recreate as confirmed. */
export const HOLD_LIFETIME_DAYS = 10

/** PL-159: does this proposed session still hold its slot? Monthly-cycle
 *  proposals (active engagement) always hold — they auto-confirm within
 *  days; a new-schedule proposal holds while the confirmation request is
 *  fresh. */
export function holdActive(
  engagementStatus: string,
  approvalRequestedAt: string | null,
  now: Date = new Date()
): boolean {
  if (engagementStatus !== 'pending_parent_confirmation') return engagementStatus === 'active'
  if (!approvalRequestedAt) return true // not yet asked — the hold stands
  return now.getTime() - new Date(approvalRequestedAt).getTime() < HOLD_LIFETIME_DAYS * 86_400_000
}

type QueueRow = {
  id: string
  session_id: string
  reason: string | null
  attempts: number
}

type SessionDetail = {
  id: string
  status: string
  starts_at: string
  ends_at: string
  gcal_event_id: string | null
  rescheduled_to_id: string | null
  reschedule_notice: 'ok' | 'late' | null
  location_effective: string | null
  tutor: { email: string; google_calendar_id: string | null; timezone: string; name: string | null }
  studentFirst: string
  studentEmail: string | null
  parentEmail: string | null
  inviteAttendees: boolean
  subjectName: string
  /** PL-159: whether a proposed session's slot-hold is still live. */
  engagementStatus: string
  approvalRequestedAt: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

async function loadSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const { data, error } = await supabase
    .from('tutoring_sessions')
    .select(
      `
      id, status, starts_at, ends_at, gcal_event_id, rescheduled_to_id, reschedule_notice,
      tutoring_engagements ( location, status, approval_requested_at, subjects ( name ) ),
      students ( first_name, student_email, families ( parent_email, gcal_invite_attendees ) ),
      instructors ( email, google_calendar_id, timezone, name, default_meeting_link )
    `
    )
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !data) return null
  const raw = data as any
  const engagement = one<any>(raw.tutoring_engagements)
  const student = one<any>(raw.students)
  const family = one<any>(student?.families)
  const tutor = one<any>(raw.instructors)
  if (!engagement || !student || !tutor) return null
  return {
    id: raw.id,
    status: raw.status,
    starts_at: raw.starts_at,
    ends_at: raw.ends_at,
    gcal_event_id: raw.gcal_event_id,
    rescheduled_to_id: raw.rescheduled_to_id,
    reschedule_notice: raw.reschedule_notice,
    location_effective: engagement.location ?? tutor.default_meeting_link ?? null,
    tutor: {
      email: tutor.email,
      google_calendar_id: tutor.google_calendar_id,
      timezone: tutor.timezone ?? 'America/Denver',
      name: tutor.name,
    },
    studentFirst: student.first_name,
    studentEmail: student.student_email ?? null,
    parentEmail: family?.parent_email ?? null,
    inviteAttendees: family?.gcal_invite_attendees ?? true,
    subjectName: one<any>(engagement.subjects)?.name ?? 'Tutoring',
    engagementStatus: engagement.status ?? 'active',
    approvalRequestedAt: engagement.approval_requested_at ?? null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function eventInput(d: SessionDetail, xcl: boolean, hold = false): GcalEventInput {
  const base = emailBaseUrl()
  return {
    tutorEmail: d.tutor.email,
    calendarId: d.tutor.google_calendar_id,
    // PL-159: HOLD events keep Kelsie's manual convention — visibly
    // tentative, "HOLD:" prefixed. tentative also rides the event status.
    tentative: hold,
    summary: `${hold ? 'HOLD: ' : ''}${xcl ? 'XCL- ' : ''}Tutoring: ${d.studentFirst} — ${d.subjectName}`,
    description:
      `Scheduled in the HGL Portal — reschedule/cancel there, not here.\n` +
      `${base}/admin/tutoring?session=${d.id}`,
    location: d.location_effective,
    startsAt: d.starts_at,
    endsAt: d.ends_at,
    timezone: d.tutor.timezone,
    // PL-40 (supersedes §10.5): tutoring pushes go to the TUTOR's calendar
    // only — no family attendees, so no per-session Google invite emails
    // (empty attendees also means sendUpdates=none). The family gets the
    // auto-updating ICS feed + the one warm T_SCHEDULE_SET email instead.
    attendees: [],
    // PL-401: every synced event carries the session's identity marker so
    // sync is idempotent per session — see createOrAdopt.
    sessionKey: d.id,
  }
}

/** PL-401: the ONLY way sync creates a tutoring event. Search-before-create
 *  on the session's identity marker: if a live event already declares this
 *  session (a prior create whose portal pointer write was lost, a retry, a
 *  re-sync), ADOPT it with a patch — never mint a twin. This is what makes
 *  the 4×-duplicated "Tuto…" blocks on tutors' real calendars impossible
 *  going forward. */
async function createOrAdopt(
  key: ServiceAccountKey,
  d: SessionDetail,
  input: GcalEventInput
): Promise<{ eventId: string; adopted: boolean }> {
  const existing = await findGcalEventBySessionKey(key, d.tutor.email, d.tutor.google_calendar_id, d.id)
  if (existing) {
    try {
      await patchGcalEvent(key, existing, input)
      return { eventId: existing, adopted: true }
    } catch (e) {
      if (!(e instanceof GcalApiError && (e.status === 404 || e.status === 410))) throw e
      // Marked event vanished between search and patch — fall through to create.
    }
  }
  return { eventId: await createGcalEvent(key, input), adopted: false }
}

/**
 * Enqueue "make Google match this session". Coalesces: the partial unique
 * index allows one pending row per session, so a second enqueue while one is
 * pending is a no-op (the worker reads final state anyway).
 */
export async function enqueueGcalSync(sessionId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('gcal_sync_log')
    .insert({ session_id: sessionId, reason })
  if (error && error.code !== '23505') {
    console.error(`gcal enqueue failed for session ${sessionId}:`, error.message)
  }
}

type SyncOutcome = { eventId: string | null; note: string }

async function syncSession(d: SessionDetail, key: ServiceAccountKey): Promise<SyncOutcome> {
  if (d.status === 'proposed') {
    // PL-159: proposed sessions HOLD their slot with a tentative event —
    // unless the hold has expired (ignored new-schedule proposal), in which
    // case any existing hold event is released.
    if (!holdActive(d.engagementStatus, d.approvalRequestedAt)) {
      if (d.gcal_event_id) {
        await deleteGcalEvent(key, d.tutor.email, d.tutor.google_calendar_id, d.gcal_event_id)
        return { eventId: null, note: 'hold expired — event released' }
      }
      return { eventId: null, note: 'hold expired — nothing to release' }
    }
    const input = eventInput(d, false, true)
    if (d.gcal_event_id) {
      try {
        await patchGcalEvent(key, d.gcal_event_id, input)
        return { eventId: d.gcal_event_id, note: 'hold patched' }
      } catch (e) {
        if (!(e instanceof GcalApiError && (e.status === 404 || e.status === 410))) throw e
        // Hand-deleted in Google: recreate — the portal is the source of truth.
      }
    }
    const { eventId, adopted } = await createOrAdopt(key, d, input)
    return {
      eventId,
      note: adopted ? 'hold adopted (marked event found)' : d.gcal_event_id ? 'hold recreated (event was gone)' : 'hold created',
    }
  }

  if (d.status === 'confirmed' || d.status === 'completed') {
    const input = eventInput(d, false)
    if (d.gcal_event_id) {
      try {
        await patchGcalEvent(key, d.gcal_event_id, input)
        return { eventId: d.gcal_event_id, note: 'patched' }
      } catch (e) {
        if (!(e instanceof GcalApiError && (e.status === 404 || e.status === 410))) throw e
        // Hand-deleted in Google: recreate (the portal is the source of truth).
      }
    }
    const { eventId, adopted } = await createOrAdopt(key, d, input)
    return {
      eventId,
      note: adopted ? 'adopted (marked event found)' : d.gcal_event_id ? 'recreated (event was gone)' : 'created',
    }
  }

  if (d.status === 'forfeited' || d.status === 'no_show') {
    if (!d.gcal_event_id) return { eventId: null, note: 'no event to XCL-mark' }
    try {
      await patchGcalEvent(key, d.gcal_event_id, eventInput(d, true))
      return { eventId: d.gcal_event_id, note: 'XCL-marked' }
    } catch (e) {
      if (e instanceof GcalApiError && (e.status === 404 || e.status === 410)) {
        return { eventId: null, note: 'event already gone' }
      }
      throw e
    }
  }

  if (d.status === 'rescheduled') {
    // LATE reschedule: the tutor is still paid for the reserved slot, so the
    // original event stays on the calendar XCL-marked (the replacement gets
    // its own new event). FREE reschedule: the route hands the event id to
    // the replacement; one still attached here (edge) means the move didn't
    // transfer — the old slot must disappear from the calendar.
    if (d.reschedule_notice === 'late') {
      if (!d.gcal_event_id) return { eventId: null, note: 'late reschedule — no event to XCL-mark' }
      try {
        await patchGcalEvent(key, d.gcal_event_id, eventInput(d, true))
        return { eventId: d.gcal_event_id, note: 'late reschedule — original XCL-marked' }
      } catch (e) {
        if (e instanceof GcalApiError && (e.status === 404 || e.status === 410)) {
          return { eventId: null, note: 'event already gone' }
        }
        throw e
      }
    }
    if (d.gcal_event_id) {
      await deleteGcalEvent(key, d.tutor.email, d.tutor.google_calendar_id, d.gcal_event_id)
    }
    return { eventId: null, note: 'rescheduled — original slot cleared' }
  }

  return { eventId: d.gcal_event_id, note: `no action for status ${d.status}` }
}

export type GcalQueueResult = {
  synced: number
  failed: number
  deferred: number
  paused: boolean
}

/** Drain the queue. Never throws — calendar problems must not block scheduling. */
export async function processGcalQueue(): Promise<GcalQueueResult> {
  const result: GcalQueueResult = { synced: 0, failed: 0, deferred: 0, paused: false }
  try {
    const conn = await loadGcalConnection()
    if (!conn || conn.status !== 'connected' || !conn.key) {
      result.paused = true // rows stay pending; drain when connected
      return result
    }

    const { data: rows } = await supabase
      .from('gcal_sync_log')
      .select('id, session_id, reason, attempts')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .order('created_at')
      .limit(25)
    if (!rows || rows.length === 0) return result

    for (const row of rows as QueueRow[]) {
      // Claim: conditional attempts bump (after()-trigger racing the sweep
      // loses the claim and skips the row).
      const backoffMinutes = 5 * 2 ** row.attempts
      const { data: claimed } = await supabase
        .from('gcal_sync_log')
        .update({
          attempts: row.attempts + 1,
          next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'pending')
        .eq('attempts', row.attempts)
        .select('id')
      if (!claimed || claimed.length === 0) continue

      try {
        const detail = await loadSessionDetail(row.session_id)
        if (!detail) {
          await supabase
            .from('gcal_sync_log')
            .update({ status: 'skipped', last_error: 'session no longer loadable' })
            .eq('id', row.id)
          continue
        }
        const outcome = await syncSession(detail, conn.key)
        // Keep the session's event pointer in step with what Google now
        // holds (PL-159: proposed sessions carry hold events, so they stamp
        // their pointer like everything else).
        // PL-401: this write is CHECKED — a lost pointer used to orphan the
        // just-created event, and the retried row then minted a twin (the
        // 4×-duplicate bug). Failing the row keeps it pending; the retry
        // ADOPTS the event via its identity marker instead of re-creating.
        const { error: ptrError } = await supabase
          .from('tutoring_sessions')
          .update({ gcal_event_id: outcome.eventId, gcal_synced_at: new Date().toISOString() })
          .eq('id', detail.id)
        if (ptrError) throw new Error(`session event-pointer write failed: ${ptrError.message}`)
        await supabase
          .from('gcal_sync_log')
          .update({
            status: 'synced',
            gcal_event_id: outcome.eventId,
            synced_at: new Date().toISOString(),
            last_error: null,
            reason: [row.reason, outcome.note].filter(Boolean).join(' → '),
          })
          .eq('id', row.id)
        result.synced++
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error(`gcal sync failed for row ${row.id} (attempt ${row.attempts + 1}):`, message)
        const exhausted = row.attempts + 1 >= MAX_ATTEMPTS
        await supabase
          .from('gcal_sync_log')
          .update({ last_error: message.slice(0, 1000), ...(exhausted ? { status: 'failed' } : {}) })
          .eq('id', row.id)
        if (exhausted) {
          result.failed++
          await sendAdminAlert({
            dedupeKey: `gcal_sync_failed:${row.id}`,
            adminEmail: ADMIN_EMAIL,
            subject: 'Google Calendar push FAILED for a tutoring session',
            body: `<p>After ${MAX_ATTEMPTS} attempts, session <code>${row.session_id}</code>
              could not be pushed to the tutor's Google Calendar.</p>
              <p>Last error: <code>${message.slice(0, 500)}</code></p>
              <p>The portal schedule is still correct — only the calendar copy is missing.
              Fix the cause on
              <a href="${emailBaseUrl()}/admin" style="color:#00AEEE">the Google Calendar panel (admin page)</a>,
              then hit Retry there.</p>`,
          }).catch((err) => console.error('gcal failure alert failed:', err))
        } else {
          result.deferred++
        }
      }
    }
    return result
  } catch (e) {
    console.error('processGcalQueue crashed:', e)
    return result
  }
}

// ---------------------------------------------------------------------------
// PL-154: the XCL- calendar audit (Phase-7 spec §4, promised at 7a launch)
// ---------------------------------------------------------------------------
// Tutors still live in Google during the transition, and the habit that
// predates the portal is to cancel a session by prefixing its calendar event
// "XCL-". When they do that instead of cancelling in the portal, the session
// stays 'confirmed' here: it bills, it counts on the timecard, it shows on
// the family's schedule. Nobody notices until an invoice is wrong.
//
// This is a READ-ONLY reconciler. It never mutates a calendar or a session —
// a tutor's calendar edit is a signal, not an instruction, and auto-cancelling
// a paid session from a title string is exactly the kind of silent action
// this codebase avoids. It reports; a human decides.

export type XclDrift = {
  sessionId: string
  startsAt: string
  studentName: string
  tutorName: string
  eventTitle: string
}

/**
 * Sessions the portal believes are happening whose Google event has been
 * hand-marked XCL- (or hand-deleted). Looks at the near horizon only —
 * recent past (where a wrong bill is imminent) plus everything upcoming.
 */
export async function auditXclDrift(): Promise<XclDrift[]> {
  const conn = await loadGcalConnection()
  if (!conn || conn.status !== 'connected' || !conn.key) return []

  const from = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const to = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const { data: rows } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, starts_at, gcal_event_id, status,
       students ( first_name, last_name ),
       instructors ( name, email, google_calendar_id )`
    )
    .in('status', ['confirmed', 'completed'])
    .not('gcal_event_id', 'is', null)
    .gte('starts_at', from)
    .lte('starts_at', to)
    .order('starts_at')
    .limit(400)

  const drift: XclDrift[] = []
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const row of (rows as any[]) ?? []) {
    const student = Array.isArray(row.students) ? row.students[0] : row.students
    const tutor = Array.isArray(row.instructors) ? row.instructors[0] : row.instructors
    if (!tutor?.email) continue
    try {
      const event = await getGcalEvent(conn.key, tutor.email, tutor.google_calendar_id, row.gcal_event_id)
      // Hand-deleted or Google-cancelled counts as the same signal: the
      // tutor's calendar says this session isn't happening.
      const title = event?.summary ?? ''
      const handCancelled = !event || event.status === 'cancelled' || /^\s*XCL-/i.test(title)
      if (!handCancelled) continue
      drift.push({
        sessionId: row.id,
        startsAt: row.starts_at,
        studentName: student ? `${student.first_name} ${student.last_name ?? ''}`.trim() : 'a student',
        tutorName: tutor.name ?? tutor.email,
        eventTitle: event ? title || '(no title)' : '(event deleted from the calendar)',
      })
    } catch (e) {
      // A read failure is not drift — say nothing rather than cry wolf.
      console.error(`[PL-154] calendar read failed for session ${row.id}:`, e)
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return drift
}

// ---------------------------------------------------------------------------
// PL-180: calendar-side TIME edits flow back — detect always, adopt
// deliberately. A session time drives parent notices, billing lines,
// timecards; a silent adopt would let one drag in Google bypass all of it.
// This audit compares future portal sessions against their live calendar
// events and maintains the calendar_drift table (state-driven: rows appear
// while the drift exists, disappear when it resolves either way). Sessions
// with a PENDING sync-queue row are skipped — the portal is about to patch
// them, which also breaks any adopt/revert detection loop.
// ---------------------------------------------------------------------------

export type TimeDriftRow = {
  sessionId: string
  tutorId: string
  tutorFirst: string
  studentFirst: string
  studentLast: string
  familyId: string | null
  subjectName: string
  portalStartsAt: string
  portalEndsAt: string
  /** null = the event was deleted by hand in Google. */
  calStartsAt: string | null
  calEndsAt: string | null
  gcalEventId: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function auditTutoringTimeDrift(tutorId?: string): Promise<TimeDriftRow[]> {
  const conn = await loadGcalConnection()
  if (!conn?.key || conn.status !== 'connected') return []

  const now = Date.now()
  let q = supabase
    .from('tutoring_sessions')
    .select(
      `id, tutor_id, starts_at, ends_at, status, gcal_event_id,
       students ( first_name, last_name, family_id ),
       tutoring_engagements ( subjects ( name ) ),
       instructors ( name, email, google_calendar_id, timezone )`
    )
    // PL-393: 'completed' rides along and the window reaches 14 days BACK —
    // a drift whose session time passes (and auto-completes) must stay
    // visible with past-appropriate resolutions, never vanish silently.
    .in('status', ['confirmed', 'proposed', 'completed'])
    .not('gcal_event_id', 'is', null)
    .gt('starts_at', new Date(now - 14 * 86_400_000).toISOString())
    .lt('starts_at', new Date(now + 60 * 86_400_000).toISOString())
  if (tutorId) q = q.eq('tutor_id', tutorId)
  const { data: sessions } = await q
  const rows = (sessions as any[]) ?? []
  if (rows.length === 0) return []

  // A pending queue row means the portal is mid-push — not drift.
  const { data: pending } = await supabase
    .from('gcal_sync_log')
    .select('session_id')
    .eq('status', 'pending')
    .in('session_id', rows.map((s) => s.id))
  const pendingIds = new Set((pending ?? []).map((p) => p.session_id))

  const byTutor = new Map<string, any[]>()
  for (const s of rows) {
    if (pendingIds.has(s.id)) continue
    byTutor.set(s.tutor_id, [...(byTutor.get(s.tutor_id) ?? []), s])
  }

  const drift: TimeDriftRow[] = []
  for (const [, tutorSessions] of byTutor) {
    const tutor = one<any>(tutorSessions[0].instructors)
    if (!tutor?.email) continue
    let events
    try {
      events = await listCalendarEvents(
        conn.key,
        tutor.email,
        tutor.google_calendar_id || 'primary',
        new Date(now - 86_400_000).toISOString(),
        new Date(now + 61 * 86_400_000).toISOString(),
        tutor.timezone ?? 'America/Denver'
      )
    } catch (e) {
      console.error(`drift audit: events list failed for ${tutor.email} (skipping):`, e)
      continue
    }
    const byId = new Map<string, ListedEvent>(events.map((e: ListedEvent) => [e.id, e]))
    for (const s of tutorSessions) {
      const live = byId.get(s.gcal_event_id)
      const student = one<any>(s.students)
      const base = {
        sessionId: s.id as string,
        tutorId: s.tutor_id as string,
        tutorFirst: (tutor.name ?? tutor.email).split(' ')[0] as string,
        studentFirst: student?.first_name ?? 'a student',
        studentLast: student?.last_name ?? '',
        familyId: student?.family_id ?? null,
        subjectName: one<any>(one<any>(s.tutoring_engagements)?.subjects)?.name ?? 'tutoring',
        portalStartsAt: s.starts_at as string,
        portalEndsAt: s.ends_at as string,
        gcalEventId: s.gcal_event_id as string,
      }
      if (!live || !live.start || !live.end) {
        drift.push({ ...base, calStartsAt: null, calEndsAt: null })
        continue
      }
      const moved =
        Math.abs(new Date(live.start).getTime() - new Date(s.starts_at).getTime()) > 60_000 ||
        Math.abs(new Date(live.end).getTime() - new Date(s.ends_at).getTime()) > 60_000
      if (moved) drift.push({ ...base, calStartsAt: live.start, calEndsAt: live.end })
    }
  }
  return drift
}

/** Refresh calendar_drift to match the audit result — rows for scanned
 *  tutors that are no longer drifted disappear; current drift upserts. */
/** PL-402: ONE grouped alert per audit pass covering every not-yet-alerted
 *  drift — never one email per event. A drift already alerted stays silent
 *  (the Needs Attention row + banner are the persistent reminder, PL-393;
 *  the email is the doorbell, rung once) and re-rings ONLY when its calendar
 *  state changes again (alerted_signature: the moved-to time, or 'deleted').
 *  Returns how many drifts were covered by a fresh doorbell (0 = silent
 *  pass). Lives here, not in the cron route, so the compile-and-call
 *  harness can prove the grouping and once-only behavior. */
export async function sendGroupedDriftAlert(drift: TimeDriftRow[], adminEmail: string): Promise<number> {
  if (drift.length === 0) return 0
  const fmtT = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'long', hour: 'numeric', minute: '2-digit' })
  const sig = (d: { calStartsAt: string | null }) => d.calStartsAt ?? 'deleted'
  const { data: alertedRows } = await supabase.from('calendar_drift').select('session_id, alerted_signature')
  const alerted = new Map(
    ((alertedRows ?? []) as { session_id: string; alerted_signature: string | null }[]).map((r) => [
      r.session_id,
      r.alerted_signature,
    ])
  )
  const fresh = drift.filter((d) => alerted.get(d.sessionId) !== sig(d))
  if (fresh.length === 0) return 0
  const byTutor = new Map<string, TimeDriftRow[]>()
  for (const d of fresh) byTutor.set(d.tutorFirst, [...(byTutor.get(d.tutorFirst) ?? []), d])
  const sections = [...byTutor.entries()]
    .map(
      ([tutorFirst, rows]) =>
        `<p><strong>${tutorFirst}</strong> — ${rows.length} session event${rows.length === 1 ? '' : 's'} changed in their Google Calendar:</p>
         <ul>${rows
           .map(
             (d) =>
               `<li>${
                 d.calStartsAt
                   ? `<strong>${d.studentFirst}</strong>'s ${d.subjectName} session moved — ${fmtT(d.portalStartsAt)} → ${fmtT(d.calStartsAt)}`
                   : `<strong>${d.studentFirst}</strong>'s ${d.subjectName} session event (${fmtT(d.portalStartsAt)}) deleted`
               } · <a href="${emailBaseUrl()}/admin/tutoring?family=${d.familyId ?? ''}" style="color:#00AEEE">open ${d.studentFirst}'s banner</a></li>`
           )
           .join('')}</ul>`
    )
    .join('')
  const one_ = fresh.length === 1 ? fresh[0] : null
  await sendAdminAlert({
    dedupeKey:
      'cal_drift_batch:' +
      createHash('md5')
        .update(fresh.map((d) => `${d.sessionId}@${sig(d)}`).sort().join('|'))
        .digest('hex'),
    adminEmail,
    subject: one_
      ? one_.calStartsAt
        ? `${one_.tutorFirst} moved ${one_.studentFirst}'s session in their Google Calendar`
        : `${one_.tutorFirst} deleted ${one_.studentFirst}'s session event in their Google Calendar`
      : `Google Calendar drift: ${fresh.length} session events changed (${byTutor.size} tutor${byTutor.size === 1 ? '' : 's'})`,
    body: `${sections}
    <p>The families haven't been told and billing hasn't changed — none of the machinery has run.
    <strong>Adopt</strong> (runs the normal reschedule: parent notice, fee logic, timecards) or
    <strong> revert</strong> the calendar, from each banner linked above.
    Each banner stays until you decide — if a session's time passes first, it switches to
    asking what actually happened (adopt as-happened, no-show, or forfeit). This email won't
    repeat for these changes; the banners are the reminder.</p>`,
  })
  // Marking runs only after the send resolved — a thrown send skips it so
  // the next pass retries the doorbell.
  const nowIso = new Date().toISOString()
  for (const d of fresh) {
    await supabase
      .from('calendar_drift')
      .update({ alerted_at: nowIso, alerted_signature: sig(d) })
      .eq('session_id', d.sessionId)
  }
  return fresh.length
}

export async function syncTutoringDriftTable(tutorId?: string): Promise<TimeDriftRow[]> {
  const drift = await auditTutoringTimeDrift(tutorId)
  const driftedIds = drift.map((d) => d.sessionId)
  let del = supabase.from('calendar_drift').delete()
  if (tutorId) del = del.eq('tutor_id', tutorId)
  if (driftedIds.length > 0) {
    await del.not('session_id', 'in', `(${driftedIds.join(',')})`)
    await supabase.from('calendar_drift').upsert(
      drift.map((d) => ({
        session_id: d.sessionId,
        tutor_id: d.tutorId,
        gcal_event_id: d.gcalEventId,
        portal_starts_at: d.portalStartsAt,
        portal_ends_at: d.portalEndsAt,
        cal_starts_at: d.calStartsAt,
        cal_ends_at: d.calEndsAt,
      })),
      { onConflict: 'session_id' }
    )
  } else {
    await del.gte('detected_at', '1970-01-01') // delete all (scoped) rows
  }
  return drift
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// PL-410: Google push channels — the doorbell layer over the SAME audit.
// A push carries no event details; on notification we re-run the drift audit
// for that one calendar (PL-393/401/402 machinery unchanged). The hourly
// poll STAYS as the backstop for missed pushes, downtime, and channels
// Google silently drops — push is an accelerator, not a replacement.
// ---------------------------------------------------------------------------

/** The public webhook address — pinned to the production origin
 *  (emailBaseUrl-style), NEVER a request host: Google stores this URL inside
 *  the channel, and a stored URL must survive dev renders. After the DNS
 *  cutover (PRODUCTION_BASE_URL flips) stored channels go stale — the sweep
 *  compares webhook_url and re-registers within the hour. */
export function gcalWebhookUrl(): string {
  return `${PRODUCTION_ORIGIN}/api/webhooks/gcal`
}

/** Re-arm expiring channels, arm missing ones, stop orphans. Runs on the
 *  hourly sweep; also the whole story for "disconnect": an org-level
 *  disconnect (gcal_connection) or a tutor going inactive makes the next
 *  pass stop their channels. */
export async function sweepGcalWatchChannels(): Promise<{
  armed: number
  renewed: number
  stopped: number
}> {
  const out = { armed: 0, renewed: 0, stopped: 0 }
  const conn = await loadGcalConnection()
  const { data: channels } = await supabase.from('gcal_watch_channels').select('*')
  const rows = (channels ?? []) as {
    id: string
    tutor_id: string
    calendar_id: string
    channel_id: string
    channel_token: string
    resource_id: string | null
    expiration: string | null
    webhook_url: string | null
  }[]

  const stopRow = async (row: (typeof rows)[number], tutorEmail: string | null) => {
    if (conn?.key && conn.status === 'connected' && tutorEmail && row.resource_id) {
      try {
        await stopWatchChannel(conn.key, tutorEmail, row.channel_id, row.resource_id)
      } catch (e) {
        console.error(`gcal channel stop failed (${row.channel_id}) — deleting the row anyway:`, e)
      }
    }
    await supabase.from('gcal_watch_channels').delete().eq('id', row.id)
    out.stopped++
  }

  const { data: tutors } = await supabase
    .from('instructors')
    .select('id, email, google_calendar_id, active, tutoring_active')
  const tutorById = new Map(((tutors ?? []) as any[]).map((t) => [t.id, t]))

  if (!conn || conn.status !== 'connected' || !conn.key) {
    // Disconnected org: channels can't be renewed (or even stopped via the
    // API) — drop the rows so pushes become unverifiable noise the webhook
    // 200-and-drops.
    for (const row of rows) await stopRow(row, null)
    return out
  }

  const watched = ((tutors ?? []) as any[]).filter((t) => t.active && t.tutoring_active && t.email)
  const wantedByTutor = new Map(watched.map((t) => [t.id, t]))

  // Stop channels for tutors no longer watched.
  for (const row of rows) {
    if (!wantedByTutor.has(row.tutor_id)) {
      await stopRow(row, (tutorById.get(row.tutor_id) as any)?.email ?? null)
    }
  }

  const url = gcalWebhookUrl()
  for (const t of watched) {
    const existing = rows.find((r) => r.tutor_id === t.id)
    const expiringSoon =
      !existing?.expiration || new Date(existing.expiration).getTime() < Date.now() + 24 * 3600_000
    const urlStale = existing != null && existing.webhook_url !== url
    if (existing && !expiringSoon && !urlStale) continue

    const channelId = randomUUID()
    const token = randomBytes(24).toString('base64url')
    try {
      const res = await watchCalendarEvents(conn.key, t.email, t.google_calendar_id ?? null, {
        id: channelId,
        token,
        address: url,
      })
      await supabase.from('gcal_watch_channels').insert({
        tutor_id: t.id,
        calendar_id: t.google_calendar_id ?? 'primary',
        channel_id: channelId,
        channel_token: token,
        resource_id: res.resourceId,
        expiration: res.expiration,
        webhook_url: url,
        updated_at: new Date().toISOString(),
      })
      if (existing) {
        await stopRow(existing, t.email)
        out.renewed++
      } else {
        out.armed++
      }
    } catch (e) {
      // A calendar that can't be watched (e.g. non-Workspace address) just
      // stays on the polling backstop.
      console.error(`gcal watch failed for ${t.email} (polling backstop covers them):`, e)
    }
  }
  return out
}

/** PL-410: handle one validated push — debounced per calendar so a burst
 *  (Billy's Aug-18 mass-delete) coalesces into ONE audit pass and, via
 *  PL-402's once-only grouping, at most ONE email. The caller has already
 *  responded 200; this runs in after(). */
export async function runDebouncedPushAudit(channelRowId: string, myStamp: string): Promise<'ran' | 'superseded' | 'skipped'> {
  // Coalesce: wait out the burst, then only the LAST push's stamp survives.
  await new Promise((r) => setTimeout(r, 15_000))
  const { data: row } = await supabase
    .from('gcal_watch_channels')
    .select('id, tutor_id, last_push_at')
    .eq('id', channelRowId)
    .maybeSingle()
  if (!row || row.last_push_at !== myStamp) return 'superseded'
  const drift = await syncTutoringDriftTable(row.tutor_id)
  await sendGroupedDriftAlert(drift, ADMIN_EMAIL).catch((e) => console.error('push drift alert failed:', e))
  return 'ran'
}
