import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyAvailabilityToken } from '../../utils/intake'
import { validAvailabilityRanges } from '../../utils/availability'
import { sendAdminAlert } from '../../utils/email'
import { ADMIN_EMAIL } from '../../utils/lifecycle'

// PL-53b: the add-on family's availability submission (from the tokenized
// /availability/{token} page, linked in #0 and the #8 scheduling fork).
// Same trust model as the intake link. Rows land in student_availability
// with source='parent'; re-submits replace the grid (latest family word
// wins, same as intake/staff saves); the Ops Director hears about it so
// scheduling can start.

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const familyId = typeof body.token === 'string' ? verifyAvailabilityToken(body.token) : null
  if (!familyId) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  }
  const studentId = typeof body.studentId === 'string' ? body.studentId : null
  if (!studentId) return NextResponse.json({ error: 'Missing student.' }, { status: 400 })
  if (!validAvailabilityRanges(body.availability)) {
    return NextResponse.json({ error: 'Please check the times — each range needs a start before its end.' }, { status: 400 })
  }
  let timezone = typeof body.timezone === 'string' ? body.timezone.slice(0, 60) : 'America/Denver'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    timezone = 'America/Denver'
  }

  // The token is family-scoped — the student must belong to that family.
  const { data: student } = await supabase
    .from('students')
    .select('id, first_name, last_name, family_id, families ( parent_first_name, parent_email )')
    .eq('id', studentId)
    .eq('family_id', familyId)
    .maybeSingle()
  if (!student) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })

  // Whole-grid replacement — the family's newest word wins.
  const { error: clearError } = await supabase
    .from('student_availability')
    .delete()
    .eq('student_id', studentId)
  if (clearError) {
    console.error('availability clear failed:', clearError.message)
    return NextResponse.json({ error: 'Could not save — please try again.' }, { status: 500 })
  }
  if (body.availability.length > 0) {
    const { error: insertError } = await supabase.from('student_availability').insert(
      body.availability.map((r) => ({
        student_id: studentId,
        weekday: r.weekday,
        start_time: r.start_time,
        end_time: r.end_time,
        timezone,
        source: 'parent',
      }))
    )
    if (insertError) {
      console.error('availability insert failed:', insertError.message)
      return NextResponse.json({ error: 'Could not save — please try again.' }, { status: 500 })
    }
  }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const fam: any = Array.isArray(student.families) ? student.families[0] : student.families
  await sendAdminAlert({
    // Dated key: a re-share after edits alerts again, same-day repeats don't.
    dedupeKey: `availability_shared:${studentId}:${new Date().toISOString().slice(0, 10)}`,
    adminEmail: ADMIN_EMAIL,
    templateKey: 'AL_AVAILABILITY_SHARED',
    vars: { alertStudentName: `${student.first_name} ${student.last_name}` },
    subject: `Add-on family shared availability — ${student.first_name} ${student.last_name} is ready to schedule`,
    body: `<p><strong>${fam?.parent_first_name ?? 'A parent'}</strong> (${fam?.parent_email ?? '—'})
      shared ${student.first_name}'s availability${body.availability.length === 0 ? ' (cleared it, actually)' : ''}.</p>
      <p>It's on the student record — the student-schedule wizard on /admin/tutoring will
      suggest matching times.</p>`,
  }).catch((e) => console.error('availability alert failed (rows stand):', e))

  return NextResponse.json({ ok: true })
}
