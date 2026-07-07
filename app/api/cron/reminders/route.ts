import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from "../../../utils/supabase-admin"
import { createHash } from 'crypto'
import {
  classDetailsEmail,
  classFullNoticeEmail,
  classroomRequestEmail,
  counselorDigestEmail,
  deadlinePushEmail,
  faqEmail,
  formatDate,
  locationReminderEmail,
  paymentReminderEmail,
  reviewRequestEmail,
  scheduleUpdateEmail,
  secondDiagnosticEmail,
  sendAdminAlert,
  sendOnce,
  synapAccessParentEmail,
  synapAccessStudentEmail,
  thankYouEmail,
  tutoringOfferEmail,
  tutoringUpsellEmail,
  waitlistOfferEmail,
  type Audience,
  type DigestClassInfo,
  type EnrollmentEmailContext,
  type Rendered,
  type ScheduleChange,
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
  classroomRequestUrlFor,
  digestFrequencyUrlFor,
  emailContext,
  hoursSince,
  isDue,
  loadClassBundles,
  loadTutoringPackages,
  localDate,
  localHour,
  registrationCloseFor,
  registrationUrlFor,
  spotsTaken,
  stepTargetDate,
  type ClassBundle,
  type EnrollmentRow,
  type TutoringPackage,
} from '../../../utils/lifecycle'

// The lifecycle sweep. Runs hourly (Supabase pg_cron; Vercel daily cron as
// backup). Every decision is derived from *current* DB state and every send
// is deduped through email_log, so the sweep is fully idempotent:
// rescheduling a class automatically recomputes all pending sends, and
// re-running never double-sends.
//
// Audience model (docs/EMAIL_COPY.md): sequence emails render separately per
// recipient — parent send (dedupe `<type>_p:`) and student send (`<type>_s:`,
// only when a student email exists). Blank student email → parent-only,
// silently.

// Relationship (non-essential) emails — suppressed for opted-out families.
// Everything else is transactional and always sends. (#3 VFAQs is
// relationship per the deck; #1/#9 are handled in their own steps.)
const RELATIONSHIP_TYPES = new Set(['faq', 'second_diagnostic', 'review_request', 'tutoring_offer'])

type StepRenderers = Partial<Record<Audience, (ctx: EnrollmentEmailContext) => Rendered>>

function renderersFor(step: string, postPackages: TutoringPackage[]): StepRenderers {
  switch (step) {
    case 'synap_access':
      return { parent: synapAccessParentEmail, student: synapAccessStudentEmail }
    case 'faq':
      return { parent: (c) => faqEmail(c, 'parent'), student: (c) => faqEmail(c, 'student') }
    case 'class_details':
      return { parent: (c) => classDetailsEmail(c, 'parent'), student: (c) => classDetailsEmail(c, 'student') }
    case 'location_reminder':
      return { parent: (c) => locationReminderEmail(c, 'parent'), student: (c) => locationReminderEmail(c, 'student') }
    case 'second_diagnostic':
      return { parent: (c) => secondDiagnosticEmail(c, 'parent'), student: (c) => secondDiagnosticEmail(c, 'student') }
    case 'review_request':
      return { parent: reviewRequestEmail } // parent-only
    case 'tutoring_offer':
      return {
        parent: (c) => tutoringOfferEmail(c, postPackages, 'parent'),
        student: (c) => tutoringOfferEmail(c, postPackages, 'student'),
      }
    default:
      return {}
  }
}

type Counters = Record<string, number>
function bump(c: Counters, key: string) {
  c[key] = (c[key] ?? 0) + 1
}

