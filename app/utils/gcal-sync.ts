import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import {
  GcalApiError,
  createGcalEvent,
  deleteGcalEvent,
  patchGcalEvent,
  loadGcalConnection,
  type GcalEventInput,
  type ServiceAccountKey,
} from './gcal'
import { sendAdminAlert } from './email'
import { ADMIN_EMAIL } from './lifecycle'

// Phase 7a Google Calendar push worker (spec §4). Same shape as the Phase 6
// QBO worker: enqueue rows ride an after() trigger behind every scheduling
// mutation (fast path) and the daily sweep drains stragglers/retries. A
// Google outage never blocks scheduling — rows wait and retry with backoff.
//
// The worker is STATE-DRIVEN: a queue row just means "make Google match this
// session". What that means is derived from the session row at run time:
//   proposed                → nothing (events exist only once confirmed)
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
      tutoring_engagements ( location, subjects ( name ) ),
      students ( first_name, student_email, families ( parent_email, gcal_invite_attendees ) ),
      instructors ( email, google_calendar_id, timezone, name, default_location )
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
    location_effective: engagement.location ?? tutor.default_location ?? null,
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
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function eventInput(d: SessionDetail, xcl: boolean): GcalEventInput {
  const base = emailBaseUrl()
  return {
    tutorEmail: d.tutor.email,
    calendarId: d.tutor.google_calendar_id,
    summary: `${xcl ? 'XCL- ' : ''}Tutoring: ${d.studentFirst} — ${d.subjectName}`,
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
  }
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
    return { eventId: d.gcal_event_id, note: 'proposed — no event until confirmed' }
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
    const id = await createGcalEvent(key, input)
    return { eventId: id, note: d.gcal_event_id ? 'recreated (event was gone)' : 'created' }
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
        // Keep the session's event pointer in step with what Google now holds.
        if (outcome.eventId !== detail.gcal_event_id || detail.status !== 'proposed') {
          await supabase
            .from('tutoring_sessions')
            .update({ gcal_event_id: outcome.eventId, gcal_synced_at: new Date().toISOString() })
            .eq('id', detail.id)
        }
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
              Fix the cause (Google Calendar panel on /admin/tutoring), then hit Retry there.</p>`,
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
