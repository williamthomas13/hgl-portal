import { NextResponse, after } from 'next/server'
import type Stripe from 'stripe'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { upsertFamilyAndStudent } from '../../../utils/registration'
import { runEnrollmentCommsPass } from '../../../utils/comms-inline'
import { scanCloseMatches } from '../../../utils/close-match'
import { handleClassCheckoutCompleted } from '../../../utils/checkout-paid'
import {
  classDetailsSnapshot,
  emailContext,
  loadClassBundles,
  localDate,
  registrationCloseFor,
  spotsTaken,
} from '../../../utils/lifecycle'
import { renderEmail } from '../../../utils/comms-db-render'
import { sendOnce, staffPaymentLinkEmail, waitlistConfirmationEmail } from '../../../utils/email'

// PL-361: staff-assisted enrollment — phone signups and families who can't
// register online. Info capture reuses THE one family/student path
// (upsertFamilyAndStudent — names-are-doors, no duplicate rows) and creates
// the same Pending enrollment the online flow creates, so everything
// downstream (payment link → the SAME Stripe checkout + webhook, lifecycle
// emails, min-enrollment counts, baseline stamping) is identical. Payment is
// NEVER card-by-phone into our UI: either a payment link is emailed
// (SR_PAYMENT_LINK, signed resume-checkout machinery) or an offline payment
// (check/bank/comp) is recorded with method + note + who.

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ matches: [] })
  const like = `%${q.replace(/[%_]/g, '')}%`

  // Search parents and students by name/email; return family-shaped matches
  // (names are doors — staff picks an existing door before making a new one).
  const [{ data: fams }, { data: studs }] = await Promise.all([
    supabase
      .from('families')
      .select('id, parent_first_name, parent_last_name, parent_email, students ( id, first_name, last_name, student_email, graduating_year )')
      .or(`parent_first_name.ilike.${like},parent_last_name.ilike.${like},parent_email.ilike.${like}`)
      .limit(8),
    supabase
      .from('students')
      .select('id, first_name, last_name, student_email, graduating_year, families ( id, parent_first_name, parent_last_name, parent_email )')
      .or(`first_name.ilike.${like},last_name.ilike.${like}`)
      .limit(8),
  ])

  const byFamily = new Map<string, any>()
  for (const f of (fams as any[]) ?? []) {
    byFamily.set(f.id, {
      familyId: f.id,
      parentFirst: f.parent_first_name,
      parentLast: f.parent_last_name,
      parentEmail: f.parent_email,
      students: (f.students ?? []).map((s: any) => ({
        id: s.id,
        first: s.first_name,
        last: s.last_name,
        email: s.student_email,
        graduatingYear: s.graduating_year,
      })),
    })
  }
  for (const s of (studs as any[]) ?? []) {
    const fam = Array.isArray(s.families) ? s.families[0] : s.families
    if (!fam) continue
    if (!byFamily.has(fam.id)) {
      byFamily.set(fam.id, {
        familyId: fam.id,
        parentFirst: fam.parent_first_name,
        parentLast: fam.parent_last_name,
        parentEmail: fam.parent_email,
        students: [],
      })
    }
    const entry = byFamily.get(fam.id)
    if (!entry.students.some((x: any) => x.id === s.id)) {
      entry.students.push({
        id: s.id,
        first: s.first_name,
        last: s.last_name,
        email: s.student_email,
        graduatingYear: s.graduating_year,
      })
    }
  }
  return NextResponse.json({ matches: [...byFamily.values()].slice(0, 10) })
}

const PRONOUNS = ['she_her', 'he_him', 'they_them', 'name_only']

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  switch (body?.action) {
    case 'create':
      return create(caller, body)
    case 'send_link':
      return sendLink(caller, body)
    case 'record_offline':
      return recordOffline(caller, body)
    case 'cancel_pending':
      return cancelPending(caller, body)
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
}

