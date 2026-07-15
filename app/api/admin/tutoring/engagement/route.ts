import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { enqueueGcalSync, processGcalQueue } from '../../../../utils/gcal-sync'
import { deleteGcalEvent, loadGcalConnection } from '../../../../utils/gcal'
import {
  generateOccurrences,
  horizonEndIso,
  validRecurrence,
  type RecurrenceSlot,
} from '../../../../utils/tutoring'

// Engagement lifecycle (Phase 7a §5): create with generated sessions, edit
// (optionally regenerating future unbilled sessions), pause/resume/end.
// Staff-gated; writes run as service role so the gcal queue insert (RLS:
// service-role-only) works in the same request.
//
// In 7a sessions are born `confirmed` — the propose/confirm cycle is 7c; the
// Ops Director entering a schedule here IS the confirmation for now — and each one is
// enqueued for the Google push, drained by after() behind the response.

type CreateBody = {
  action: 'create'
  student_id: string
  tutor_id: string
  subject_id: string
  hourly_rate: number
  funding?: 'monthly_billed' | 'package'
  addon_id?: string | null
  recurrence?: RecurrenceSlot[]
  location?: string | null
  start_date?: string | null // YYYY-MM-DD; default today
  notes?: string | null
}

type UpdateBody = {
  action: 'update'
  id: string
  hourly_rate?: number
  funding?: 'monthly_billed' | 'package'
  addon_id?: string | null
  recurrence?: RecurrenceSlot[]
  location?: string | null
  notes?: string | null
  status?: 'active' | 'paused' | 'ended'
  end_date?: string | null
  /** Re-materialize future unbilled sessions from the (possibly changed)
   *  recurrence. Sessions already on an invoice are never touched. */
  regenerate?: boolean
}

type Body = CreateBody | UpdateBody

async function tutorTimezone(tutorId: string): Promise<string> {
  const { data } = await supabase
    .from('instructors')
    .select('timezone')
    .eq('id', tutorId)
    .maybeSingle()
  return data?.timezone ?? 'America/Denver'
}

/** Insert confirmed sessions for every future occurrence up to the horizon,
 *  skipping instants the engagement already has a live session for. */
async function materializeSessions(engagement: {
  id: string
  student_id: string
  tutor_id: string
  hourly_rate: number
  recurrence: RecurrenceSlot[]
  start_date: string | null
}): Promise<{ created: number }> {
  if (!validRecurrence(engagement.recurrence) || engagement.recurrence.length === 0) {
    return { created: 0 }
  }
  const tz = await tutorTimezone(engagement.tutor_id)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const from = engagement.start_date && engagement.start_date > today ? engagement.start_date : today
  const occurrences = generateOccurrences(engagement.recurrence, from, horizonEndIso(tz), tz).filter(
    (o) => o.startsAt.getTime() > Date.now()
  )
  if (occurrences.length === 0) return { created: 0 }

  const { data: existing } = await supabase
    .from('tutoring_sessions')
    .select('starts_at')
    .eq('engagement_id', engagement.id)
    .in('status', ['proposed', 'confirmed'])
  const taken = new Set((existing ?? []).map((s) => new Date(s.starts_at).getTime()))

  const rows = occurrences
    .filter((o) => !taken.has(o.startsAt.getTime()))
    .map((o) => ({
      engagement_id: engagement.id,
      student_id: engagement.student_id,
      tutor_id: engagement.tutor_id,
      starts_at: o.startsAt.toISOString(),
      ends_at: o.endsAt.toISOString(),
      status: 'confirmed',
      rate_snapshot: engagement.hourly_rate,
    }))
  if (rows.length === 0) return { created: 0 }

  const { data: inserted, error } = await supabase
    .from('tutoring_sessions')
    .insert(rows)
    .select('id')
  if (error) throw new Error(`session generation failed: ${error.message}`)
  for (const s of inserted ?? []) await enqueueGcalSync(s.id, 'engagement schedule')
  return { created: inserted?.length ?? 0 }
}

/** Remove future unbilled proposed/confirmed sessions (schedule change or
 *  engagement end). Their Google events are deleted inline (best-effort)
 *  BEFORE the rows go — row deletion cascades the queue away. */
