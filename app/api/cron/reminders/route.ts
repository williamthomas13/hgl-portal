import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import {
  classDetailsEmail,
  faqEmail,
  locationReminderEmail,
  paymentReminderEmail,
  recipients,
  reviewRequestEmail,
  scheduleUpdateEmail,
  secondDiagnosticEmail,
  sendAdminAlert,
  sendOnce,
  synapAccessEmail,
  tutoringOfferEmail,
  tutoringUpsellEmail,
  waitlistOfferEmail,
  type EnrollmentEmailContext,
} from '../../../utils/email'
import {
  ADMIN_EMAIL,
  DEFAULT_TIMEZONE,
  PAYMENT_EXPIRY_HOURS,
  PAYMENT_REMINDERS,
  SEQUENCE,
  WAITLIST_CLAIM_HOURS,
  addDaysISO,
  addonPageUrlFor,
  claimUrlFor,
  classDetailsSnapshot,
  loadTutoringPackages,
  emailContext,
  hoursSince,
  isDue,
  loadClassBundles,
  localDate,
  localHour,
  spotsTaken,
  stepTargetDate,
  type ClassBundle,
  type TutoringPackage,
} from '../../../utils/lifecycle'

// The lifecycle sweep. Runs hourly (Supabase pg_cron; Vercel daily cron as
// backup). Every decision is derived from *current* DB state and every send
// is deduped through email_log, so the sweep is fully idempotent:
// rescheduling a class automatically recomputes all pending sends, and
// re-running never double-sends.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

// Relationship (non-essential) emails — suppressed for opted-out families.
// Everything else is transactional and always sends.
const RELATIONSHIP_TYPES = new Set(['second_diagnostic', 'review_request', 'tutoring_offer'])

const TEMPLATES: Record<
  string,
  (ctx: EnrollmentEmailContext) => { subject: string; html: string; from?: string }
> = {
  synap_access: synapAccessEmail,
  faq: faqEmail,
  class_details: classDetailsEmail,
  location_reminder: locationReminderEmail,
  second_diagnostic: secondDiagnosticEmail,
  review_request: reviewRequestEmail,
  tutoring_offer: tutoringOfferEmail,
}

type Counters = Record<string, number>
function bump(c: Counters, key: string) {
  c[key] = (c[key] ?? 0) + 1
}

// ---------------------------------------------------------------------------
// 1. Payment reminders + expiry (Pending enrollments)
// ---------------------------------------------------------------------------