async function create(caller: { email: string }, body: any) {
  const classId = String(body.classId ?? '').trim()
  const parentFirst = String(body.parentFirst ?? '').trim()
  const parentLast = String(body.parentLast ?? '').trim()
  const parentEmail = String(body.parentEmail ?? '').trim().toLowerCase()
  const studentFirst = String(body.studentFirst ?? '').trim()
  const studentLast = String(body.studentLast ?? '').trim()
  const studentEmail = String(body.studentEmail ?? '').trim().toLowerCase() || null
  if (!classId || !parentFirst || !parentLast || !parentEmail || !studentFirst || !studentLast) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const [bundle] = await loadClassBundles(classId)
  if (!bundle) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })

  // Real class state, in order of severity. Cancelled: REFUSED, no override.
  if (bundle.status === 'cancelled') {
    return NextResponse.json(
      { error: 'This class is cancelled — registrations can’t be added to it.' },
      { status: 410 }
    )
  }
  // Past deadline: staff may deliberately override, and the override is
  // recorded (who/when) on the enrollment.
  const closesOn = registrationCloseFor(bundle)
  const pastDeadline = localDate(bundle.timezone) > closesOn
  if (pastDeadline && !body.overrideDeadline) {
    return NextResponse.json(
      {
        error: `Registration closed on ${closesOn}.`,
        deadlineClosed: true,
        closedOn: closesOn,
      },
      { status: 409 }
    )
  }
  // Full: offer the waitlist instead (the UI asks; waitlist=true accepts).
  const isFull = spotsTaken(bundle) >= bundle.capacity
  if (isFull && !body.waitlist) {
    return NextResponse.json(
      { error: 'This class is full.', full: true },
      { status: 409 }
    )
  }

  // THE one family/student path — matching parent email attaches to the
  // existing family; an existing student name dedupes to the same row.
  const result = await upsertFamilyAndStudent({
    parentFirst,
    parentLast,
    parentEmail,
    studentFirst,
    studentLast,
    studentEmail,
    schoolId: bundle.schoolId,
    graduatingYear: String(body.graduatingYear ?? '').trim() || null,
    pronouns: PRONOUNS.includes(body.pronouns) ? body.pronouns : null,
  })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  // A student already holding a live enrollment on this class reuses it.
  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, payment_status')
    .eq('student_id', result.studentId)
    .eq('class_id', classId)
    .in('payment_status', ['Pending', 'Paid', 'Completed', 'Waitlisted'])
    .maybeSingle()
  if (existing) {
    return NextResponse.json({
      enrollmentId: existing.id,
      already: true,
      status: existing.payment_status,
    })
  }

  const status = isFull && body.waitlist ? 'Waitlisted' : 'Pending'
  const { data: enrollment, error: enrErr } = await supabase
    .from('enrollments')
    .insert([
      {
        student_id: result.studentId,
        class_id: classId,
        payment_status: status,
        accommodations: String(body.accommodations ?? '').trim() || null,
        previous_scores: String(body.previousScores ?? '').trim() || null,
        notes: String(body.notes ?? '').trim() || null,
        source: 'staff',
        source_recorded_by: caller.email.toLowerCase(),
        ...(pastDeadline
          ? {
              deadline_override_by: caller.email.toLowerCase(),
              deadline_override_at: new Date().toISOString(),
            }
          : {}),
      },
    ])
    .select('id, enrolled_at')
    .single()
  if (enrErr || !enrollment) {
    return NextResponse.json({ error: enrErr?.message ?? 'Could not create the registration.' }, { status: 500 })
  }

  // PL-314 baseline: what the family was told at THIS registration — the
  // class schedule as it stands right now (the standing schedule-change rule).
  const snap = classDetailsSnapshot(bundle)
  await supabase
    .from('enrollments')
    .update({
      schedule_snapshot: {
        origin: 'registration',
        first_session: snap.first_session,
        location: snap.location,
        sessions: snap.sessions,
        seq: 0,
      },
    })
    .eq('id', enrollment.id)
    .is('schedule_snapshot', null)

  if (status === 'Waitlisted') {
    // Mirror the online waitlist join: W1 confirmation with the position.
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
      const { subject, html, versionId } = await renderEmail(
        'W1_WAITLIST',
        ctx,
        'parent',
        { waitlistPosition: position },
        () => waitlistConfirmationEmail(ctx, position)
      )
      await sendOnce({
        dedupeKey: `waitlist_confirmation:${enrollment.id}`,
        emailType: 'waitlist_confirmation',
        enrollmentId: enrollment.id,
        classId,
        to: [ctx.parentEmail],
        subject,
        html,
        bodySnapshotId: versionId,
        senderEmail: caller.email,
      })
    }
    return NextResponse.json({ enrollmentId: enrollment.id, waitlisted: true, position })
  }

  // Same behind-the-response passes as the online registration route.
  after(() =>
    scanCloseMatches({ studentId: result.studentId, enrollmentId: enrollment.id }).catch((e) =>
      console.error('close-match scan failed (registration stands):', e)
    )
  )
  after(() =>
    runEnrollmentCommsPass(enrollment.id).catch((e) =>
      console.error('inline comms pass failed (cron will catch up):', e)
    )
  )

  return NextResponse.json({ enrollmentId: enrollment.id })
}