/** Send one step to one enrollment's audiences, deduped per audience. */
async function sendToAudiences(opts: {
  type: string
  renderers: StepRenderers
  ctx: EnrollmentEmailContext
  counters: Counters
  payload?: Record<string, unknown>
  dedupeSuffix?: string
}) {
  const { type, renderers, ctx, counters } = opts
  const suffix = opts.dedupeSuffix ? `:${opts.dedupeSuffix}` : ''
  const targets: { audience: Audience; to: string; tag: string }[] = []
  if (renderers.parent) targets.push({ audience: 'parent', to: ctx.parentEmail, tag: 'p' })
  if (renderers.student && ctx.studentEmail)
    targets.push({ audience: 'student', to: ctx.studentEmail, tag: 's' })

  for (const t of targets) {
    const { subject, html, from } = renderers[t.audience]!(ctx)
    const status = await sendOnce({
      dedupeKey: `${type}_${t.tag}:${ctx.enrollmentId}${suffix}`,
      emailType: type,
      enrollmentId: ctx.enrollmentId,
      to: [t.to],
      from,
      subject,
      html,
      payload: opts.payload,
    })
    if (status === 'sent') bump(counters, type)
  }
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
// 3. Email #1 — parent thank-you, ~3h after payment (deck timing). The
// late-registration combined welcome claims the same dedupe key at payment
// time, so late registrants never get both.
// ---------------------------------------------------------------------------

async function sweepThankYou(bundle: ClassBundle, c: Counters) {
  for (const e of bundle.enrollments) {
    if (e.payment_status !== 'Paid' && e.payment_status !== 'Completed') continue
    if (e.marketingOptOut) continue // relationship email
    if (!e.paid_at || hoursSince(e.paid_at) < 3) continue

    const ctx = emailContext(bundle, e)
    const { subject, html, from } = thankYouEmail(ctx)
    const status = await sendOnce({
      dedupeKey: `thank_you:${e.id}`,
      emailType: 'thank_you',
      enrollmentId: e.id,
      to: [ctx.parentEmail],
      from,
      subject,
      html,
    })
    if (status === 'sent') bump(c, 'thank_you')
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
// 4. Post-payment sequence (#2–#8), audience-aware
// ---------------------------------------------------------------------------

async function sweepSequence(bundle: ClassBundle, c: Counters, postPackages: TutoringPackage[]) {
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
        subject: `HOLD: class details email not sent for ${bundle.schoolLabel} ${bundle.classType}`,
        body: `<p>The "class details" email is due but is being held because
          ${!bundle.instructorName ? '<strong>instructor</strong> ' : ''}
          ${!bundle.instructorName && !bundle.defaultLocation ? 'and ' : ''}
          ${!bundle.defaultLocation ? '<strong>location</strong> ' : ''}
          is blank. Fill it in on the admin page — the email goes out on the next hourly sweep.</p>`,
      })
      bump(c, 'held')
      continue
    }

    const renderers = renderersFor(step.type, postPackages)
    for (const e of paid) {
      if (RELATIONSHIP_TYPES.has(step.type) && e.marketingOptOut) continue
      await sendToAudiences({
        type: step.type,
        renderers,
        ctx: emailContext(bundle, e),
        counters: c,
        payload: step.type === 'class_details' ? classDetailsSnapshot(bundle) : undefined,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Schedule-update detection (after email #4 went out) — {changesBlock}
// renders only the fields that actually changed.
// ---------------------------------------------------------------------------

function computeChanges(
  snapshot: Partial<ReturnType<typeof classDetailsSnapshot>>,
  bundle: ClassBundle
): ScheduleChange[] {
  const current = classDetailsSnapshot(bundle)
  const changes: ScheduleChange[] = []
  if (snapshot.first_session !== current.first_session)
    changes.push({ label: 'First day of class', value: formatDate(current.first_session) })
  if ((snapshot.location ?? null) !== (current.location ?? null))
    changes.push({ label: 'Location', value: current.location ?? 'TBD' })
  if ((snapshot.instructor ?? null) !== (current.instructor ?? null))
    changes.push({ label: 'Instructor', value: current.instructor ?? 'TBD' })
  return changes
}

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

  const staleByEnrollment = new Map<string, ScheduleChange[]>()
  for (const row of sentDetails) {
    if (!row.payload || !row.enrollment_id || staleByEnrollment.has(row.enrollment_id)) continue
    const changes = computeChanges(row.payload as Partial<typeof current>, bundle)
    if (changes.length > 0) staleByEnrollment.set(row.enrollment_id, changes)
  }
  if (staleByEnrollment.size === 0) return

  for (const [enrollmentId, changes] of staleByEnrollment) {
    const e = bundle.enrollments.find(
      (en) =>
        en.id === enrollmentId &&
        (en.payment_status === 'Paid' || en.payment_status === 'Completed')
    )
    if (!e) continue
    await sendToAudiences({
      type: 'schedule_update',
      renderers: {
        parent: (ctx) => scheduleUpdateEmail(ctx, 'parent', changes),
        student: (ctx) => scheduleUpdateEmail(ctx, 'student', changes),
      },
      ctx: emailContext(bundle, e),
      counters: c,
      dedupeSuffix: hash,
    })
  }

  // Refresh the snapshots so the *next* change triggers again.
  await supabase
    .from('email_log')
    .update({ payload: current })
    .eq('email_type', 'class_details')
    .in('enrollment_id', [...staleByEnrollment.keys()])
}

// ---------------------------------------------------------------------------
// 6. Waitlist: expire lapsed offers, then extend new ones (FCFS)
// ---------------------------------------------------------------------------

async function sweepWaitlist(bundle: ClassBundle, c: Counters) {
  // No new offers once registration has closed (first session by default,
  // registration_close_date overrides); lapsed offers still get rolled, and
  // already-extended offers keep their full 48h claim window.
  const registrationClosed = localDate(bundle.timezone) > registrationCloseFor(bundle)
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
          subject: `Waitlist offer expired unclaimed — ${bundle.schoolLabel} ${bundle.classType}`,
          body: `<p>${e.parentFirstName} (${e.parentEmail}, student ${e.studentFirstName}
            ${e.studentLastName}) did not claim their spot within ${WAITLIST_CLAIM_HOURS} hours.
            The offer rolls to the next family automatically.</p>`,
          enrollmentId: e.id,
        })
      }
    }
  }

  // Extend offers for however many spots are open, in join order.
  if (registrationClosed) return
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
// 7. Admin checkpoints + weekly digest
// ---------------------------------------------------------------------------

