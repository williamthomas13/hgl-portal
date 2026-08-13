import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { loadClassBundles } from '../../../utils/lifecycle'
import { sendMinEnrollmentDecisionNote } from '../../../utils/instructor-comms'

// PL-335: the minimum-enrollment decision surface's API — the three
// resolutions all pass through here except Cancel (the existing
// /api/admin/cancel-class, whose comms already inform the instructor):
//
//  · run_anyway — a RECORDED decision: the class proceeds regardless of the
//    paid count and the Needs Attention row clears permanently (the row's
//    condition adds `and min_enrollment_decision is null`).
//  · undo — clears the decision while the deadline hasn't passed; the
//    state-driven row re-arms on its own.
//  · set_deadline — the deadline edit (was a direct client write). When the
//    class is under minimum with the deadline inside the row's own 3-day
//    window, extending is one of the three decisions, so the instructor
//    hears about it — otherwise it's just a date edit, silent. Extend is a
//    snooze, not a dismissal: the check keeps working against the new date.

type Body = {
  classId?: string
  action?: 'run_anyway' | 'undo' | 'set_deadline'
  deadline?: string | null
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
  if (!body.classId || !body.action) {
    return NextResponse.json({ error: 'Missing class or action.' }, { status: 400 })
  }
  const { data: cls } = await supabase
    .from('classes')
    .select(
      'id, status, min_enrollment, enrollment_deadline, min_enrollment_decision, instructor_id, enrollments ( payment_status )'
    )
    .eq('id', body.classId)
    .maybeSingle()
  if (!cls) return NextResponse.json({ error: 'Unknown class.' }, { status: 404 })

  const todayIso = new Date().toISOString().slice(0, 10)
  const paid = ((cls.enrollments as { payment_status: string }[]) ?? []).filter((e) =>
    ['Paid', 'Completed'].includes(e.payment_status)
  ).length
  const notify = (fn: () => Promise<unknown>) =>
    after(async () => {
      try {
        await fn()
      } catch (e) {
        console.error('min-enrollment decision note failed (decision stands):', e)
      }
    })
  const bundleFor = async () => {
    const bundles = await loadClassBundles()
    return bundles.find((b) => b.id === body.classId) ?? null
  }

  if (body.action === 'run_anyway') {
    if (cls.status === 'cancelled') {
      return NextResponse.json({ error: 'This class is cancelled.' }, { status: 400 })
    }
    const decidedAt = new Date().toISOString()
    const { error } = await supabase
      .from('classes')
      .update({
        min_enrollment_decision: 'run_anyway',
        min_enrollment_decided_at: decidedAt,
        min_enrollment_decided_by: caller.email,
      })
      .eq('id', body.classId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    notify(async () => {
      const bundle = await bundleFor()
      if (bundle) await sendMinEnrollmentDecisionNote(bundle, 'run_anyway', { decidedAt })
    })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'undo') {
    // Undo-able while the deadline hasn't passed — clearing re-arms the row.
    if (cls.enrollment_deadline && cls.enrollment_deadline < todayIso) {
      return NextResponse.json(
        { error: 'The deadline has passed — the decision stays on the record.' },
        { status: 400 }
      )
    }
    const { error } = await supabase
      .from('classes')
      .update({
        min_enrollment_decision: null,
        min_enrollment_decided_at: null,
        min_enrollment_decided_by: null,
      })
      .eq('id', body.classId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // set_deadline — null clears back to the default.
  const value = body.deadline ?? null
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return NextResponse.json({ error: 'Pass the deadline as a calendar date.' }, { status: 400 })
  }
  const old = cls.enrollment_deadline as string | null
  const { error } = await supabase
    .from('classes')
    .update({ enrollment_deadline: value })
    .eq('id', body.classId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The extend DECISION (not every date edit): under minimum, the old
  // deadline inside the Needs Attention window, moved later — same 3-day
  // horizon the dashboard row derives from.
  const in3d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  const wasDecisionWindow =
    cls.min_enrollment != null &&
    paid < cls.min_enrollment &&
    !!old &&
    old >= todayIso &&
    old <= in3d
  if (wasDecisionWindow && value && value > (old as string) && cls.instructor_id) {
    notify(async () => {
      const bundle = await bundleFor()
      if (bundle) await sendMinEnrollmentDecisionNote(bundle, 'extend', { newDeadline: value })
    })
  }
  return NextResponse.json({ ok: true })
}