async function clearFutureSessions(engagementId: string): Promise<{ removed: number }> {
  const { data: doomed } = await supabase
    .from('tutoring_sessions')
    .select('id, gcal_event_id, tutor_id, instructors ( email, google_calendar_id )')
    .eq('engagement_id', engagementId)
    .in('status', ['proposed', 'confirmed'])
    .is('invoice_id', null)
    .gt('starts_at', new Date().toISOString())
  if (!doomed || doomed.length === 0) return { removed: 0 }

  const conn = await loadGcalConnection()
  if (conn?.key && conn.status === 'connected') {
    for (const s of doomed) {
      if (!s.gcal_event_id) continue
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const tutor: any = Array.isArray(s.instructors) ? s.instructors[0] : s.instructors
      if (!tutor?.email) continue
      try {
        await deleteGcalEvent(conn.key, tutor.email, tutor.google_calendar_id, s.gcal_event_id)
      } catch (e) {
        console.error(`gcal delete failed for session ${s.id} (continuing):`, e)
      }
    }
  }

  const { error } = await supabase
    .from('tutoring_sessions')
    .delete()
    .in('id', doomed.map((s) => s.id))
  if (error) throw new Error(`clearing sessions failed: ${error.message}`)
  return { removed: doomed.length }
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  try {
    if (body.action === 'create') {
      const { student_id, tutor_id, subject_id, hourly_rate } = body
      if (!student_id || !tutor_id || !subject_id || !(hourly_rate > 0)) {
        return NextResponse.json({ error: 'Missing student, tutor, subject, or rate.' }, { status: 400 })
      }
      const recurrence = body.recurrence ?? []
      if (!validRecurrence(recurrence)) {
        return NextResponse.json({ error: 'Invalid weekly slots.' }, { status: 400 })
      }
      if (body.funding === 'package' && !body.addon_id) {
        return NextResponse.json({ error: 'Package funding needs the package (add-on) to draw from.' }, { status: 400 })
      }
      const { data: engagement, error } = await supabase
        .from('tutoring_engagements')
        .insert({
          student_id,
          tutor_id,
          subject_id,
          hourly_rate,
          funding: body.funding ?? 'monthly_billed',
          addon_id: body.addon_id ?? null,
          recurrence,
          location: body.location ?? null,
          start_date: body.start_date ?? null,
          notes: body.notes ?? null,
        })
        .select('id, student_id, tutor_id, hourly_rate, recurrence, start_date')
        .single()
      if (error || !engagement) {
        return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 })
      }
      const { created } = await materializeSessions(engagement)
      after(() => processGcalQueue())
      return NextResponse.json({ ok: true, id: engagement.id, sessionsCreated: created })
    }

    if (body.action === 'update') {
      if (!body.id) return NextResponse.json({ error: 'Missing engagement id.' }, { status: 400 })
      if (body.recurrence !== undefined && !validRecurrence(body.recurrence)) {
        return NextResponse.json({ error: 'Invalid weekly slots.' }, { status: 400 })
      }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const k of ['hourly_rate', 'funding', 'addon_id', 'recurrence', 'location', 'notes', 'status', 'end_date'] as const) {
        if (body[k] !== undefined) patch[k] = body[k]
      }
      const { data: engagement, error } = await supabase
        .from('tutoring_engagements')
        .update(patch)
        .eq('id', body.id)
        .select('id, student_id, tutor_id, hourly_rate, recurrence, start_date, status')
        .single()
      if (error || !engagement) {
        return NextResponse.json({ error: error?.message ?? 'Update failed.' }, { status: 500 })
      }

      let removed = 0
      let created = 0
      const ending = engagement.status === 'ended' || engagement.status === 'paused'
      if (body.regenerate || ending) {
        ;({ removed } = await clearFutureSessions(engagement.id))
      }
      if (body.regenerate && engagement.status === 'active') {
        ;({ created } = await materializeSessions(engagement))
      }
      after(() => processGcalQueue())
      return NextResponse.json({ ok: true, id: engagement.id, sessionsRemoved: removed, sessionsCreated: created })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('tutoring engagement route failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
