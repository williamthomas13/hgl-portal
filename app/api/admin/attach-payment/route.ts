import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { handleClassCheckoutCompleted } from '../../../utils/checkout-paid'
import { sendAdminAlert } from '../../../utils/email'
import { ADMIN_EMAIL } from '../../../utils/lifecycle'
import { emailBaseUrl } from '../../../utils/base-url'
import { staffLabel, staffNameMap } from '../../../utils/staff-names'

// PL-92: the missing mechanism behind the webhook-mismatch alert's promise —
// "Attach this payment to enrollment X" runs the normal paid-webhook
// consequences end-to-end (confirmation/LR emails, registration
// notification, sequence scheduling + PR cancellation via the comms pass,
// QBO sync, milestone pings) by calling the SAME extracted handler the
// webhook uses, with the enrollment match supplied by the Ops Director.
// Idempotent (everything inside is dedupe-keyed); the confirmation emails it
// triggers are stamped sender_email so the family timeline badges the
// attach as by-hand.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('session')
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase()
  if (!sessionId) return NextResponse.json({ error: 'Missing session.' }, { status: 400 })

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (e) {
    return NextResponse.json(
      { error: `Stripe session not found: ${e instanceof Error ? e.message : String(e)}` },
      { status: 404 }
    )
  }

  // Candidates: enrollments whose family/student addresses match the payer
  // (pre-filter), else the most recent unpaid enrollments as the fallback
  // list the Ops Director can pick from.
  const payerEmail = (session.customer_details?.email ?? email ?? '').toLowerCase()
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(
      `id, payment_status, enrolled_at, stripe_session_id,
       students ( first_name, last_name, student_email,
         families ( parent_email, billing_email ) ),
       classes ( class_type, schools ( nickname ) )`
    )
    .order('enrolled_at', { ascending: false })
    .limit(200)
  const rows = ((enrollments as any[]) ?? []).map((e) => {
    const student = Array.isArray(e.students) ? e.students[0] : e.students
    const family = student ? (Array.isArray(student.families) ? student.families[0] : student.families) : null
    const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes
    const school = cls ? (Array.isArray(cls.schools) ? cls.schools[0] : cls.schools) : null
    return {
      id: e.id,
      status: e.payment_status,
      enrolledAt: e.enrolled_at,
      alreadyThisSession: e.stripe_session_id === sessionId,
      student: student ? `${student.first_name} ${student.last_name}` : '—',
      classLabel: cls ? `${school?.nickname ?? 'HGL'} ${cls.class_type}` : '—',
      emails: [family?.parent_email, family?.billing_email, student?.student_email]
        .filter(Boolean)
        .map((x: string) => x.toLowerCase()),
    }
  })
  const matching = payerEmail ? rows.filter((r) => r.emails.includes(payerEmail)) : []
  const unpaid = rows.filter((r) => ['Pending', 'Expired', 'Waitlisted'].includes(r.status)).slice(0, 25)

  return NextResponse.json({
    session: {
      id: session.id,
      paid: session.payment_status === 'paid',
      amount: session.amount_total != null ? session.amount_total / 100 : null,
      payerEmail: session.customer_details?.email ?? null,
      payerName: session.customer_details?.name ?? null,
      created: session.created ? new Date(session.created * 1000).toISOString() : null,
    },
    matching,
    unpaid,
  })
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  let body: { sessionId?: string; enrollmentId?: string; overrideEmailMismatch?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.sessionId || !body.enrollmentId) {
    return NextResponse.json({ error: 'Need sessionId and enrollmentId.' }, { status: 400 })
  }

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(body.sessionId)
  } catch (e) {
    return NextResponse.json(
      { error: `Stripe session not found: ${e instanceof Error ? e.message : String(e)}` },
      { status: 404 }
    )
  }
  if (session.payment_status !== 'paid') {
    return NextResponse.json({ error: 'This checkout session is not paid — nothing to attach.' }, { status: 400 })
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select(
      `id, payment_status, stripe_session_id,
       students ( first_name, last_name, student_email,
         families ( parent_email, billing_email ) )`
    )
    .eq('id', body.enrollmentId)
    .maybeSingle()
  if (!enrollment) return NextResponse.json({ error: 'Enrollment not found.' }, { status: 404 })

  // PL-150: attaching a payment marks an enrollment PAID and fires the whole
  // confirmation cascade. The payer's email used to be a sort order only —
  // any staff member could bind any Stripe session to any recent unpaid
  // enrollment, and the wrong family would be told they were paid while the
  // real payer kept getting dunned. The addresses must match; an admin can
  // still override deliberately (a grandparent paying, a second address),
  // and that override is logged as the exception it is.
  const student = Array.isArray(enrollment.students) ? enrollment.students[0] : enrollment.students
  const family = student ? (Array.isArray(student.families) ? student.families[0] : student.families) : null
  const enrollmentEmails = [family?.parent_email, family?.billing_email, student?.student_email]
    .filter(Boolean)
    .map((x: string) => x.trim().toLowerCase())
  const payerEmail = (session.customer_details?.email ?? '').trim().toLowerCase()
  const emailsMatch = Boolean(payerEmail) && enrollmentEmails.includes(payerEmail)
  if (!emailsMatch) {
    if (!body.overrideEmailMismatch) {
      return NextResponse.json(
        {
          error: payerEmail
            ? `The payer's email (${payerEmail}) doesn't match this registration (${enrollmentEmails.join(', ') || 'no address on file'}).`
            : "This Stripe session has no payer email, so it can't be matched automatically.",
          emailMismatch: true,
          payerEmail: payerEmail || null,
          enrollmentEmails,
          canOverride: caller.role === 'admin',
        },
        { status: 409 }
      )
    }
    if (caller.role !== 'admin') {
      return NextResponse.json(
        { error: "The emails don't match. Only an admin can attach a payment across addresses." },
        { status: 403 }
      )
    }
    console.warn(
      `[PL-150] EMAIL-MISMATCH ATTACH by ${caller.email}: session ${session.id} (payer ${payerEmail || 'none'}) → enrollment ${enrollment.id} (${enrollmentEmails.join(', ') || 'no address'})`
    )
    // A console line dies with the lambda. The override is a money decision,
    // so it also goes to the Ops Director's inbox where it can be questioned.
    // PL-395: the alert names the person; the console line above keeps the raw email.
    const callerName = staffLabel(await staffNameMap(), caller.email)
    await sendAdminAlert({
      dedupeKey: `attach_override:${session.id}:${enrollment.id}`,
      adminEmail: ADMIN_EMAIL,
      subject: 'A payment was attached across mismatched emails',
      body: `<p><strong>${callerName}</strong> attached a Stripe payment to a registration whose
        email addresses don't match the payer.</p>
        <p>Payer: <strong>${payerEmail || 'none on the session'}</strong><br>
        Registration on file: ${enrollmentEmails.join(', ') || 'no address'}<br>
        Stripe session: <code>${session.id}</code></p>
        <p>This is legitimate when someone else paid (a grandparent, a second address). If it
        wasn't, the registration is now marked paid and the family has been emailed a
        confirmation — <a href="${emailBaseUrl()}/admin?enrollment=${enrollment.id}" style="color:#00AEEE">open the registration</a>.</p>`,
    }).catch((e) => console.error('attach-override alert failed (attach proceeds):', e))
  }
  if (enrollment.payment_status === 'Paid' && enrollment.stripe_session_id === session.id) {
    return NextResponse.json({ ok: true, already: true })
  }
  if (['Paid', 'Completed'].includes(enrollment.payment_status)) {
    return NextResponse.json(
      { error: 'This enrollment is already paid by a different payment — pick another, or resolve in Stripe.' },
      { status: 409 }
    )
  }

  // Run the identical webhook path, awaiting the deferred work here (the
  // attach response should mean "everything ran").
  const startedAt = new Date().toISOString()
  const deferred: (() => Promise<unknown>)[] = []
  const result = await handleClassCheckoutCompleted(session, {
    overrideEnrollmentId: enrollment.id,
    alertOnMismatch: false,
    defer: (fn) => deferred.push(fn),
  })
  for (const fn of deferred) {
    await fn().catch((e) => console.error('attach deferred step failed (cron converges):', e))
  }
  if (result.outcome === 'mismatch') {
    return NextResponse.json({ error: result.problem ?? 'Attach failed.' }, { status: 500 })
  }

  // By-hand badge (PL-83): a human matched this payment — stamp the
  // confirmation/LR sends this attach produced.
  await supabase
    .from('email_sends')
    .update({ sender_email: caller.email })
    .eq('enrollment_id', enrollment.id)
    .in('dedupe_key', [
      `parent_confirmation:${enrollment.id}`,
      `student_confirmation:${enrollment.id}`,
    ])
    .gte('sent_at', startedAt)

  return NextResponse.json({ ok: true, outcome: result.outcome, enrollmentId: enrollment.id })
}
