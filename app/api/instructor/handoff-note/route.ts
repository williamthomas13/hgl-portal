import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { createSupabaseServerClient } from '../../../utils/supabase-server'
import { adminAllowlist } from '../../../utils/portal-auth'

// PL-53d: the class instructor's handoff note for a student continuing to
// 1-on-1 tutoring — written from the final-session attendance screen, read
// by the Ops Director during matching and by the assigned tutor before the
// first session. Caller must be staff, or an instructor of a class this
// student is enrolled in.

export async function POST(req: Request) {
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const email = user.email.trim().toLowerCase()

  let body: { studentId?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const studentId = body.studentId
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 4000) : ''
  if (!studentId) return NextResponse.json({ error: 'Missing student.' }, { status: 400 })

  // Authorization: staff, or the instructor of one of this student's classes.
  let allowed = adminAllowlist().includes(email)
  if (!allowed) {
    const { data: profile } = await supabase.from('profiles').select('role').ilike('email', email).limit(1)
    const role = profile?.[0]?.role
    allowed = role === 'admin' || role === 'manager'
  }
  if (!allowed) {
    const { data: taught } = await supabase
      .from('enrollments')
      .select('id, classes!inner ( instructors!inner ( email ) )')
      .eq('student_id', studentId)
      .ilike('classes.instructors.email', email)
      .limit(1)
    allowed = (taught?.length ?? 0) > 0
  }
  if (!allowed) return NextResponse.json({ error: 'Not authorized for this student.' }, { status: 403 })

  const { error } = await supabase
    .from('students')
    .update({
      tutoring_handoff_note: note || null,
      tutoring_handoff_by: note ? email : null,
      tutoring_handoff_at: note ? new Date().toISOString() : null,
    })
    .eq('id', studentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
