import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionFamily } from '../../../utils/family-gate'
import { sendAdminAlert } from '../../../utils/email'
import { ADMIN_EMAIL } from '../../../utils/lifecycle'
import { classifyNotice } from '../../../utils/tutoring'

// Parent tutoring actions (Phase 7d §8). One action for now: a reschedule
// REQUEST — the parent asks, the Ops Director executes the actual move in
// the admin schedule (portal requests and phone calls write the same
// records). ≥24h notice is free per the signed policy; <24h the UI shows
// the $40/hour terms first and the request still routes to the Ops
// Director, whose discretion wins (§3: emergencies).

export async function POST(req: Request) {
  const caller = await sessionFamily()
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { action?: 'reschedule_request'; session_id?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.action !== 'reschedule_request' || !body.session_id) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: session } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, starts_at, ends_at, status, reschedule_requested_at,
       students!inner ( first_name, last_name, family_id ),
       tutoring_engagements ( subjects ( name ) ),
       instructors ( name )`
    )
    .eq('id', body.session_id)
    .maybeSingle()
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v
  const student: any = one(session?.students)
  if (!session || !student || !caller.familyIds.includes(student.family_id)) {
    return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (session.status !== 'confirmed') {
    return NextResponse.json({ error: 'Only upcoming confirmed sessions can be rescheduled.' }, { status: 400 })
  }
  if (new Date(session.starts_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'That session has already started — get in touch instead.' }, { status: 400 })
  }

  const notice = classifyNotice(new Date(session.starts_at))
  const note = (body.note ?? '').slice(0, 1000)
  await supabase
    .from('tutoring_sessions')
    .update({
      reschedule_requested_at: new Date().toISOString(),
      reschedule_request_note: note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const subjectName = (Array.isArray(session.tutoring_engagements)
    ? (session.tutoring_engagements[0] as any)
    : (session.tutoring_engagements as any)
  )?.subjects
  const subj = Array.isArray(subjectName) ? subjectName[0]?.name : subjectName?.name
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const when = new Date(session.starts_at).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  await sendAdminAlert({
    dedupeKey: `reschedule_request:${session.id}:${Date.now()}`,
    adminEmail: ADMIN_EMAIL,
    subject: `Reschedule request — ${student.first_name} ${student.last_name}, ${when} (${notice === 'ok' ? 'free, 24h+ notice' : 'INSIDE 24h — $40/hr policy'})`,
    body: `<p><strong>${student.first_name} ${student.last_name}</strong>'s family asked to move the
      ${subj ?? 'tutoring'} session on <strong>${when}</strong> (Denver).</p>
      ${note ? `<blockquote style="border-left:3px solid #cbd5e1;margin:8px 0;padding:4px 12px;color:#334155">${note.replace(/</g, '&lt;')}</blockquote>` : ''}
      <p>Notice: <strong>${notice === 'ok' ? '24h+ — free reschedule' : 'inside 24h — $40/hour late-reschedule policy (your discretion)'}</strong>.
      Use Reschedule on the session in /admin/tutoring — the family and tutor get T3 automatically
      and the calendar moves.</p>`,
  }).catch((e) => console.error('reschedule-request alert failed:', e))

  return NextResponse.json({ ok: true, notice })
}
