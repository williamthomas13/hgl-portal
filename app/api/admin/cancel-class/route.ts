import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { createSupabaseServerClient } from '../../../utils/supabase-server'
import {
  cancellationCounselorEmail,
  classCancellationEmail,
  sendOnce,
  waitlistCancellationEmail,
  type Audience,
  type CancellationOffer,
} from '../../../utils/email'
import { emailContext, loadClassBundles } from '../../../utils/lifecycle'

// Class cancellation (PHASE4_SPEC §12). Staff-authenticated; mutations run on
// the service role so everything moves together. Suppression is atomic by
// construction: `classes.status = 'cancelled'` is written FIRST with an
// optimistic guard, and every scheduled send derives from that status — the
// sweep skips cancelled classes entirely, so once the flip lands nothing
// class-related can send. The emails after the flip are all idempotent
// (sendOnce dedupe keys), so if this route dies halfway, re-confirming
// finishes the job without double-sending.

export async function POST(request: Request) {
  // Staff gate: cookie session + role check (same rule as /admin).
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { data: profile } = await session
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && profile?.role !== 'manager') {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  let body: { classId?: string; offerHours?: number | null; creditTerm?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const classId = (body.classId ?? '').trim()
  const offerHours =
    typeof body.offerHours === 'number' && body.offerHours > 0
      ? Math.round(body.offerHours)
      : null
  const creditTerm = (body.creditTerm ?? '').trim() || null
  if (!classId) return NextResponse.json({ error: 'Missing classId.' }, { status: 400 })

  const [bundle] = await loadClassBundles(classId)
  if (!bundle) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })

  // The offer math: hours × the regular 1-on-1 rate vs what the family paid.
  let regularRate = 0
  if (offerHours) {
    const { data: pkg } = await supabase
      .from('tutoring_packages')
      .select('regular_hourly_rate')
      .eq('active', true)
      .order('hours')
      .limit(1)
      .maybeSingle()
    regularRate = Number(pkg?.regular_hourly_rate ?? 0)
    if (!regularRate) {
      return NextResponse.json(
        { error: 'No active tutoring package found to compute the offer math.' },
        { status: 400 }
      )
    }
  }

  // 1. THE GATE: flip status first. Guarded on 'open' so a double-click or a
  // concurrent admin can't run the flow twice.
  const { data: flipped } = await supabase
    .from('classes')
    .update({ status: 'cancelled' })
    .eq('id', classId)
    .eq('status', 'open')
    .select('id')
  const alreadyCancelled = !flipped || flipped.length === 0
  if (alreadyCancelled && bundle.status !== 'cancelled') {
    return NextResponse.json({ error: 'Class is not open.' }, { status: 409 })
  }

  // Snapshot the recipient sets from the pre-flip bundle. (On a re-run after
  // a partial failure the statuses have already moved — reload and use flags.)
  const paid = bundle.enrollments.filter(
    (e) => e.payment_status === 'Paid' || (alreadyCancelled && e.payment_status === 'Completed')
  )
  const pending = bundle.enrollments.filter((e) => e.payment_status === 'Pending')
  const waitlisted = bundle.enrollments.filter((e) => e.payment_status === 'Waitlisted')

  // 2. Unpaid holds die immediately: their PR sequence just stops (no email).
  // Waitlisted rows are released the same way; they get the CX-W note below.
  const toExpire = [...pending, ...waitlisted].map((e) => e.id)
  if (toExpire.length > 0) {
    await supabase
      .from('enrollments')
      .update({ payment_status: 'Expired' })
      .in('id', toExpire)
      .in('payment_status', ['Pending', 'Waitlisted'])
  }

  // 3. Paid enrollments keep their status but carry the flag (refunds stay
  // manual in Stripe; the outcome field records the family's choice later).
  if (paid.length > 0) {
    await supabase
      .from('enrollments')
      .update({ class_cancelled: true })
      .in('id', paid.map((e) => e.id))
  }

  // 4. A pending classroom request is moot now.
  await supabase
    .from('classroom_requests')
    .update({ status: 'cancelled' })
    .eq('class_id', classId)
    .eq('status', 'pending')

  // 5. CX to both audiences of every Paid enrollment (from billy@). The
  // offer math uses classes.price ONLY (the cancelled product is the group
  // class — add-on purchases survive in every outcome, including refund), so
  // it's identical for all families; only the CX variant differs (add-on
  // families get combined-total wording + keep-your-hours, from ctx.addons).
  const offer: CancellationOffer | null = offerHours
    ? {
        hours: offerHours,
        price: bundle.price,
        savingsPct: Math.round(
          ((offerHours * regularRate - bundle.price) / (offerHours * regularRate)) * 100
        ),
        savingsUsd: Math.round(offerHours * regularRate - bundle.price),
      }
    : null
  let cxSent = 0
  for (const e of paid) {
    const ctx = emailContext(bundle, e)
    const targets: { audience: Audience; to: string; tag: string }[] = [
      { audience: 'parent', to: ctx.parentEmail, tag: 'p' },
    ]
    if (ctx.studentEmail) targets.push({ audience: 'student', to: ctx.studentEmail, tag: 's' })
    for (const t of targets) {
      const { subject, html, from } = classCancellationEmail(ctx, t.audience, offer, creditTerm)
      const status = await sendOnce({
        dedupeKey: `class_cancelled_${t.tag}:${e.id}`,
        emailType: 'class_cancelled',
        enrollmentId: e.id,
        to: [t.to],
        from,
        subject,
        html,
      })
      if (status === 'sent') cxSent++
    }
  }

  // 6. CX-W to waitlisted families (parent-only, info@).
  let cxwSent = 0
  for (const e of waitlisted) {
    const ctx = emailContext(bundle, e)
    const { subject, html } = waitlistCancellationEmail(ctx)
    const status = await sendOnce({
      dedupeKey: `cancel_waitlist:${e.id}`,
      emailType: 'cancel_waitlist',
      enrollmentId: e.id,
      to: [ctx.parentEmail],
      subject,
      html,
    })
    if (status === 'sent') cxwSent++
  }

  // 7. CX-C to the school contacts.
  let cxcSent = 0
  if (bundle.schoolId) {
    const { data: counselors } = await supabase
      .from('school_counselors')
      .select('id, first_name, email')
      .eq('school_id', bundle.schoolId)
    for (const counselor of counselors ?? []) {
      const { subject, html } = cancellationCounselorEmail({
        counselorFirst: counselor.first_name,
        label: `${bundle.schoolLabel} ${bundle.classType}`,
        firstSession: bundle.firstSession,
      })
      const status = await sendOnce({
        dedupeKey: `cancel_counselor:${classId}:${counselor.id}`,
        emailType: 'cancel_counselor',
        to: [counselor.email],
        subject,
        html,
      })
      if (status === 'sent') cxcSent++
    }
  }

  return NextResponse.json({
    ok: true,
    paidNotified: paid.length,
    expired: toExpire.length,
    emails: { cx: cxSent, cxw: cxwSent, cxc: cxcSent },
  })
}
