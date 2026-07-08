import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from "../../utils/supabase-admin"
import { registrationAlertContent, sendAdminAlert, sendOnce, waitlistConfirmationEmail } from '../../utils/email'
import {
  emailContext,
  loadClassBundles,
  localDate,
  registrationCloseFor,
  spotsTaken,
  INTERNAL_EMAIL,
} from '../../utils/lifecycle'
import { upsertFamilyAndStudent } from '../../utils/registration'

// Join the waitlist for a full class: creates the family/student/enrollment
// (status Waitlisted, no payment) and sends an instant confirmation with the
// family's position in line. FCFS ordering comes from enrolled_at.

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
      graduatingYear,
      accommodations,
      previousScores,
      notes,
    } = body as Record<string, string | null>

    if (!classId || !parentFirst || !parentLast || !parentEmail || !studentFirst || !studentLast) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }

    const [bundle] = await loadClassBundles(classId)
    if (!bundle) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
    }
    if (bundle.status === 'cancelled') {
      return NextResponse.json({ error: 'Registration for this class has closed.' }, { status: 410 })
    }
    if (localDate(bundle.timezone) > registrationCloseFor(bundle)) {
      return NextResponse.json({ error: 'Registration for this class has closed.' }, { status: 410 })
    }
    if (spotsTaken(bundle) < bundle.capacity) {
      return NextResponse.json(
        { error: 'This class has open spots — register normally instead.' },
        { status: 409 }
      )
    }

    const email = parentEmail.trim().toLowerCase()

    // Match on parent email and attach to the existing family (PHASE4_SPEC §7).
    const result = await upsertFamilyAndStudent({
      parentFirst,
      parentLast,
      parentEmail: email,
      studentFirst,
      studentLast,
      studentEmail: studentEmail ? studentEmail.trim().toLowerCase() : null,
      schoolId: bundle.schoolId,
      graduatingYear: graduatingYear || null,
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    const { data: enrollment, error: enrErr } = await supabase
      .from('enrollments')
      .insert([
        {
          student_id: result.studentId,
          class_id: classId,
          payment_status: 'Waitlisted',
          accommodations: accommodations || null,
          previous_scores: previousScores || null,
          notes: notes || null,
        },
      ])
      .select()
      .single()
    if (enrErr || !enrollment) {
      return NextResponse.json({ error: enrErr?.message ?? 'Could not join waitlist.' }, { status: 500 })
    }

    // Instant internal heads-up to info@ (July 8 punch list) — counts from
    // the pre-insert bundle, plus this fresh Waitlisted row.
    {
      const { subject, body } = registrationAlertContent({
        studentName: `${studentFirst} ${studentLast}`,
        parentName: `${parentFirst} ${parentLast}`,
        parentEmail: email,
        label: `${bundle.schoolLabel} ${bundle.classType}`,
        status: 'Waitlisted',
        paid: bundle.enrollments.filter(
          (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
        ).length,
        pending: bundle.enrollments.filter((e) => e.payment_status === 'Pending').length,
        waitlisted:
          bundle.enrollments.filter((e) => e.payment_status === 'Waitlisted').length + 1,
        minEnrollment: bundle.minEnrollment,
        capacity: bundle.capacity,
      })
      await sendAdminAlert({
        dedupeKey: `internal_reg:${enrollment.id}`,
        adminEmail: INTERNAL_EMAIL,
        subject,
        body,
        enrollmentId: enrollment.id,
      })
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
        to: [ctx.parentEmail], // W1 is parent-only per the deck
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