async function sweepAdminCheckpoints(bundle: ClassBundle, c: Counters) {
  const today = localDate(bundle.timezone)

  // Instructor/classroom still blank 6 days before start — daily nag.
  const sixDaysOut = addDaysISO(bundle.firstSession, -6)
  if (
    today >= sixDaysOut &&
    today <= bundle.firstSession &&
    (!bundle.instructorName || !bundle.defaultLocation)
  ) {
    const status = await sendAdminAlert({
      dedupeKey: `blank_details:${bundle.id}:${today}`,
      adminEmail: ADMIN_EMAIL,
      subject: `Missing details — ${bundle.schoolLabel} ${bundle.classType} starts ${bundle.firstSession}`,
      body: `<p>${!bundle.instructorName ? 'Instructor is blank. ' : ''}
        ${!bundle.defaultLocation ? 'Location is blank. ' : ''}
        Class starts ${bundle.firstSession}.</p>`,
    })
    if (status === 'sent') bump(c, 'admin_alert')
  }

  // Min-enrollment checkpoint at the deadline (or 7 days before start).
  const checkpoint = bundle.enrollmentDeadline ?? addDaysISO(bundle.firstSession, -7)
  if (isDue(bundle.timezone, checkpoint, 8) && today <= bundle.firstSession) {
    const paidCount = bundle.enrollments.filter((e) => e.payment_status === 'Paid').length
    const status = await sendAdminAlert({
      dedupeKey: `min_enrollment:${bundle.id}`,
      adminEmail: ADMIN_EMAIL,
      subject: `Enrollment checkpoint — ${bundle.schoolLabel} ${bundle.classType}: ${paidCount} paid / ${bundle.minEnrollment} minimum`,
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
  const sections: string[] = []

  // New registrations.
  const rows: string[] = []
  for (const b of bundles) {
    const recent = b.enrollments.filter((e: EnrollmentRow) => new Date(e.enrolled_at).getTime() >= weekAgo)
    if (recent.length === 0) continue
    const names = recent
      .map((e) => `${e.studentFirstName} ${e.studentLastName} (${e.payment_status})`)
      .join(', ')
    rows.push(`<li><strong>${b.schoolLabel} ${b.classType}</strong>: ${recent.length} — ${names}</li>`)
  }
  if (rows.length > 0) {
    sections.push(`<p>Registrations in the last 7 days:</p><ul>${rows.join('')}</ul>`)
  }

  // Delivery problems from the Resend webhook: hard bounces on student
  // emails (bad addresses collected at registration) and spam complaints.
  const { data: events } = await supabase
    .from('email_events')
    .select('event_type, email_address, subject, bounce_type, created_at')
    .gte('created_at', new Date(weekAgo).toISOString())
  if (events && events.length > 0) {
    const studentEmails = new Set(
      bundles.flatMap((b) => b.enrollments.map((e) => e.studentEmail?.toLowerCase()).filter(Boolean))
    )
    const hardBounces = events.filter(
      (ev) =>
        ev.event_type === 'email.bounced' &&
        ev.bounce_type !== 'Transient' &&
        studentEmails.has(ev.email_address)
    )
    if (hardBounces.length > 0) {
      const items = hardBounces
        .map((ev) => `<li><strong>${ev.email_address}</strong>${ev.subject ? ` — "${ev.subject}"` : ''}</li>`)
        .join('')
      sections.push(
        `<p><strong>Student email hard bounces</strong> — these addresses are bad; fix them in the
         students table or the student misses every class email:</p><ul>${items}</ul>`
      )
    }
    const complaints = events.filter((ev) => ev.event_type === 'email.complained')
    if (complaints.length > 0) {
      const items = complaints
        .map((ev) => `<li><strong>${ev.email_address}</strong>${ev.subject ? ` — "${ev.subject}"` : ''}</li>`)
        .join('')
      sections.push(`<p><strong>Spam complaints</strong> — consider opting these families out:</p><ul>${items}</ul>`)
    }
  }

  if (sections.length === 0) return

  const status = await sendAdminAlert({
    dedupeKey: `weekly_digest:${today}`,
    adminEmail: ADMIN_EMAIL,
    subject: `Weekly digest — registrations & email health`,
    body: sections.join(''),
  })
  if (status === 'sent') bump(c, 'weekly_digest')
}

// ---------------------------------------------------------------------------
// 8. Phase 4 counselor loop (PHASE4_SPEC §4a/§4b): enrollment digests,
// final-days push, and the classroom-request ask + nudges. All derived from
// current DB state and deduped through email_log like everything else.
// ---------------------------------------------------------------------------

type CounselorRow = {
  id: string
  school_id: string
  first_name: string
  email: string
  digest_frequency: 'weekly' | 'biweekly' | 'monthly' | 'paused'
  digest_last_sent_at: string | null
}

async function loadCounselorsBySchool(): Promise<Map<string, CounselorRow[]>> {
  const { data, error } = await supabase
    .from('school_counselors')
    .select('id, school_id, first_name, email, digest_frequency, digest_last_sent_at')
  if (error || !data) {
    console.error('loadCounselorsBySchool failed:', error?.message)
    return new Map()
  }
  const map = new Map<string, CounselorRow[]>()
  for (const c of data as CounselorRow[]) {
    map.set(c.school_id, [...(map.get(c.school_id) ?? []), c])
  }
  return map
}

/** Classes a counselor's digest covers: registration still open. */
function digestClasses(bundles: ClassBundle[], schoolId: string): ClassBundle[] {
  return bundles.filter(
    (b) => b.schoolId === schoolId && localDate(b.timezone) <= registrationCloseFor(b)
  )
}

function waitlistDepth(bundle: ClassBundle): number {
  return bundle.enrollments.filter((e) => e.payment_status === 'Waitlisted').length
}

function paidCount(bundle: ClassBundle): number {
  return bundle.enrollments.filter(
    (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
  ).length
}

// Minimum days between digests per frequency (with slack for cron jitter).
const DIGEST_INTERVAL_DAYS: Record<string, number> = { weekly: 6, biweekly: 13, monthly: 27 }

async function sweepCounselorDigests(
  bundles: ClassBundle[],
  counselorsBySchool: Map<string, CounselorRow[]>,
  c: Counters
) {
  for (const [schoolId, counselors] of counselorsBySchool) {
    const classes = digestClasses(bundles, schoolId)
    if (classes.length === 0) continue
    const tz = classes[0].timezone
    const today = localDate(tz)
    // Digests go out Monday mornings, school-local.
    const isMonday = new Date(today + 'T12:00:00Z').getUTCDay() === 1
    if (!isMonday || localHour(tz) < 8) continue

    for (const counselor of counselors) {
      if (counselor.digest_frequency === 'paused') continue
      const interval = DIGEST_INTERVAL_DAYS[counselor.digest_frequency] ?? 6
      if (
        counselor.digest_last_sent_at &&
        hoursSince(counselor.digest_last_sent_at) < interval * 24
      )
        continue

      const since = counselor.digest_last_sent_at ?? new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()
      const infos: DigestClassInfo[] = classes.map((b) => ({
        label: `${b.schoolLabel} ${b.classType}`,
        firstSession: b.firstSession,
        paid: paidCount(b),
        capacity: b.capacity,
        waitlistDepth: waitlistDepth(b),
        newSinceLast: b.enrollments.filter(
          (e) => e.enrolled_at >= since && e.payment_status !== 'Expired'
        ).length,
        regUrl: registrationUrlFor(b),
      }))

      const { subject, html } = counselorDigestEmail({
        counselorFirst: counselor.first_name,
        schoolName: classes[0].schoolName,
        classes: infos,
        frequency: counselor.digest_frequency,
        frequencyUrls: {
          weekly: digestFrequencyUrlFor(counselor.id, 'weekly'),
          biweekly: digestFrequencyUrlFor(counselor.id, 'biweekly'),
          monthly: digestFrequencyUrlFor(counselor.id, 'monthly'),
          paused: digestFrequencyUrlFor(counselor.id, 'paused'),
        },
      })
      const status = await sendOnce({
        dedupeKey: `counselor_digest:${counselor.id}:${today}`,
        emailType: 'counselor_digest',
        to: [counselor.email],
        subject,
        html,
      })
      if (status === 'sent') {
        await supabase
          .from('school_counselors')
          .update({ digest_last_sent_at: new Date().toISOString() })
          .eq('id', counselor.id)
        bump(c, 'counselor_digest')
      }
    }
  }
}

/**
 * Final-week push (§4a): on each of the last 3 days before the enrollment
 * deadline (fallback: first session), a daily last-call email — regardless of
 * digest frequency. A full class suppresses the push and sends the one-off
 * "class is full 🎉" note instead.
 */
async function sweepDeadlinePush(
  bundle: ClassBundle,
  counselorsBySchool: Map<string, CounselorRow[]>,
  c: Counters
) {
  if (!bundle.schoolId) return
  const counselors = counselorsBySchool.get(bundle.schoolId) ?? []
  if (counselors.length === 0) return

  const today = localDate(bundle.timezone)
  if (today > registrationCloseFor(bundle)) return
  const deadline = bundle.enrollmentDeadline ?? bundle.firstSession
  const window = [addDaysISO(deadline, -3), addDaysISO(deadline, -1)]
  if (today < window[0] || today > window[1]) return
  if (localHour(bundle.timezone) < 8) return

  const full = spotsTaken(bundle) >= bundle.capacity
  for (const counselor of counselors) {
    if (full) {
      const { subject, html } = classFullNoticeEmail({
        counselorFirst: counselor.first_name,
        label: `${bundle.schoolLabel} ${bundle.classType}`,
        waitlistDepth: waitlistDepth(bundle),
      })
      const status = await sendOnce({
        dedupeKey: `class_full_notice:${bundle.id}:${counselor.id}`,
        emailType: 'class_full_notice',
        to: [counselor.email],
        subject,
        html,
      })
      if (status === 'sent') bump(c, 'class_full_notice')
    } else {
      const { subject, html } = deadlinePushEmail({
        counselorFirst: counselor.first_name,
        label: `${bundle.schoolLabel} ${bundle.classType}`,
        spotsLeft: bundle.capacity - spotsTaken(bundle),
        deadline,
        regUrl: registrationUrlFor(bundle),
      })
      const status = await sendOnce({
        dedupeKey: `deadline_push:${bundle.id}:${counselor.id}:${today}`,
        emailType: 'deadline_push',
        to: [counselor.email],
        subject,
        html,
      })
      if (status === 'sent') bump(c, 'deadline_push')
    }
  }
}

/**
 * Classroom-request loop (§4b): in-person class, no room, 14 days out → ask
 * the school's counselors via tokenized form; re-nudge at 11 and 8 days; the
 * existing 6-day #4 hold-and-alert remains the backstop. Admin setting the
 * room directly auto-cancels the pending request.
 */
const CLASSROOM_REQUEST_LEAD_DAYS = Number(process.env.CLASSROOM_REQUEST_LEAD_DAYS ?? 14)
const CLASSROOM_NUDGE_DAYS = [11, 8]

async function sweepClassroomRequests(
  bundle: ClassBundle,
  counselorsBySchool: Map<string, CounselorRow[]>,
  c: Counters
) {
  if (bundle.deliveryMode !== 'in_person') return
  const today = localDate(bundle.timezone)
  if (today > bundle.firstSession) return

  const { data: existing } = await supabase
    .from('classroom_requests')
    .select('id, status, nudge_count')
    .eq('class_id', bundle.id)
    .maybeSingle()

  // Room got set (by the counselor form or the admin directly): close out.
  if (bundle.defaultLocation) {
    if (existing?.status === 'pending') {
      await supabase
        .from('classroom_requests')
        .update({ status: 'cancelled' })
        .eq('id', existing.id)
        .eq('status', 'pending')
    }
    return
  }

  if (today < addDaysISO(bundle.firstSession, -CLASSROOM_REQUEST_LEAD_DAYS)) return
  if (!bundle.schoolId) return
  const counselors = counselorsBySchool.get(bundle.schoolId) ?? []
  if (counselors.length === 0) return
  if (localHour(bundle.timezone) < 8) return

  const sendAsk = async (nudge: number) => {
    for (const counselor of counselors) {
      const { subject, html } = classroomRequestEmail({
        counselorFirst: counselor.first_name,
        schoolNickname: bundle.schoolLabel,
        classType: bundle.classType,
        firstSession: bundle.firstSession,
        formUrl: classroomRequestUrlFor(bundle.id, counselor.email),
        nudge,
      })
      const status = await sendOnce({
        dedupeKey: `classroom_request:${bundle.id}:${counselor.id}:${nudge}`,
        emailType: 'classroom_request',
        to: [counselor.email],
        subject,
        html,
      })
      if (status === 'sent') bump(c, 'classroom_request')
    }
  }

  if (!existing) {
    const { error } = await supabase
      .from('classroom_requests')
      .insert([{ class_id: bundle.id }])
    if (!error) await sendAsk(0)
    return
  }

  if (existing.status !== 'pending') return
  for (const [i, days] of CLASSROOM_NUDGE_DAYS.entries()) {
    const nudgeNumber = i + 1
    if (existing.nudge_count < nudgeNumber && today >= addDaysISO(bundle.firstSession, -days)) {
      await sendAsk(nudgeNumber)
      await supabase
        .from('classroom_requests')
        .update({ nudge_count: nudgeNumber, last_nudge_at: new Date().toISOString() })
        .eq('id', existing.id)
      return // at most one nudge per sweep
    }
  }
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
  const counselorsBySchool = await loadCounselorsBySchool()
  const counters: Counters = {}

  for (const bundle of bundles) {
    // Dead-class guard: a month after the last session there is nothing left
    // to send — skip entirely (prevents eternal hold-alerts on old classes).
    if (localDate(bundle.timezone) > addDaysISO(bundle.lastSession, 30)) continue

    await sweepPaymentReminders(bundle, counters)
    await sweepCompletion(bundle, counters)
    await sweepThankYou(bundle, counters)
    await sweepUpsell(bundle, counters, packages.pre)
    await sweepSequence(bundle, counters, packages.post)
    await sweepScheduleUpdates(bundle, counters)
    await sweepWaitlist(bundle, counters)
    await sweepAdminCheckpoints(bundle, counters)
    await sweepDeadlinePush(bundle, counselorsBySchool, counters)
    await sweepClassroomRequests(bundle, counselorsBySchool, counters)
  }
  await sweepCounselorDigests(bundles, counselorsBySchool, counters)
  await sweepWeeklyDigest(bundles, counters)

  return NextResponse.json({ ok: true, classes: bundles.length, actions: counters })
}
