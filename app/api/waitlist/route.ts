import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { recipients, sendOnce, waitlistConfirmationEmail } from '../../utils/email'
import { emailContext, loadClassBundles, spotsTaken } from '../../utils/lifecycle'

// Join the waitlist for a full class: creates the family/student/enrollment
// (status Waitlisted, no payment) and sends an instant confirmation with the
// family's position in line. FCFS ordering comes from enrolled_at.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      classId,
      parentFirst,
      parentLast,
      parentEmail,
      studentFirst,
      studentLast,
      studentEmail,
      studentGrade,
    } = body as Record<string, string | null>

    if (!classId || !parentFirst || !parentLast || !parentEmail || !studentFirst || !studentLast) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    const [bundle] = await loadClassBundles(classId)
    if (!bundle) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
    }
    if (spotsTaken(bundle) < bundle.capacity) {
      return NextResponse.json(
        { error: 'This class has open spots — register normally instead.' },
        { status: 409 }
      )
    }

    const email = parentEmail.trim().toLowerCase()

    const { data: family, error: famErr } = await supabase
      .from('families')
      .upsert(
        [{ parent_first_name: parentFirst, parent_last_name: parentLast, parent_email: email }],
        { onConflict: 'parent_email' }
      )
      .select()
      .single()
    if (famErr || !family) {
      return NextResponse.json({ error: famErr?.message ?? 'Could not save family.' }, { status: 500 })
    }

    const { data: student, error: stuErr } = await supabase
      .from('students')
      .insert([
        {
          family_id: family.id,
          first_name: studentFirst,
          last_name: studentLast,
          student_email: studentEmail ? studentEmail.trim().toLowerCase() : null,
          school_id: bundle.schoolId,
          grade_level: studentGrade || null,
        },
      ])
      .select()
      .single()
    if (stuErr || !student) {
      return NextResponse.json({ error: stuErr?.message ?? 'Could not save student.' }, { status: 500 })
    }

    const { data: enrollment, error: enrErr } = await supabase
      .from('enrollments')
      .insert([{ student_id: student.id, class_id: classId, payment_status: 'Waitlisted' }])
      .select()
      .single()
    if (enrErr || !enrollment) {
      return NextResponse.json({ error: enrErr?.message ?? 'Could not join waitlist.' }, { status: 500 })
    }

    // Position = how many waitlisted joined at or before us.
    const { count } = await supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('payment_status', 'Waitlisted')
      .lte('enrolled_at', enrollment.enrolled_at)
    const position = count ?? 1

    const [fresh] = await loadClassBundles(classId)
    const row = fresh?.enrollments.find((e) => e.id === enrollment.id)
    if (fresh && row) {
      const ctx = emailContext(fresh, row)
      const { subject, html } = waitlistConfirmationEmail(ctx, position)
      await sendOnce({
        dedupeKey: `waitlist_confirmation:${enrollment.id}`,
        emailType: 'waitlist_confirmation',
        enrollmentId: enrollment.id,
        to: recipients(ctx),
        subject,
        html,
      })
    }

    return NextResponse.json({ position })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown waitlist error'
    console.error('Waitlist join error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