async function sweepPaymentReminders(bundle: ClassBundle, c: Counters) {
  for (const e of bundle.enrollments) {
    if (e.payment_status !== 'Pending') continue
    const age = hoursSince(e.enrolled_at)

    if (age >= PAYMENT_EXPIRY_HOURS) {
      const { error } = await supabase
        .from('enrollments')
        .update({ payment_status: 'Expired' })
        .eq('id', e.id)
        .eq('payment_status', 'Pending') // guard against a payment racing in
      if (!error) {
        e.payment_status = 'Expired' // keep in-memory state consistent for the waitlist pass
        bump(c, 'expired')
      }
      continue
    }

    const ctx = emailContext(bundle, e)
    for (const r of PAYMENT_REMINDERS) {
      if (age < r.afterHours) break
      const { subject, html } = paymentReminderEmail(ctx, r.n)
      const status = await sendOnce({
        dedupeKey: `payment_reminder_${r.n}:${e.id}`,
        emailType: 'payment_reminder',
        enrollmentId: e.id,
        to: [ctx.parentEmail],
        subject,
        html,
      })
      if (status === 'sent') bump(c, 'payment_reminder')
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Completion: Paid -> Completed the day after the last session
// ---------------------------------------------------------------------------

async function sweepCompletion(bundle: ClassBundle, c: Counters) {
  if (localDate(bundle.timezone) <= bundle.lastSession) return
  for (const e of bundle.enrollments) {
    if (e.payment_status !== 'Paid') continue
    const { error } = await supabase
      .from('enrollments')
      .update({ payment_status: 'Completed' })
      .eq('id', e.id)
      .eq('payment_status', 'Paid')
    if (!error) {
      e.payment_status = 'Completed'
      bump(c, 'completed')
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Post-payment sequence
// ---------------------------------------------------------------------------

async function sweepSequence(
  bundle: ClassBundle,
  c: Counters,
  postPackages: TutoringPackage[]
) {
  // Completed students still get the post-class emails (review, tutoring).
  const paid = bundle.enrollments.filter(
    (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
  )
  if (paid.length === 0) return

  for (const step of SEQUENCE) {
    const target = stepTargetDate(step, bundle)
    if (!isDue(bundle.timezone, target, step.hour)) continue

    // Email #4 hold rule: never send class details with gaps.
    if (step.holdOnBlankDetails && (!bundle.instructorName || !bundle.defaultLocation)) {
      await sendAdminAlert({
        dedupeKey: `hold_alert:${bundle.id}:${localDate(bundle.timezone)}`,
        adminEmail: ADMIN_EMAIL,
        subject: `HOLD: class details email not sent for ${bundle.schoolLabel} — ${bundle.classType}`,
        body: `<p>The "class details" email is due but is being held because
          ${!bundle.instructorName ? '<strong>instructor</strong> ' : ''}
          ${!bundle.instructorName && !bundle.defaultLocation ? 'and ' : ''}
          ${!bundle.defaultLocation ? '<strong>location</strong> ' : ''}
          is blank. Fill it in on the admin page — the email goes out on the next hourly sweep.</p>`,
      })
      bump(c, 'held')
      continue
    }

    for (const e of paid) {
      if (RELATIONSHIP_TYPES.has(step.type) && e.marketingOptOut) continue
      const ctx = emailContext(bundle, e)
      // #8 pulls post-class rates from the packages table.
      const { subject, html, from } =
        step.type === 'tutoring_offer'
          ? tutoringOfferEmail(ctx, postPackages)
          : TEMPLATES[step.type](ctx)
      const status = await sendOnce({
        dedupeKey: `${step.type}:${e.id}`,
        emailType: step.type,
        enrollmentId: e.id,
        to: recipients(ctx),
        from,
        subject,
        html,
        payload: step.type === 'class_details' ? classDetailsSnapshot(bundle) : undefined,
      })
      if (status === 'sent') bump(c, step.type)
    }
  }
}

// ---------------------------------------------------------------------------
// 3b. Email #9 — pre-class tutoring upsell. Parent-only, from billy@,
// ~24h after payment, ONLY when the enrollment has no tutoring add-on and
// the pre-class window (before first session) is still open.
// ---------------------------------------------------------------------------

async function sweepUpsell(bundle: ClassBundle, c: Counters, prePackages: TutoringPackage[]) {
  if (prePackages.length === 0) return
  if (localDate(bundle.timezone) >= bundle.firstSession) return // window closed

  for (const e of bundle.enrollments) {
    if (e.payment_status !== 'Paid') continue
    if (e.marketingOptOut) continue // relationship email
    if (!e.paid_at || hoursSince(e.paid_at) < 24) continue
    if (e.addons.length > 0) continue // they already bought tutoring

    const ctx = emailContext(bundle, e)
    const { subject, html, from } = tutoringUpsellEmail(ctx, prePackages, addonPageUrlFor(e.id))
    const status = await sendOnce({
      dedupeKey: `tutoring_upsell:${e.id}`,
      emailType: 'tutoring_upsell',
      enrollmentId: e.id,
      to: [ctx.parentEmail],
      from,
      subject,
      html,
    })
    if (status === 'sent') bump(c, 'tutoring_upsell')
  }
}

// ---------------------------------------------------------------------------
// 4. Schedule-update detection (after email #4 went out)
// ---------------------------------------------------------------------------

async function sweepScheduleUpdates(bundle: ClassBundle, c: Counters) {
  const enrollmentIds = bundle.enrollments.map((e) => e.id)
  if (enrollmentIds.length === 0) return

  const { data: sentDetails } = await supabase
    .from('email_log')
    .select('enrollment_id, payload')
    .eq('email_type', 'class_details')
    .in('enrollment_id', enrollmentIds)
  if (!sentDetails || sentDetails.length === 0) return

  const current = classDetailsSnapshot(bundle)
  // jsonb does not preserve key order, so compare fields — never stringified objects.
  const stableKey = `${current.first_session}|${current.location ?? ''}|${current.instructor ?? ''}`
  const hash = createHash('md5').update(stableKey).digest('hex').slice(0, 8)

  const stale = sentDetails.filter((row) => {
    const p = row.payload as Partial<typeof current> | null
    if (!p) return false
    return (
      p.first_session !== current.first_session ||
      (p.location ?? null) !== (current.location ?? null) ||
      (p.instructor ?? null) !== (current.instructor ?? null)
    )
  })
  if (stale.length === 0) return

  for (const row of stale) {
    const e = bundle.enrollments.find(
      (en) => en.id === row.enrollment_id && en.payment_status === 'Paid'
    )
    if (!e) continue
    const ctx = emailContext(bundle, e)
    const { subject, html } = scheduleUpdateEmail(ctx)
    const status = await sendOnce({
      dedupeKey: `schedule_update:${e.id}:${hash}`,
      emailType: 'schedule_update',
      enrollmentId: e.id,
      to: recipients(ctx),
      subject,
      html,
    })
    if (status === 'sent') bump(c, 'schedule_update')
  }

  // Refresh the snapshots so the *next* change triggers again.
  await supabase
    .from('email_log')
    .update({ payload: current })
    .eq('email_type', 'class_details')
    .in('enrollment_id', stale.map((r) => r.enrollment_id))
}

// ---------------------------------------------------------------------------
// 5. Waitlist: expire lapsed offers, then extend new ones (FCFS)
// ---------------------------------------------------------------------------

async function sweepWaitlist(bundle: ClassBundle, c: Counters) {
  // No new offers once the class is over; lapsed offers still get rolled.
  const classOver = localDate(bundle.timezone) > bundle.lastSession
  const now = Date.now()
  const waitlisted = bundle.enrollments
    .filter((e) => e.payment_status === 'Waitlisted')
    .sort((a, b) => a.enrolled_at.localeCompare(b.enrolled_at))
  if (waitlisted.length === 0) return

  // Roll lapsed offers to Expired and alert the admin.
  for (const e of waitlisted) {
    if (e.waitlist_offer_expires_at && new Date(e.waitlist_offer_expires_at).getTime() <= now) {
      const { error } = await supabase
        .from('enrollments')
        .update({ payment_status: 'Expired' })
        .eq('id', e.id)
        .eq('payment_status', 'Waitlisted')
      if (!error) {
        e.payment_status = 'Expired'
        bump(c, 'offer_lapsed')
        await sendAdminAlert({
          dedupeKey: `offer_rollover:${e.id}`,
          adminEmail: ADMIN_EMAIL,
          subject: `Waitlist offer expired unclaimed — ${bundle.schoolLabel} — ${bundle.classType}`,
          body: `<p>${e.parentFirstName} (${e.parentEmail}, student ${e.studentFirstName}
            ${e.studentLastName}) did not claim their spot within ${WAITLIST_CLAIM_HOURS} hours.
            The offer rolls to the next family automatically.</p>`,
          enrollmentId: e.id,
        })
      }
    }
  }

  // Extend offers for however many spots are open, in join order.
  if (classOver) return
  let open = bundle.capacity - spotsTaken(bundle)
  for (const e of waitlisted) {
    if (open <= 0) break
    if (e.payment_status !== 'Waitlisted' || e.waitlist_offer_sent_at) continue

    const expiresAt = new Date(now + WAITLIST_CLAIM_HOURS * 3_600_000).toISOString()
    const ctx = emailContext(bundle, e)
    const { subject, html } = waitlistOfferEmail(ctx, claimUrlFor(e.id), expiresAt)
    const status = await sendOnce({
      dedupeKey: `waitlist_offer:${e.id}`,
      emailType: 'waitlist_offer',
      enrollmentId: e.id,
      to: [ctx.parentEmail],
      cc: [ADMIN_EMAIL], // admin CC'd on each offer
      subject,
      html,
    })
    if (status === 'sent') {
      await supabase
        .from('enrollments')
        .update({ waitlist_offer_sent_at: new Date(now).toISOString(), waitlist_offer_expires_at: expiresAt })
        .eq('id', e.id)
      bump(c, 'waitlist_offer')
      open--
    } else if (status === 'duplicate') {
      open-- // offer already out but flags not yet stamped; still holds a spot
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Admin checkpoints + weekly digest
// ---------------------------------------------------------------------------

async function sweepAdminCheckpoints(bundle: ClassBundle, c: Counters) {
  const today = localDate(bundle.timezone)

  // (d) Instructor/classroom still blank 6 days before start — daily nag.
  const sixDaysOut = addDaysISO(bundle.firstSession, -6)
  if (
    today >= sixDaysOut &&
    today <= bundle.firstSession &&
    (!bundle.instructorName || !bundle.defaultLocation)
  ) {
    const status = await sendAdminAlert({
      dedupeKey: `blank_details:${bundle.id}:${today}`,
      adminEmail: ADMIN_EMAIL,
      subject: `Missing details — ${bundle.schoolLabel} — ${bundle.classType} starts ${bundle.firstSession}`,
      body: `<p>${!bundle.instructorName ? 'Instructor is blank. ' : ''}
        ${!bundle.defaultLocation ? 'Location is blank. ' : ''}
        Class starts ${bundle.firstSession}.</p>`,
    })
    if (status === 'sent') bump(c, 'admin_alert')
  }

  // (e) Min-enrollment checkpoint at the deadline (or 7 days before start).
  const checkpoint = bundle.enrollmentDeadline ?? addDaysISO(bundle.firstSession, -7)
  if (isDue(bundle.timezone, checkpoint, 8) && today <= bundle.firstSession) {
    const paidCount = bundle.enrollments.filter((e) => e.payment_status === 'Paid').length
    const status = await sendAdminAlert({
      dedupeKey: `min_enrollment:${bundle.id}`,
      adminEmail: ADMIN_EMAIL,
      subject: `Enrollment checkpoint — ${bundle.schoolLabel} — ${bundle.classType}: ${paidCount} paid / ${bundle.minEnrollment} minimum`,
      body: `<p><strong>${paidCount}</strong> paid enrollments against a minimum of
        <strong>${bundle.minEnrollment}</strong> (${bundle.deliveryMode}, capacity ${bundle.capacity}).
        Class starts ${bundle.firstSession}.
        ${paidCount < bundle.minEnrollment ? 'Below minimum — decide whether to run, push, or cancel.' : 'Minimum met.'}</p>`,
    })
    if (status === 'sent') bump(c, 'admin_alert')
  }
}

async function sweepWeeklyDigest(bundles: ClassBundle[], c: Counters) {
  // Monday 8:00+ admin-local. Dedupe on the Monday date.
  const today = localDate(DEFAULT_TIMEZONE)
  const isMonday = new Date(today + 'T12:00:00Z').getUTCDay() === 1
  if (!isMonday || localHour(DEFAULT_TIMEZONE) < 8) return

  const weekAgo = Date.now() - 7 * 24 * 3_600_000
  const rows: string[] = []
  for (const b of bundles) {
    const recent = b.enrollments.filter((e) => new Date(e.enrolled_at).getTime() >= weekAgo)
    if (recent.length === 0) continue
    const names = recent
      .map((e) => `${e.studentFirstName} ${e.studentLastName} (${e.payment_status})`)
      .join(', ')
    rows.push(`<li><strong>${b.schoolLabel} — ${b.classType}</strong>: ${recent.length} — ${names}</li>`)
  }
  if (rows.length === 0) return

  const status = await sendAdminAlert({
    dedupeKey: `weekly_digest:${today}`,
    adminEmail: ADMIN_EMAIL,
    subject: `Weekly digest — new registrations`,
    body: `<p>Registrations in the last 7 days:</p><ul>${rows.join('')}</ul>`,
  })
  if (status === 'sent') bump(c, 'weekly_digest')
}

// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  // Vercel Cron / pg_cron send Authorization: Bearer <CRON_SECRET>.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bundles = await loadClassBundles()
  const packages = await loadTutoringPackages()
  const counters: Counters = {}

  for (const bundle of bundles) {
    // Dead-class guard: a month after the last session there is nothing left
    // to send — skip entirely (prevents eternal hold-alerts on old classes).
    if (localDate(bundle.timezone) > addDaysISO(bundle.lastSession, 30)) continue

    await sweepPaymentReminders(bundle, counters)
    await sweepCompletion(bundle, counters)
    await sweepSequence(bundle, counters, packages.post)
    await sweepUpsell(bundle, counters, packages.pre)
    await sweepScheduleUpdates(bundle, counters)
    await sweepWaitlist(bundle, counters)
    await sweepAdminCheckpoints(bundle, counters)
  }
  await sweepWeeklyDigest(bundles, counters)

  return NextResponse.json({ ok: true, classes: bundles.length, actions: counters })
}
