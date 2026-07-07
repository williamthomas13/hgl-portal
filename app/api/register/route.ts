import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { localDate, DEFAULT_TIMEZONE } from '../../utils/lifecycle'
import { upsertFamilyAndStudent } from '../../utils/registration'

// Creates the family + student + Pending enrollment for a registration.
// Phase 3 moved these writes out of the browser (anon has no RLS policies);
// this route is the only public write path into the enrollment tables and
// re-checks what the page enforced client-side: registration still open,
// class not full. A full class returns 409 so the page flips to the
// waitlist flow.

type Slot = { payment_status: string; waitlist_offer_expires_at: string | null }

function spotsTakenRaw(slots: Slot[]): number {
  const now = Date.now()
  return slots.filter(
    (e) =>
      e.payment_status === 'Pending' ||
      e.payment_status === 'Paid' ||
      (e.payment_status === 'Waitlisted' &&
        e.waitlist_offer_expires_at != null &&
        new Date(e.waitlist_offer_expires_at).getTime() > now)
  ).length
}

export async function POST(request: Request) {
  let body: Record<string, string | null>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const classId = (body.classId ?? '').trim()
  const parentFirst = (body.parentFirst ?? '').trim()
  const parentLast = (body.parentLast ?? '').trim()
  const parentEmail = (body.parentEmail ?? '').trim().toLowerCase()
  const studentFirst = (body.studentFirst ?? '').trim()
  const studentLast = (body.studentLast ?? '').trim()
  const studentEmail = (body.studentEmail ?? '').trim().toLowerCase() || null

  if (!classId || !parentFirst || !parentLast || !parentEmail || !studentFirst || !studentLast) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const { data: cls } = await supabase
    .from('classes')
    .select(
      `id, status, school_id, capacity, registration_close_date, start_date,
       schools ( timezone ),
       sessions ( session_date ),
       enrollments ( payment_status, waitlist_offer_expires_at )`
    )
    .eq('id', classId)
    .single()

  if (!cls) {
    return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  }
  if (cls.status === 'cancelled') {
    return NextResponse.json({ error: 'Registration for this class has closed.' }, { status: 410 })
  }

  const school = Array.isArray(cls.schools) ? cls.schools[0] : cls.schools
  const timezone = (school as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE
  const firstSession =
    [...((cls.sessions as { session_date: string }[]) ?? [])
      .map((s) => s.session_date)]
      .sort()[0] ?? cls.start_date
  const registrationClose = cls.registration_close_date ?? firstSession
  if (localDate(timezone) > registrationClose) {
    return NextResponse.json({ error: 'Registration for this class has closed.' }, { status: 410 })
  }

  if (spotsTakenRaw((cls.enrollments as Slot[]) ?? []) >= cls.capacity) {
    return NextResponse.json({ error: 'This class is full.', full: true }, { status: 409 })
  }

  // 1+2. Family + student: match on parent email and attach to the existing
  // family (PHASE4_SPEC §7 — siblings and returning families share one row;
  // repeat registrations never overwrite the parent's name).
  const result = await upsertFamilyAndStudent({
    parentFirst,
    parentLast,
    parentEmail,
    studentFirst,
    studentLast,
    studentEmail,
    schoolId: cls.school_id ?? null,
    graduatingYear: body.graduatingYear || null,
  })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  // 3. Create the Enrollment in "Pending" state (holds a capacity spot)
  const { data: enrollmentData, error: enrollmentError } = await supabase
    .from('enrollments')
    .insert([
      {
        student_id: result.studentId,
        class_id: cls.id,
        payment_status: 'Pending',
        accommodations: body.accommodations || null,
        previous_scores: body.previousScores || null,
        notes: body.notes || null,
      },
    ])
    .select()
    .single()

  if (enrollmentError || !enrollmentData) {
    return NextResponse.json(
      { error: 'Error enrolling: ' + (enrollmentError?.message ?? 'unknown') },
      { status: 500 }
    )
  }

  return NextResponse.json({ enrollmentId: enrollmentData.id })
}
