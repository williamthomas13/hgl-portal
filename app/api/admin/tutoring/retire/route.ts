import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'

// PL-223: access-aware retire — one click, correct in both cases.
// Tutor-only person (no other active teaching): retire also ends their portal
// login (instructors.active=false), and the flow remembers it did so
// (login_ended_by_retire) so un-retire restores exactly what retire took
// away — never a login someone deactivated separately on the Instructors
// page. Dual-role person (still teaches classes): retire ends tutoring only.
// Rollout-gated tutors (tutoring_active=false, active=true) are untouched by
// this route's definitions — they simply live on the Former tab.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** "Still teaches classes" = named instructor on a non-cancelled class with
 *  any session today or later (school-local nuance skipped on purpose — a
 *  same-day boundary error here just changes which dialog copy shows). */
async function teachingClasses(instructorId: string): Promise<string[]> {
  const { data } = await supabase
    .from('classes')
    .select('id, class_type, status, schools ( nickname ), sessions ( session_date )')
    .eq('instructor_id', instructorId)
    .neq('status', 'cancelled')
  const today = new Date().toISOString().slice(0, 10)
  return ((data as any[]) ?? [])
    .filter((c) => ((c.sessions as any[]) ?? []).some((s) => s.session_date >= today))
    .map((c) => {
      const school = Array.isArray(c.schools) ? c.schools[0] : c.schools
      return `${school?.nickname ?? '—'} ${c.class_type}`
    })
}

export async function GET(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(request.url)
  const instructorId = url.searchParams.get('instructor') ?? ''
  if (!instructorId) return NextResponse.json({ error: 'Missing instructor.' }, { status: 400 })
  const { data: inst } = await supabase
    .from('instructors')
    .select('id, name, active, tutoring_active, login_ended_by_retire')
    .eq('id', instructorId)
    .maybeSingle()
  if (!inst) return NextResponse.json({ error: 'Unknown instructor.' }, { status: 404 })
  const teaching = await teachingClasses(instructorId)
  return NextResponse.json({
    ok: true,
    active: inst.active,
    tutoringActive: inst.tutoring_active,
    loginEndedByRetire: inst.login_ended_by_retire,
    teachingClasses: teaching,
    tutorOnly: teaching.length === 0,
  })
}

export async function POST(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const instructorId = String(body.instructor_id ?? '')
  const action = String(body.action ?? '')
  if (!instructorId || !['retire', 'unretire'].includes(action)) {
    return NextResponse.json({ error: 'Missing instructor or action.' }, { status: 400 })
  }
  const { data: inst } = await supabase
    .from('instructors')
    .select('id, name, active, tutoring_active, login_ended_by_retire')
    .eq('id', instructorId)
    .maybeSingle()
  if (!inst) return NextResponse.json({ error: 'Unknown instructor.' }, { status: 404 })

  if (action === 'retire') {
    const teaching = await teachingClasses(instructorId)
    const tutorOnly = teaching.length === 0
    // Only mark the login as retire-ended when it was actually ON — retiring
    // someone already deactivated must not claim their login for restore.
    const endsLogin = tutorOnly && inst.active
    const { error } = await supabase
      .from('instructors')
      .update({
        tutoring_active: false,
        ...(endsLogin ? { active: false, login_ended_by_retire: true } : {}),
      })
      .eq('id', instructorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      ok: true,
      loginEnded: endsLogin,
      teachingClasses: teaching,
      message: endsLogin
        ? `${inst.name ?? 'Tutor'} retired — this also ended their portal login (they had no other active role). Reactivate any time from the Former tab.`
        : tutorOnly
          ? `${inst.name ?? 'Tutor'} retired. Their portal login was already off.`
          : `${inst.name ?? 'Tutor'} retired from 1-on-1 tutoring. Their login stays because they still teach ${teaching.join(', ')} — deactivate them on the Instructors page if they're leaving entirely.`,
    })
  }

  // unretire
  const restoreLogin = inst.login_ended_by_retire
  const { error } = await supabase
    .from('instructors')
    .update({
      tutoring_active: true,
      ...(restoreLogin ? { active: true, login_ended_by_retire: false } : {}),
    })
    .eq('id', instructorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    ok: true,
    loginRestored: restoreLogin,
    message: restoreLogin
      ? `${inst.name ?? 'Tutor'} reactivated — their portal login is back on too (retiring had ended it).`
      : inst.active
        ? `${inst.name ?? 'Tutor'} reactivated for 1-on-1 tutoring.`
        : `${inst.name ?? 'Tutor'} reactivated for tutoring, but their portal login stays OFF — it was deactivated separately on the Instructors page; re-enable it there if they're really back.`,
  })
}
