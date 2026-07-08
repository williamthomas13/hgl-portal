import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyClassroomRequestToken, ADMIN_EMAIL } from '../../utils/lifecycle'
import { sendAdminAlert } from '../../utils/email'

// Classroom-request form submit (PHASE4_SPEC §4b). Tokenized, no login.
// Writes classes.default_location, marks the request answered, and alerts
// the admin. Everything downstream — #4/#5, the ICS calendar, portal views —
// reads default_location, and if #4 already went out, the existing
// schedule-update sweep detects the change and sends the SU email
// automatically on the next hourly run.

export async function POST(request: Request) {
  let body: { classId?: string; token?: string; counselorEmail?: string; answer?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const classId = (body.classId ?? '').trim()
  const token = (body.token ?? '').trim()
  const answer = (body.answer ?? '').trim()
  const counselorEmail = (body.counselorEmail ?? '').trim().toLowerCase()

  if (!classId || !token || !verifyClassroomRequestToken(classId, token)) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 403 })
  }
  if (!answer) {
    return NextResponse.json({ error: 'Please enter a location.' }, { status: 400 })
  }

  const { data: cls } = await supabase
    .from('classes')
    .select('id, class_type, schools ( nickname )')
    .eq('id', classId)
    .single()
  if (!cls) {
    return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('classes')
    .update({ default_location: answer })
    .eq('id', classId)
  if (updateError) {
    return NextResponse.json({ error: 'Could not save the location.' }, { status: 500 })
  }

  await supabase
    .from('classroom_requests')
    .update({
      status: 'answered',
      answered_at: new Date().toISOString(),
      answered_by: counselorEmail || null,
      answer,
    })
    .eq('class_id', classId)
    .eq('status', 'pending')

  const school = Array.isArray(cls.schools) ? cls.schools[0] : cls.schools
  const label = `${(school as { nickname?: string } | null)?.nickname ?? 'HGL'} ${cls.class_type}`
  await sendAdminAlert({
    dedupeKey: `classroom_answer:${classId}:${Date.now()}`,
    adminEmail: ADMIN_EMAIL,
    subject: `Counselor set ${label} location: ${answer}`,
    body: `<p>${counselorEmail || 'A counselor'} answered the classroom request for
      <strong>${label}</strong>: <strong>${answer}</strong>.</p>
      <p>The class location is updated everywhere. If the class-details email already went out,
      the schedule-update email goes out automatically on the next hourly sweep.</p>`,
  })

  return NextResponse.json({ ok: true })
}
