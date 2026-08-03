import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { enqueueGcalSync, processGcalQueue } from '../../../../utils/gcal-sync'
import { deleteGcalEvent, loadGcalConnection } from '../../../../utils/gcal'
import { rescheduleSession } from '../../../../utils/reschedule'
import { sendRescheduleAck, sendScheduleChangeNotices } from '../../../../utils/tutoring-emails'

// Session actions (Phase 7a §5): one-off create, time edit, reschedule
// (creates the replacement; auto-classifies ok/late by the 24h line,
// Ops-Director-overridable), cancel → forfeit/no-show, and guarded delete. The month
// is prepaid (7c) so there is no cancel-with-refund: changes are reschedules
// or forfeits (spec §3). Every mutation enqueues a Google push; after()
// drains behind the response.

type Body =
  | { action: 'create'; engagement_id: string; starts_at: string; ends_at: string }
  | { action: 'update_time'; id: string; starts_at: string; ends_at: string }
  | {
      action: 'reschedule'
      id: string
      new_starts_at: string
      new_ends_at: string
      notice?: 'ok' | 'late' // override; default = 24h auto-classification
      note?: string
      requested_by?: 'parent' | 'tutor' | 'staff'
    }
  | {
      action: 'cancel'
      id: string
      outcome: 'forfeited' | 'no_show'
      note?: string
      requested_by?: 'parent' | 'tutor' | 'staff'
    }
  | { action: 'delete'; id: string }
  // PL-262: email the family that their reschedule request reached a human.
  | { action: 'ack_reschedule'; id: string }

function validSpan(startsAt: string, endsAt: string): boolean {
  const s = new Date(startsAt).getTime()
  const e = new Date(endsAt).getTime()
  return Number.isFinite(s) && Number.isFinite(e) && e > s && e - s <= 12 * 3600_000
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
    // PL-262: the "got your message" reply — idempotent per request stamp
    // (sendOnce dedupes), so double clicks can't double-send.
    if (body.action === 'ack_reschedule') {
      const status = await sendRescheduleAck(body.id)
      if (status === 'no_request') {
        return NextResponse.json(
          { error: 'No pending reschedule request on this session (or no parent email on file).' },
          { status: 400 }
        )
      }
      return NextResponse.json({ ok: true, already: status === 'already' })
    }

    if (body.action === 'create') {
      if (!body.engagement_id || !validSpan(body.starts_at, body.ends_at)) {
        return NextResponse.json({ error: 'Missing engagement or invalid times.' }, { status: 400 })
      }
      const { data: engagement } = await supabase
        .from('tutoring_engagements')
        .select('id, student_id, tutor_id, hourly_rate')
        .eq('id', body.engagement_id)
        .maybeSingle()
      if (!engagement) return NextResponse.json({ error: 'Unknown engagement.' }, { status: 404 })
      const { data: session, error } = await supabase
        .from('tutoring_sessions')
        .insert({
          engagement_id: engagement.id,
          student_id: engagement.student_id,
          tutor_id: engagement.tutor_id,
          starts_at: body.starts_at,
          ends_at: body.ends_at,
          status: 'confirmed',
          rate_snapshot: engagement.hourly_rate,
        })
        .select('id')
        .single()
      if (error || !session) return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 })
      await enqueueGcalSync(session.id, 'one-off session')
      after(() => processGcalQueue())
      return NextResponse.json({ ok: true, id: session.id })
    }

    if (body.action === 'update_time') {
      if (!body.id || !validSpan(body.starts_at, body.ends_at)) {
        return NextResponse.json({ error: 'Invalid times.' }, { status: 400 })
      }
      const { data: session, error } = await supabase
        .from('tutoring_sessions')
        .update({ starts_at: body.starts_at, ends_at: body.ends_at, updated_at: new Date().toISOString() })
        .eq('id', body.id)
        .in('status', ['proposed', 'confirmed'])
        .select('id')
        .single()
      if (error || !session) {
        return NextResponse.json({ error: error?.message ?? 'Only upcoming sessions can be edited.' }, { status: 400 })
      }
      await enqueueGcalSync(session.id, 'time edit')
      after(() => processGcalQueue())
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'reschedule') {
      if (!body.id || !validSpan(body.new_starts_at, body.new_ends_at)) {
        return NextResponse.json({ error: 'Invalid replacement times.' }, { status: 400 })
      }
      // PL-180: the machinery lives in rescheduleSession — the ONE code path
      // this route and the calendar-edit Adopt both run through.
      const result = await rescheduleSession({
        id: body.id,
        newStartsAt: body.new_starts_at,
        newEndsAt: body.new_ends_at,
        notice: body.notice,
        note: body.note ?? null,
        requestedBy: body.requested_by ?? 'staff',
      })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      // after() callbacks must RETURN their promises or the work dies with
      // the frozen lambda.
      after(() => Promise.allSettled([processGcalQueue(), result.followUp()]))
      return NextResponse.json({ ok: true, replacementId: result.replacementId, notice: result.notice })
    }

    if (body.action === 'cancel') {
      if (!body.id || (body.outcome !== 'forfeited' && body.outcome !== 'no_show')) {
        return NextResponse.json({ error: 'Invalid cancel request.' }, { status: 400 })
      }
      const { data: before } = await supabase
        .from('tutoring_sessions')
        .select('status')
        .eq('id', body.id)
        .maybeSingle()
      const { data: session, error } = await supabase
        .from('tutoring_sessions')
        .update({
          status: body.outcome,
          cancelled_at: new Date().toISOString(),
          cancelled_by: body.requested_by ?? 'staff',
          cancel_note: body.note ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.id)
        .in('status', ['proposed', 'confirmed', 'completed'])
        .select('id')
        .single()
      if (error || !session) {
        return NextResponse.json({ error: error?.message ?? 'Session not in a cancellable state.' }, { status: 400 })
      }
      await enqueueGcalSync(session.id, body.outcome === 'no_show' ? 'no-show — XCL' : 'forfeit — XCL')
      const outcome = body.outcome
      const wasLive = before?.status === 'confirmed' || before?.status === 'completed'
      after(() =>
        Promise.allSettled([
          processGcalQueue(),
          ...(wasLive ? [sendScheduleChangeNotices({ sessionId: session.id, kind: outcome })] : []),
        ])
      )
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'delete') {
      if (!body.id) return NextResponse.json({ error: 'Missing session id.' }, { status: 400 })
      const { data: session } = await supabase
        .from('tutoring_sessions')
        .select('id, invoice_id, gcal_event_id, instructors ( email, google_calendar_id )')
        .eq('id', body.id)
        .maybeSingle()
      if (!session) return NextResponse.json({ error: 'Unknown session.' }, { status: 404 })
      if (session.invoice_id) {
        return NextResponse.json({ error: 'This session is on an invoice — void/adjust instead of deleting.' }, { status: 400 })
      }
      // Best-effort event removal BEFORE the row goes (cascade takes the
      // queue row with it, so this can't be deferred to the worker).
      if (session.gcal_event_id) {
        const conn = await loadGcalConnection()
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const tutor: any = Array.isArray(session.instructors) ? session.instructors[0] : session.instructors
        if (conn?.key && conn.status === 'connected' && tutor?.email) {
          try {
            await deleteGcalEvent(conn.key, tutor.email, tutor.google_calendar_id, session.gcal_event_id)
          } catch (e) {
            console.error(`gcal delete failed for session ${session.id} (continuing):`, e)
          }
        }
      }
      const { error } = await supabase.from('tutoring_sessions').delete().eq('id', session.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('tutoring session route failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