async function sendLink(caller: { email: string }, body: any) {
  const enrollmentId = String(body.enrollmentId ?? '').trim()
  if (!enrollmentId) return NextResponse.json({ error: 'Missing enrollmentId.' }, { status: 400 })
  const bundles = await loadClassBundles()
  const bundle = bundles.find((b) => b.enrollments.some((e) => e.id === enrollmentId))
  const enrollment = bundle?.enrollments.find((e) => e.id === enrollmentId)
  if (!bundle || !enrollment) return NextResponse.json({ error: 'Registration not found.' }, { status: 404 })
  if (enrollment.payment_status !== 'Pending') {
    return NextResponse.json(
      { error: `This registration is ${enrollment.payment_status} — a payment link only applies while it's Pending.` },
      { status: 409 }
    )
  }
  const ctx = emailContext(bundle, enrollment)
  const { subject, html, versionId } = await renderEmail(
    'SR_PAYMENT_LINK',
    ctx,
    'parent',
    {},
    () => staffPaymentLinkEmail(ctx)
  )
  const status = await sendOnce({
    // Resends are deliberate (staff clicked again) — key by day+minute so a
    // double-click can't double-send but tomorrow's resend goes out.
    dedupeKey: `staff_payment_link:${enrollmentId}:${new Date().toISOString().slice(0, 16)}`,
    emailType: 'staff_payment_link',
    templateKey: 'SR_PAYMENT_LINK',
    enrollmentId,
    classId: bundle.id,
    recipientRole: 'parent',
    to: [ctx.parentEmail],
    subject,
    html,
    bodySnapshotId: versionId,
    senderEmail: caller.email,
  })
  if (status === 'failed') {
    return NextResponse.json({ error: 'The email could not be sent — try again in a minute.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, status, to: ctx.parentEmail })
}

async function recordOffline(caller: { email: string }, body: any) {
  const enrollmentId = String(body.enrollmentId ?? '').trim()
  const method = String(body.method ?? '')
  const note = String(body.note ?? '').trim()
  if (!enrollmentId) return NextResponse.json({ error: 'Missing enrollmentId.' }, { status: 400 })
  if (!['check', 'bank', 'comp'].includes(method)) {
    return NextResponse.json({ error: 'Payment method must be check, bank, or comp.' }, { status: 400 })
  }
  if (method === 'comp' && !note) {
    return NextResponse.json({ error: 'A comp needs its reason recorded.' }, { status: 400 })
  }

  const { data: enr } = await supabase
    .from('enrollments')
    .select('id, payment_status, class_id, classes ( price ), students ( families ( parent_email ) )')
    .eq('id', enrollmentId)
    .maybeSingle()
  if (!enr) return NextResponse.json({ error: 'Registration not found.' }, { status: 404 })
  if (!['Pending', 'Expired', 'Waitlisted'].includes(enr.payment_status)) {
    return NextResponse.json(
      { error: `This registration is ${enr.payment_status} — nothing to record.` },
      { status: 409 }
    )
  }
  const cls: any = Array.isArray(enr.classes) ? enr.classes[0] : enr.classes
  const student: any = Array.isArray(enr.students) ? enr.students[0] : enr.students
  const family: any = student ? (Array.isArray(student.families) ? student.families[0] : student.families) : null
  const amount =
    method === 'comp' ? 0 : body.amount != null && Number(body.amount) >= 0 ? Number(body.amount) : Number(cls?.price ?? 0)

  // The receipt authority (PL-142) must say what was actually received.
  await supabase
    .from('enrollments')
    .update({
      class_price_snapshot: amount,
      pending_addon_price: null,
      offline_payment_method: method,
      offline_payment_note: note || null,
      offline_recorded_by: caller.email.toLowerCase(),
      offline_recorded_at: new Date().toISOString(),
    })
    .eq('id', enrollmentId)

  // Run the IDENTICAL paid-webhook consequences (confirmation + lifecycle
  // emails, sequence scheduling, QBO, milestone pings) via the same handler
  // the webhook and attach-payment use — with a synthetic offline session.
  // The synthetic payment-intent ref keeps the QBO sale pipeline intact
  // (deterministic DocNumber, honest "offline payment" private note); a comp
  // is $0 and carries no ref, so no QBO receipt is created for it.
  const ref = `offline_${method}_${enrollmentId.replace(/-/g, '').slice(0, 20)}`
  const session = {
    id: ref,
    payment_status: 'paid',
    amount_total: Math.round(amount * 100),
    payment_intent: method === 'comp' ? null : ref,
    customer_details: { email: family?.parent_email ?? null },
    metadata: { enrollment_id: enrollmentId, class_id: enr.class_id },
  } as unknown as Stripe.Checkout.Session

  const deferred: (() => Promise<unknown>)[] = []
  const result = await handleClassCheckoutCompleted(session, {
    overrideEnrollmentId: enrollmentId,
    alertOnMismatch: false,
    defer: (fn) => deferred.push(fn),
  })
  for (const fn of deferred) {
    await fn().catch((e) => console.error('offline-payment deferred step failed (cron converges):', e))
  }
  if (result.outcome === 'mismatch') {
    return NextResponse.json({ error: result.problem ?? 'Recording failed.' }, { status: 500 })
  }

  // By-hand badge on the confirmations this produced (PL-83).
  await supabase
    .from('email_sends')
    .update({ sender_email: caller.email })
    .eq('enrollment_id', enrollmentId)
    .in('dedupe_key', [`parent_confirmation:${enrollmentId}`, `student_confirmation:${enrollmentId}`])

  return NextResponse.json({ ok: true, outcome: result.outcome, amount, method })
}

async function cancelPending(caller: { email: string }, body: any) {
  const enrollmentId = String(body.enrollmentId ?? '').trim()
  if (!enrollmentId) return NextResponse.json({ error: 'Missing enrollmentId.' }, { status: 400 })
  const { data: enr } = await supabase
    .from('enrollments')
    .select('id, payment_status, source')
    .eq('id', enrollmentId)
    .maybeSingle()
  if (!enr) return NextResponse.json({ error: 'Registration not found.' }, { status: 404 })
  if (enr.payment_status !== 'Pending') {
    return NextResponse.json(
      { error: `This registration is ${enr.payment_status} — only a Pending one can be cancelled here.` },
      { status: 409 }
    )
  }
  // Same end-state the abandonment sweep uses — the seat frees, and the
  // family can register normally any time.
  const { error } = await supabase
    .from('enrollments')
    .update({ payment_status: 'Expired' })
    .eq('id', enrollmentId)
    .eq('payment_status', 'Pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  console.log(`[PL-361] staff cancel of pending enrollment ${enrollmentId} by ${caller.email}`)
  return NextResponse.json({ ok: true })
}
