import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionTutor } from '../../../utils/tutor-gate'
import { enqueueGcalSync, processGcalQueue } from '../../../utils/gcal-sync'
import { recomputeTimecard } from '../../../utils/timecards'
import { workTypeOptions } from '../../../utils/work-types'

// Tutor timecard actions (Phase 7b §7.2): the tutor's only required work is
// correcting exceptions — mark a no-show, adjust an actual duration within
// bounds — and confirming the card. Ownership is checked against the
// caller's instructors rows on every write; nothing on an approved/exported
// timecard can change (the reviewed number must not drift).

type Body =
  | { action: 'no_show'; session_id: string; note?: string }
  | { action: 'adjust_duration'; session_id: string; duration_minutes: number }
  | { action: 'confirm_timecard'; timecard_id: string }
  | { action: 'set_work_type'; session_id: string; work_type: string }

const MIN_MINUTES = 15
const MAX_MINUTES = 240

async function timecardLocked(timecardId: string | null): Promise<boolean> {
  if (!timecardId) return false
  const { data } = await supabase.from('timecards').select('status').eq('id', timecardId).maybeSingle()
  return data?.status === 'approved' || data?.status === 'exported'
}

export async function POST(req: Request) {
  const caller = await sessionTutor()
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  try {
    if (body.action === 'no_show' || body.action === 'adjust_duration') {
      const { data: session } = await supabase
        .from('tutoring_sessions')
        .select('id, tutor_id, status, starts_at, ends_at, timecard_id')
        .eq('id', body.session_id)
        .maybeSingle()
      if (!session || !caller.instructorIds.includes(session.tutor_id)) {
        return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
      }
      if (await timecardLocked(session.timecard_id)) {
        return NextResponse.json(
          { error: 'This pay period has been approved — ask the Ops Director for a correction.' },
          { status: 400 }
        )
      }

      if (body.action === 'no_show') {
        if (session.status !== 'completed' && session.status !== 'confirmed') {
          return NextResponse.json({ error: `A ${session.status} session cannot be marked no-show.` }, { status: 400 })
        }
        const { error } = await supabase
          .from('tutoring_sessions')
          .update({
            status: 'no_show',
            cancelled_at: new Date().toISOString(),
            cancelled_by: 'tutor',
            cancel_note: body.note ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await enqueueGcalSync(session.id, 'tutor marked no-show — XCL')
        after(() => processGcalQueue())
      } else {
        const minutes = Math.round(body.duration_minutes)
        if (!(minutes >= MIN_MINUTES && minutes <= MAX_MINUTES)) {
          return NextResponse.json(
            { error: `Duration must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.` },
            { status: 400 }
          )
        }
        if (session.status !== 'completed') {
          return NextResponse.json({ error: 'Only completed sessions can have their duration corrected.' }, { status: 400 })
        }
        const endsAt = new Date(new Date(session.starts_at).getTime() + minutes * 60_000).toISOString()
        const { error } = await supabase
          .from('tutoring_sessions')
          .update({ ends_at: endsAt, updated_at: new Date().toISOString() })
          .eq('id', session.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }

      if (session.timecard_id) await recomputeTimecard(session.timecard_id)
      return NextResponse.json({ ok: true })
    }

    // PL-103: attribute a tutoring session's hours to a work type (the paper
    // timecard's columns). Options = the standard six + the tutor's own QBO
    // pay-type titles. Class-schedule sessions are always Class/Workshop and
    // have no per-session override here.
    if (body.action === 'set_work_type') {
      const { data: session } = await supabase
        .from('tutoring_sessions')
        .select('id, tutor_id, timecard_id')
        .eq('id', body.session_id)
        .maybeSingle()
      if (!session || !caller.instructorIds.includes(session.tutor_id)) {
        return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
      }
      if (await timecardLocked(session.timecard_id)) {
        return NextResponse.json(
          { error: 'This pay period has been approved — ask the Ops Director for a correction.' },
          { status: 400 }
        )
      }
      const { data: tutor } = await supabase
        .from('instructors')
        .select('pay_type_titles')
        .eq('id', session.tutor_id)
        .maybeSingle()
      const allowed = workTypeOptions(tutor?.pay_type_titles)
      if (!allowed.includes(body.work_type)) {
        return NextResponse.json(
          { error: `Unknown work type — pick one of: ${allowed.join(', ')}.` },
          { status: 400 }
        )
      }
      const { error } = await supabase
        .from('tutoring_sessions')
        .update({ work_type: body.work_type, updated_at: new Date().toISOString() })
        .eq('id', session.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'confirm_timecard') {
      const { data: tc } = await supabase
        .from('timecards')
        .select('id, tutor_id, status')
        .eq('id', body.timecard_id)
        .maybeSingle()
      if (!tc || !caller.instructorIds.includes(tc.tutor_id)) {
        return NextResponse.json({ error: 'Not your timecard.' }, { status: 403 })
      }
      if (tc.status !== 'open') {
        return NextResponse.json({ error: `Timecard is already ${tc.status.replace('_', ' ')}.` }, { status: 400 })
      }
      const total = await recomputeTimecard(tc.id)
      const { error } = await supabase
        .from('timecards')
        .update({
          status: 'tutor_confirmed',
          tutor_confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', tc.id)
        .eq('status', 'open') // guard the race with an admin approving
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, total })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('portal tutoring route failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
