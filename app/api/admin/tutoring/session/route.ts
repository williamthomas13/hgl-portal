import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { enqueueGcalSync, processGcalQueue } from '../../../../utils/gcal-sync'
import { deleteGcalEvent, loadGcalConnection } from '../../../../utils/gcal'
import { classifyNotice } from '../../../../utils/tutoring'

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
      const { data: original } = await supabase
        .from('tutoring_sessions')
        .select('id, engagement_id, student_id, tutor_id, starts_at, rate_snapshot, status, gcal_event_id')
        .eq('id', body.id)
        .maybeSingle()
      if (!original) return NextResponse.json({ error: 'Unknown session.' }, { status: 404 })
      if (original.status !== 'confirmed' && original.status !== 'proposed') {
        return NextResponse.json({ error: `A ${original.status} session cannot be rescheduled.` }, { status: 400 })
      }
      const notice = body.notice ?? classifyNotice(new Date(original.starts_at))

      const { data: replacement, error: insertError } = await supabase
        .from('tutoring_sessions')
        .insert({
          engagement_id: original.engagement_id,
          student_id: original.student_id,
          tutor_id: original.tutor_id,
          starts_at: body.new_starts_at,
          ends_at: body.new_ends_at,
          status: 'confirmed',
          rate_snapshot: original.rate_snapshot,
          // Free reschedule MOVES the Google event (spec §4): the replacement
          // inherits the id and the push patches it to the new time. Late
          // reschedule keeps the original event (XCL-marked — the tutor is
          // paid for the reserved slot) and this row gets a fresh event.
          gcal_event_id: notice === 'ok' ? original.gcal_event_id : null,
        })
        .select('id')
        .single()
      if (insertError || !replacement) {
        return NextResponse.json({ error: insertError?.message ?? 'Insert failed.' }, { status: 500 })
      }

      const { error: updateError } = await supabase
        .from('tutoring_sessions')
        .update({
          status: 'rescheduled',
          rescheduled_to_id: replacement.id,
          reschedule_notice: notice,
          gcal_event_id: notice === 'ok' ? null : original.gcal_event_id,
          cancelled_at: new Date().toISOString(),
          cancelled_by: body.requested_by ?? 'staff',
          cancel_note: body.note ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', original.id)
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

      await enqueueGcalSync(replacement.id, `reschedule (${notice})`)
      if (notice === 'late') await enqueueGcalSync(original.id, 'late reschedule — XCL original')
      after(() => processGcalQueue())
      return NextResponse.json({ ok: true, replacementId: replacement.id, notice })
    }

    if (body.action === 'cancel') {
      if (!body.id || (body.outcome !== 'forfeited' && body.outcome !== 'no_show')) {
        return NextResponse.json({ error: 'Invalid cancel request.' }, { status: 400 })
      }
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
      after(() => processGcalQueue())
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
