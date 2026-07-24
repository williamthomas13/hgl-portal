import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { localDate, DEFAULT_TIMEZONE } from '../../utils/lifecycle'
import { upsertFamilyAndStudent } from '../../utils/registration'
import { runEnrollmentCommsPass } from '../../utils/comms-inline'

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

  const classId = (String(body.classId ?? '')).trim()
  const parentFirst = (String(body.parentFirst ?? '')).trim()
  const parentLast = (String(body.parentLast ?? '')).trim()
  const parentEmail = (String(body.parentEmail ?? '')).trim().toLowerCase()

  // PL-125: sibling registration — the page may send `students: [...]`
  // (one entry per child, parent block shared). The legacy single-student
  // body keeps working unchanged: it normalizes to a one-element list.
  type StudentInput = {
    first: string
    last: string
    email: string | null
    pronouns: string | null
    graduatingYear: string | null
    accommodations: string | null
    previousScores: string | null
    notes: string | null
  }
  const rawStudents: Record<string, unknown>[] = Array.isArray(body.students)
    ? (body.students as Record<string, unknown>[])
    : [
        {
          studentFirst: body.studentFirst,
          studentLast: body.studentLast,
          studentEmail: body.studentEmail,
          pronouns: body.pronouns,
          graduatingYear: body.graduatingYear,
          accommodations: body.accommodations,
          previousScores: body.previousScores,
          notes: body.notes,
        },
      ]
  const students: StudentInput[] = rawStudents.map((s) => ({
    first: String(s.studentFirst ?? '').trim(),
    last: String(s.studentLast ?? '').trim(),
    email: (String(s.studentEmail ?? '').trim().toLowerCase() || null) as string | null,
    pronouns: (s.pronouns as string) || null,
    graduatingYear: (s.graduatingYear as string) || null,
    accommodations: (s.accommodations as string) || null,
    previousScores: (s.previousScores as string) || null,
    notes: (s.notes as string) || null,
  }))

  if (
    !classId ||
    !parentFirst ||
    !parentLast ||
    !parentEmail ||
    students.length === 0 ||
    students.length > 6 ||
    students.some((s) => !s.first || !s.last)
  ) {
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

  // PL-125: the capacity check counts EVERY sibling in this submission —
  // two children must not squeeze through a one-seat gap on the read.
  const seatsFree = cls.capacity - spotsTakenRaw((cls.enrollments as Slot[]) ?? [])
  if (seatsFree < students.length) {
    return NextResponse.json(
      {
        error:
          seatsFree <= 0
            ? 'This class is full.'
            : `Only ${seatsFree} spot${seatsFree === 1 ? '' : 's'} left — not enough for ${students.length} students. You can register ${seatsFree} now and waitlist the other${students.length - seatsFree === 1 ? '' : 's'}.`,
        full: seatsFree <= 0,
        seatsFree,
      },
      { status: 409 }
    )
  }

  // 1+2. Family + students: match on parent email and attach every child to
  // the SAME family row (PHASE4_SPEC §7 — repeat registrations never
  // overwrite the parent's name). One upsert per student: different names
  // create siblings; the same student typed twice dedupes to one row.
  const PRONOUNS = ['she_her', 'he_him', 'they_them', 'name_only']
  const resolved: { studentId: string; input: StudentInput }[] = []
  for (const s of students) {
    const result = await upsertFamilyAndStudent({
      parentFirst,
      parentLast,
      parentEmail,
      studentFirst: s.first,
      studentLast: s.last,
      studentEmail: s.email,
      schoolId: cls.school_id ?? null,
      graduatingYear: s.graduatingYear,
      // PL-69: optional; anything unrecognized is treated as unset.
      pronouns: PRONOUNS.includes(s.pronouns as string) ? s.pronouns : null,
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    // Same student entered twice in one submission → one enrollment.
    if (!resolved.some((r) => r.studentId === result.studentId)) {
      resolved.push({ studentId: result.studentId, input: s })
    }
  }

  // 3. Create the Pending enrollments (each holds a capacity spot). A
  // student already holding a live enrollment on this class reuses it
  // (typed twice across two visits must not double-book the seat).
  const enrollmentIds: string[] = []
  const createdIds: string[] = []
  for (const r of resolved) {
    const { data: existing } = await supabase
      .from('enrollments')
      .select('id, payment_status')
      .eq('student_id', r.studentId)
      .eq('class_id', cls.id)
      .in('payment_status', ['Pending', 'Paid', 'Completed'])
      .maybeSingle()
    if (existing) {
      enrollmentIds.push(existing.id)
      continue
    }
    const { data: enrollmentData, error: enrollmentError } = await supabase
      .from('enrollments')
      .insert([
        {
          student_id: r.studentId,
          class_id: cls.id,
          payment_status: 'Pending',
          accommodations: r.input.accommodations,
          previous_scores: r.input.previousScores,
          notes: r.input.notes,
        },
      ])
      .select('id')
      .single()
    if (enrollmentError || !enrollmentData) {
      return NextResponse.json(
        { error: 'Error enrolling: ' + (enrollmentError?.message ?? 'unknown') },
        { status: 500 }
      )
    }
    enrollmentIds.push(enrollmentData.id)
    createdIds.push(enrollmentData.id)
  }

  // PL-125 oversell recount: our read-then-insert can race another family.
  // Re-count AFTER inserting — if the class is now over capacity, roll back
  // the rows THIS request created and refuse. Both racers recount after both
  // inserted, so at least one backs off; seats never oversell.
  if (createdIds.length > 0) {
    const { data: after_ } = await supabase
      .from('enrollments')
      .select('payment_status, waitlist_offer_expires_at')
      .eq('class_id', cls.id)
    if (spotsTakenRaw((after_ as Slot[]) ?? []) > cls.capacity) {
      await supabase.from('enrollments').delete().in('id', createdIds)
      return NextResponse.json({ error: 'This class just filled up.', full: true }, { status: 409 })
    }
  }

  // PL-51: materialize each enrollment's PR rows immediately (and send
  // anything already due) behind the response — the daily cron remains the
  // batch backstop. Explicit catch: never a floating promise (7c rule).
  for (const id of createdIds) {
    after(() =>
      runEnrollmentCommsPass(id).catch((e) =>
        console.error('inline comms pass failed (cron will catch up):', e)
      )
    )
  }

  // The admin registration notification fires from the Stripe webhook once
  // an enrollment is PAID — creation alone is silent (July 8 punch list).
  // Legacy single callers read enrollmentId; the sibling page reads the list.
  return NextResponse.json({ enrollmentId: enrollmentIds[0], enrollmentIds })
}
