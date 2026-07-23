import { emailBaseUrl } from '../../../utils/base-url'
import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from "../../../utils/supabase-admin"
import { processQboQueue, sweepQboHealth } from '../../../utils/qbo-sync'
import { processGcalQueue } from '../../../utils/gcal-sync'
import { autoCompleteSessions, sweepTimecards } from '../../../utils/timecards'
import { generateMonthlyCycle, loadCycleSettings, sweepProposals } from '../../../utils/tutoring-billing'
import { sweepCollections } from '../../../utils/tutoring-stripe'
import { runScheduleApprovalNudges } from '../../../utils/schedule-approval'
import { sweepPendingTutorNotices } from '../../../utils/tutor-notices'
import { sweepConversionFollowups } from '../../../utils/convert-tutoring'
import { classroomChaseLine } from '../../../utils/classroom-chase'
import { runAgreementNudges } from '../../../utils/agreement-nudges'
import { extendWaitlistOffers, waitlistRolloverAlertBody } from '../../../utils/waitlist-offers'
import {
  maybeSendInstructorFyi,
  sweepInstructorComms,
  syncInstructorClassCalendar,
} from '../../../utils/instructor-comms'
import { contactBlockHtml, contactFrom, loadContactInfo } from '../../../utils/tutoring-emails'
import { cancelScheduledForClass, projectScheduledSends } from '../../../utils/comms-projector'
import { createHash } from 'crypto'
import {
  classDetailsEmail,
  classFullNoticeEmail,
  classroomRequestEmail,
  counselorDigestEmail,
  digestClassListHtml,
  digestFrequencyHtml,
  digestSubjectCount,
  deadlinePushEmail,
  faqEmail,
  formatDate,
  instructorNudgeEmail,
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
  waitlistReleaseEmail,
  type Audience,
  type DigestClassInfo,
  type EnrollmentEmailContext,
  type Rendered,
  type ScheduleChange,
  e8AddonSchedulingEmail,
  e8AddonNudgeEmail,
  schedulingCtaBlockHtml,
} from '../../../utils/email'
import { renderEmail, type RenderedWithVersion } from '../../../utils/comms-db-render'
import { renderRegistered } from '../../../utils/comms-registered'
import {
  ADMIN_EMAIL,
  DEFAULT_TIMEZONE,
  INTERNAL_EMAIL,
  REGISTRATION_NOTIFY_EMAIL,
  PAYMENT_EXPIRY_HOURS,
  PAYMENT_REMINDERS,
  SEQUENCE,
  WAITLIST_CLAIM_HOURS,
  packageSavings,
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
  classDetailsSendDate,
  missingDetailsAlertStart,
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

// Renderers are async since A4: renderEmail() serves the DB-managed copy when
// the template is live, falling back to the code-rendered original otherwise.
type StepRenderers = Partial<
  Record<Audience, (ctx: EnrollmentEmailContext) => Promise<RenderedWithVersion>>
>

function renderersFor(step: string, postPackages: TutoringPackage[]): StepRenderers {
  const pair = (
    parentKey: string,
    studentKey: string,
    fallback: (c: EnrollmentEmailContext, a: Audience) => Rendered
  ): StepRenderers => ({
    parent: (c) => renderEmail(parentKey, c, 'parent', {}, () => fallback(c, 'parent')),
    student: (c) => renderEmail(studentKey, c, 'student', {}, () => fallback(c, 'student')),
  })
  switch (step) {
    case 'synap_access':
      return pair('E2_DIAG_PARENT', 'E2_DIAG_STUDENT', (c, a) =>
        a === 'parent' ? synapAccessParentEmail(c) : synapAccessStudentEmail(c)
      )
    case 'faq':
      return pair('E3_VFAQ', 'E3_VFAQ', (c, a) => faqEmail(c, a))
    case 'class_details':
      return pair('E4_CLASS_DETAILS', 'E4_CLASS_DETAILS', (c, a) => classDetailsEmail(c, a))
    case 'location_reminder':
      return pair('E5_LOCATION', 'E5_LOCATION', (c, a) => locationReminderEmail(c, a))
    case 'second_diagnostic':
      return pair('E6_DIAG2', 'E6_DIAG2', (c, a) => secondDiagnosticEmail(c, a))
    case 'review_request':
      return {
        parent: (c) => renderEmail('E7_REVIEW', c, 'parent', {}, () => reviewRequestEmail(c)),
      } // parent-only
    case 'tutoring_offer':
      return pair('E8_POSTCLASS_TUTORING', 'E8_POSTCLASS_TUTORING', (c, a) =>
        tutoringOfferEmail(c, postPackages, a)
      )
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
  /** PL-78: when set, the assigned instructor gets ONE FYI copy of this
   *  step's parent render (per-class-per-day dedupe makes it one per batch). */
  fyi?: { bundle: ClassBundle; templateKey: string }
}) {
  const { type, renderers, ctx, counters } = opts
  const suffix = opts.dedupeSuffix ? `:${opts.dedupeSuffix}` : ''
  const targets: { audience: Audience; to: string; tag: string }[] = []
  if (renderers.parent) targets.push({ audience: 'parent', to: ctx.parentEmail, tag: 'p' })
  if (renderers.student && ctx.studentEmail)
    targets.push({ audience: 'student', to: ctx.studentEmail, tag: 's' })

  for (const t of targets) {
    const { subject, html, from, versionId } = await renderers[t.audience]!(ctx)
    const status = await sendOnce({
      dedupeKey: `${type}_${t.tag}:${ctx.enrollmentId}${suffix}`,
      emailType: type,
      enrollmentId: ctx.enrollmentId,
      classId: ctx.classId,
      to: [t.to],
      from,
      subject,
      html,
      payload: opts.payload,
      bodySnapshotId: versionId,
    })
    if (status === 'sent') {
      bump(counters, type)
      if (opts.fyi && t.audience === 'parent') {
        await maybeSendInstructorFyi(opts.fyi.bundle, opts.fyi.templateKey, subject, html)
      }
    }
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
      const { subject, html, versionId } = await renderEmail(
        `PR${r.n}`,
        ctx,
        'parent',
        {},
        () => paymentReminderEmail(ctx, r.n)
      )
      const status = await sendOnce({
        dedupeKey: `payment_reminder_${r.n}:${e.id}`,
        emailType: 'payment_reminder',
        enrollmentId: e.id,
        classId: bundle.id,
        to: [ctx.parentEmail],
        subject,
        html,
        bodySnapshotId: versionId,
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
  await sweepWaitlistRelease(bundle, c)
}

// PL-59: when a class completes still-full, every still-Waitlisted family
// gets a close-out — CX-W only ever covered the *cancelled*-class case; the
// common case (class ran, spot never opened) previously sent nothing. Same
// interest-list carry as cancellation (PL-54: the "first to know" promise is
// real), then WR_WAITLIST_RELEASE with the tutoring offer and the family's
// tokenized availability link. Idempotent: interest upsert ignores
// duplicates, send is deduped per enrollment.
async function sweepWaitlistRelease(bundle: ClassBundle, c: Counters) {
  const waitlisted = bundle.enrollments.filter((e) => e.payment_status === 'Waitlisted')
  if (waitlisted.length === 0) return

  const { error: interestError } = await supabase.from('class_interest').upsert(
    waitlisted.map((e) => ({
      email: e.parentEmail.toLowerCase(),
      parent_name: e.parentFirstName || null,
      student_name: `${e.studentFirstName} ${e.studentLastName}`.trim() || null,
      school_id: bundle.schoolId,
      class_type: bundle.classType,
      source: 'cancellation',
    })),
    { onConflict: 'email,school_id,class_type', ignoreDuplicates: true }
  )
  if (interestError) {
    console.error('interest-list insert failed (release continues):', interestError.message)
  }

  const contact = await loadContactInfo()
  for (const e of waitlisted) {
    const ctx = emailContext(bundle, e)
    const { subject, html, from, versionId } = await renderEmail(
      'WR_WAITLIST_RELEASE',
      ctx,
      'parent',
      { contactBlock: contactBlockHtml(contact) },
      () => waitlistReleaseEmail(ctx, contactBlockHtml(contact))
    )
    const status = await sendOnce({
      dedupeKey: `waitlist_release:${e.id}`,
      emailType: 'waitlist_release',
      enrollmentId: e.id,
      classId: bundle.id,
      to: [ctx.parentEmail],
      from,
      subject,
      html,
      bodySnapshotId: versionId,
    })
    if (status === 'sent') bump(c, 'waitlist_release')
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
    const { subject, html, from, versionId } = await renderEmail('E1_THANKS', ctx, 'parent', {}, () =>
      thankYouEmail(ctx)
    )
    const status = await sendOnce({
      dedupeKey: `thank_you:${e.id}`,
      emailType: 'thank_you',
      enrollmentId: e.id,
      classId: bundle.id,
      to: [ctx.parentEmail],
      from,
      subject,
      html,
      bodySnapshotId: versionId,
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
    const addonUrl = addonPageUrlFor(e.id)
    // {upsellPackagesBlock}: live package math, computed for the DB template
    // exactly as the code template renders it.
    const upsellPackagesBlock = prePackages
      .map(
        (p) => `
      <p style="margin:8px 0">
        <a href="${addonUrl}" style="display:inline-block;background:#00AEEE;color:#fff;
        font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none;min-width:260px;text-align:center">
        ${p.hours} hours — save $${packageSavings(p)}</a>
      </p>`
      )
      .join('')
    const { subject, html, from, versionId } = await renderEmail(
      'E9_UPSELL',
      ctx,
      'parent',
      { upsellPackagesBlock },
      () => tutoringUpsellEmail(ctx, prePackages, addonUrl)
    )
    const status = await sendOnce({
      dedupeKey: `tutoring_upsell:${e.id}`,
      emailType: 'tutoring_upsell',
      enrollmentId: e.id,
      classId: bundle.id,
      to: [ctx.parentEmail],
      from,
      subject,
      html,
      bodySnapshotId: versionId,
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
        templateKey: 'AL_CLASS_DETAILS_HOLD',
        vars: { schoolNickname: bundle.schoolLabel, classType: bundle.classType },
        subject: `HOLD: class details email not sent for ${bundle.schoolLabel} ${bundle.classType}`,
        // PL-89: this alert now only fires after the 3-day warning failed —
        // the email is OVERDUE to families, so say so plainly.
        body: `<p>The class-details email to your ${bundle.schoolLabel} ${bundle.classType} families
          was due this morning and is being held —
          <strong>families are waiting on it</strong>. Fill in
          ${!bundle.instructorName ? '<strong>instructor</strong>' : ''}${!bundle.instructorName && !bundle.defaultLocation ? ' and ' : ''}${!bundle.defaultLocation ? '<strong>location</strong>' : ''}
          on the admin page and it releases on the next hourly sweep.</p>
          <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?class=${bundle.id}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fill in class details</a></p>`,
      })
      bump(c, 'held')
      continue
    }

    const renderers = renderersFor(step.type, postPackages)
    for (const e of paid) {
      if (RELATIONSHIP_TYPES.has(step.type) && e.marketingOptOut) continue

      // PL-53c: #8 is audience-aware. A family that already BOUGHT add-on
      // hours never gets the discount pitch — they get "time to put your
      // hours to work" instead (or nothing at all if they're already
      // scheduling: early starters are never nagged).
      if (step.type === 'tutoring_offer' && e.addons.length > 0) {
        const state = await addonSchedulingState(e.id)
        const ctx = emailContext(bundle, e)
        if (state.hasAvailability && state.hasSchedule) {
          await supabase
            .from('email_sends')
            .update({
              status: 'cancelled',
              cancel_reason: 'family already scheduling their add-on hours (PL-53c suppression)',
              cancelled_by: 'system',
              updated_at: new Date().toISOString(),
            })
            .in('dedupe_key', ['p', 's'].map((tag) => `tutoring_offer_${tag}:${e.id}`))
            .in('status', ['scheduled', 'held'])
          bump(c, 'addon_scheduling_suppressed')
          continue
        }
        const contact = await loadContactInfo()
        const rendered = await renderEmail(
          'E8_ADDON_SCHEDULING',
          ctx,
          'parent',
          {
            hoursRemaining: String(state.hoursRemaining),
            schedulingCtaBlock: schedulingCtaBlockHtml(ctx, state.hasAvailability),
            contactBlock: contactBlockHtml(contact),
          },
          () =>
            e8AddonSchedulingEmail(ctx, {
              hoursRemaining: state.hoursRemaining,
              hasAvailability: state.hasAvailability,
              from: contactFrom(contact),
              contactHtml: contactBlockHtml(contact),
            })
        )
        // Claims the projected tutoring_offer row (same dedupe key); the
        // student-audience twin is cancelled — this fork is parent-only.
        await supabase
          .from('email_sends')
          .update({ template_key: 'E8_ADDON_SCHEDULING', updated_at: new Date().toISOString() })
          .eq('dedupe_key', `tutoring_offer_p:${e.id}`)
          .in('status', ['scheduled', 'held'])
        await supabase
          .from('email_sends')
          .update({
            status: 'cancelled',
            cancel_reason: 'add-on scheduling email is parent-only (PL-53c)',
            cancelled_by: 'system',
            updated_at: new Date().toISOString(),
          })
          .eq('dedupe_key', `tutoring_offer_s:${e.id}`)
          .in('status', ['scheduled', 'held'])
        const status = await sendOnce({
          dedupeKey: `tutoring_offer_p:${e.id}`,
          emailType: 'tutoring_addon_scheduling',
          enrollmentId: e.id,
          classId: bundle.id,
          to: [e.parentEmail],
          from: rendered.from ?? contactFrom(contact),
          subject: rendered.subject,
          html: rendered.html,
          templateKey: 'E8_ADDON_SCHEDULING',
          bodySnapshotId: (rendered as RenderedWithVersion).versionId,
        })
        if (status === 'sent') bump(c, 'addon_scheduling')
        continue
      }

      await sendToAudiences({
        type: step.type,
        renderers,
        ctx: emailContext(bundle, e),
        counters: c,
        payload: step.type === 'class_details' ? classDetailsSnapshot(bundle) : undefined,
        // PL-78: logistics-only FYI copies (Scarlett's pick — #4 and #5 here;
        // SU and CX hook at their own send sites).
        fyi:
          step.type === 'class_details'
            ? { bundle, templateKey: 'E4_CLASS_DETAILS' }
            : step.type === 'location_reminder'
              ? { bundle, templateKey: 'E5_LOCATION' }
              : undefined,
      })
    }
  }
}

// PL-53c: what state is this add-on family's scheduling in?
async function addonSchedulingState(enrollmentId: string): Promise<{
  hoursRemaining: number
  hasAvailability: boolean
  hasSchedule: boolean
}> {
  const { data: enr } = await supabase
    .from('enrollments')
    .select('student_id, enrollment_addons ( id, hours )')
    .eq('id', enrollmentId)
    .maybeSingle()
  const addonRows = (enr?.enrollment_addons ?? []) as { id: string; hours: number }[]
  const purchased = addonRows.reduce((sum, a) => sum + Number(a.hours), 0)
  const studentId = enr?.student_id as string | undefined
  if (!studentId) return { hoursRemaining: purchased, hasAvailability: false, hasSchedule: false }

  const [{ count: availabilityCount }, { data: engagements }] = await Promise.all([
    supabase
      .from('student_availability')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId),
    supabase.from('tutoring_engagements').select('id, addon_id').eq('student_id', studentId),
  ])
  let used = 0
  let hasSchedule = false
  const engIds = (engagements ?? []).map((g) => g.id)
  if (engIds.length > 0) {
    const { data: sessions } = await supabase
      .from('tutoring_sessions')
      .select('engagement_id, duration_minutes, status')
      .in('engagement_id', engIds)
      .in('status', ['proposed', 'confirmed', 'completed', 'no_show', 'forfeited'])
    hasSchedule = (sessions ?? []).length > 0
    const addonIds = new Set(addonRows.map((a) => a.id))
    const packageEngIds = new Set((engagements ?? []).filter((g) => g.addon_id && addonIds.has(g.addon_id)).map((g) => g.id))
    used = (sessions ?? [])
      .filter((s) => packageEngIds.has(s.engagement_id) && s.status !== 'proposed')
      .reduce((sum, s) => sum + s.duration_minutes / 60, 0)
  }
  return {
    hoursRemaining: Math.max(0, Number((purchased - used).toFixed(1))),
    hasAvailability: (availabilityCount ?? 0) > 0,
    hasSchedule,
  }
}

// PL-53c: one gentle nudge ~7 days after the scheduling email if the family
// still has no availability and no schedule; at ~14 days an Ops Director
// alert so Kelsie calls. Never escalates beyond that.
async function sweepAddonSchedulingNudges(c: Counters) {
  const { data: sent } = await supabase
    .from('email_sends')
    .select('enrollment_id, sent_at')
    .eq('template_key', 'E8_ADDON_SCHEDULING')
    .in('status', ['sent', 'delivered'])
    .not('enrollment_id', 'is', null)
    .not('sent_at', 'is', null)
  const contact = await loadContactInfo()
  for (const row of sent ?? []) {
    const ageDays = (Date.now() - new Date(row.sent_at as string).getTime()) / 86_400_000
    if (ageDays < 7) continue
    const state = await addonSchedulingState(row.enrollment_id as string)
    if (state.hasAvailability || state.hasSchedule) continue

    const { data: enrRow } = await supabase
      .from('enrollments')
      .select('class_id')
      .eq('id', row.enrollment_id as string)
      .maybeSingle()
    if (!enrRow?.class_id) continue
    const [bundle] = await loadClassBundles(enrRow.class_id)
    const enrollment = bundle?.enrollments.find((e) => e.id === row.enrollment_id)
    if (!bundle || !enrollment) continue
    const ctx = emailContext(bundle, enrollment)

    const rendered = await renderEmail(
      'E8_ADDON_NUDGE',
      ctx,
      'parent',
      { hoursRemaining: String(state.hoursRemaining), contactBlock: contactBlockHtml(contact) },
      () =>
        e8AddonNudgeEmail(ctx, {
          hoursRemaining: state.hoursRemaining,
          from: contactFrom(contact),
          contactHtml: contactBlockHtml(contact),
        })
    )
    const status = await sendOnce({
      dedupeKey: `addon_sched_nudge:${row.enrollment_id}`,
      emailType: 'tutoring_addon_nudge',
      enrollmentId: row.enrollment_id as string,
      classId: enrRow.class_id,
      to: [ctx.parentEmail],
      from: rendered.from ?? contactFrom(contact),
      subject: rendered.subject,
      html: rendered.html,
      templateKey: 'E8_ADDON_NUDGE',
      bodySnapshotId: (rendered as RenderedWithVersion).versionId,
    })
    if (status === 'sent') bump(c, 'addon_scheduling_nudged')

    if (ageDays >= 14) {
      const alerted = await sendAdminAlert({
        dedupeKey: `addon_sched_stalled:${row.enrollment_id}`,
        adminEmail: ADMIN_EMAIL,
        subject: `Add-on hours idle — ${ctx.studentFirstName} ${ctx.studentLastName} (worth a call)`,
        body: `<p>${ctx.parentFirstName} (${ctx.parentEmail}) bought
          ${state.hoursRemaining} tutoring hour${state.hoursRemaining === 1 ? '' : 's'} with the
          ${ctx.className} class, got the scheduling email and one nudge, and still hasn't shared
          availability or scheduled. No more automated emails go out — this one's a phone call.</p>`,
        enrollmentId: row.enrollment_id as string,
      })
      if (alerted === 'sent') bump(c, 'addon_scheduling_alerted')
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
    .from('email_sends')
    .select('enrollment_id, payload')
    .eq('template_key', 'E4_CLASS_DETAILS')
    .in('status', ['sent', 'delivered', 'bounced', 'complained'])
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
    const changesBlock = `<ul style="padding-left:20px">${changes
      .map((ch) => `<li><strong>${ch.label}:</strong> now ${ch.value}</li>`)
      .join('')}</ul>`
    await sendToAudiences({
      type: 'schedule_update',
      renderers: {
        parent: (ctx) =>
          renderEmail('SU_SCHEDULE_UPDATE', ctx, 'parent', { changesBlock }, () =>
            scheduleUpdateEmail(ctx, 'parent', changes)
          ),
        student: (ctx) =>
          renderEmail('SU_SCHEDULE_UPDATE', ctx, 'student', { changesBlock }, () =>
            scheduleUpdateEmail(ctx, 'student', changes)
          ),
      },
      ctx: emailContext(bundle, e),
      counters: c,
      dedupeSuffix: hash,
      fyi: { bundle, templateKey: 'SU_SCHEDULE_UPDATE' },
    })
  }

  // Refresh the snapshots so the *next* change triggers again.
  await supabase
    .from('email_sends')
    .update({ payload: current })
    .eq('template_key', 'E4_CLASS_DETAILS')
    .in('status', ['sent', 'delivered', 'bounced', 'complained'])
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
          templateKey: 'AL_WAITLIST_ROLLOVER',
          vars: { schoolNickname: bundle.schoolLabel, classType: bundle.classType },
          subject: `Waitlist offer expired unclaimed — ${bundle.schoolLabel} ${bundle.classType}`,
          // PL-94: the cockpit — offer open status + the rescue action row.
          body: await waitlistRolloverAlertBody(
            bundle,
            e,
            `<p>${e.parentFirstName} (${e.parentEmail}, student ${e.studentFirstName}
            ${e.studentLastName}) did not claim their spot within ${WAITLIST_CLAIM_HOURS} hours.
            The offer rolls to the next family automatically.</p>`
          ),
          enrollmentId: e.id,
        })
      }
    }
  }

  // PL-72: the extension pass lives in waitlist-offers.ts — the decline API
  // runs the same cascade immediately on a confirmed decline.
  const offered = await extendWaitlistOffers(bundle)
  for (let i = 0; i < offered; i++) bump(c, 'waitlist_offer')
}

// ---------------------------------------------------------------------------
// 7. Admin checkpoints + weekly digest
// ---------------------------------------------------------------------------


async function sweepAdminCheckpoints(bundle: ClassBundle, c: Counters) {
  const today = localDate(bundle.timezone)

  // PL-89: instructor/classroom still blank — daily warning anchored to #4's
  // SEND date (derived from the SEQUENCE offset; today first-session −7d),
  // starting 3 days before it: "not going to be solvable in an hour"
  // deserves 3 days of runway framed around the email deadline, not the
  // class start.
  const fourSend = classDetailsSendDate(bundle)
  if (
    today >= missingDetailsAlertStart(bundle) &&
    today <= bundle.firstSession &&
    (!bundle.instructorName || !bundle.defaultLocation)
  ) {
    const label = `${bundle.schoolLabel} ${bundle.classType}`
    const daysToFirst = Math.round((Date.parse(bundle.firstSession) - Date.parse(today)) / 86_400_000)
    const daysToSend = Math.round((Date.parse(fourSend) - Date.parse(today)) / 86_400_000)
    const weeksPhrase = daysToFirst >= 7 ? `in ${Math.round(daysToFirst / 7)} week${Math.round(daysToFirst / 7) === 1 ? '' : 's'}` : `in ${daysToFirst} day${daysToFirst === 1 ? '' : 's'}`
    const sendPhrase = daysToSend > 0 ? `in ${daysToSend} day${daysToSend === 1 ? '' : 's'}` : daysToSend === 0 ? 'today' : `${-daysToSend} day${daysToSend === -1 ? '' : 's'} ago`
    const bullets: string[] = []
    if (!bundle.defaultLocation) {
      const chase = await classroomChaseLine(bundle.id)
      bullets.push(
        `<li style="margin:4px 0"><strong>Location</strong> — blank. Classroom request status: ${chase}.</li>`
      )
    }
    if (!bundle.instructorName) {
      bullets.push(`<li style="margin:4px 0"><strong>Instructor</strong> — blank. Assign one on the class page.</li>`)
    }
    const status = await sendAdminAlert({
      dedupeKey: `blank_details:${bundle.id}:${today}`,
      adminEmail: ADMIN_EMAIL,
      templateKey: 'AL_MISSING_DETAILS',
      vars: {
        schoolNickname: bundle.schoolLabel,
        classType: bundle.classType,
        schoolName: bundle.schoolName,
        firstSession: bundle.firstSession,
        classDetailsSendDate: formatDate(fourSend),
      },
      subject: `Missing details — ${label} class-details email goes out ${formatDate(fourSend)}`,
      body: `<p><strong>${label}</strong> — first session <strong>${formatDate(bundle.firstSession)}</strong> (${weeksPhrase}).</p>
        <p>The "class details" email to families goes out <strong>${formatDate(fourSend)}</strong>
        (${sendPhrase}), and it can't send while these are blank:</p>
        <ul style="margin:0;padding-left:20px;color:#334155">${bullets.join('')}</ul>
        <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?class=${bundle.id}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fill in class details</a></p>
        <p>If the room comes through, filling it in releases everything automatically — nothing
        else to do. If it's still blank when the email is due, the send holds and families wait;
        that's the next alert you'd get.</p>`,
    })
    if (status === 'sent') bump(c, 'admin_alert')
  }

  // PL-91: the min-enrollment checkpoint is a DECISION BRIEF at deadline−3d
  // when paid < minimum — the full picture (both clocks, FP status) and the
  // three legitimate moves. Nothing automatic: the brief informs, the Ops
  // Director decides. Dedupe keys carry the deadline, so EXTENDING the
  // deadline re-arms the checkpoint against the new date. If the deadline
  // passes still under minimum, ONE follow-up; no other repeats.
  // §7.4 rule preserved for the min-met moment: the instructor nudge owns
  // "minimum met, nobody teaching"; min-met with an instructor stays quiet
  // (the IN_DIGEST milestone ping already told everyone the good news).
  const deadline = bundle.enrollmentDeadline ?? addDaysISO(bundle.firstSession, -7)
  const paidCount = bundle.enrollments.filter((e) => e.payment_status === 'Paid').length
  if (paidCount < bundle.minEnrollment && today <= bundle.firstSession && localHour(bundle.timezone) >= 8) {
    const label = `${bundle.schoolLabel} ${bundle.classType}`
    const daysToDeadline = Math.round((Date.parse(deadline) - Date.parse(today)) / 86_400_000)
    const daysToFirst = Math.round((Date.parse(bundle.firstSession) - Date.parse(today)) / 86_400_000)
    const weeksToFirst = Math.max(1, Math.round(daysToFirst / 7))
    // Counselor-side status from the FP push's own send rows.
    const { data: fpSends } = await supabase
      .from('email_sends')
      .select('sent_at')
      .like('dedupe_key', `deadline_push:${bundle.id}:%`)
      .in('status', ['sent', 'delivered'])
      .order('sent_at', { ascending: false })
      .limit(1)
    const fpStatus = fpSends?.[0]?.sent_at
      ? `FP last-call sent ${formatDate(fpSends[0].sent_at.slice(0, 10))}`
      : 'FP push not yet sent (it fires deadline−3d to −1d)'
    const classLink = `${emailBaseUrl()}/admin?class=${bundle.id}`
    const movesHtml = `
      <p><strong>Your three moves:</strong></p>
      <ul style="margin:0;padding-left:20px;color:#334155">
        <li style="margin:6px 0"><strong>Hold</strong> — final-days signups often close the gap;
        the FP push is already working the counselor side.</li>
        <li style="margin:6px 0"><strong>Extend the deadline</strong> (commonly a week) —
        <a href="${classLink}">set it on the class page</a>. Extending propagates automatically:
        collateral, the registration page, and the counselor push timing all derive from the
        class record, and this checkpoint re-arms against the new date (you'll get this brief
        again at new-deadline −3d if still under).</li>
        <li style="margin:6px 0"><strong>Run under minimum, or cancel</strong> — running under
        is a legitimate call once in a while; <a href="${classLink}">the cancel flow lives on
        the class page</a> if it's the other way.</li>
      </ul>
      <p>Nothing here is automatic — this brief informs; the decision is yours.</p>`
    const pictureHtml = `<p><strong>${paidCount} paid / ${bundle.minEnrollment} minimum / ${bundle.capacity} cap</strong>
      · registration closes ${daysToDeadline >= 0 ? `in ${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'}` : `${-daysToDeadline} day${daysToDeadline === -1 ? '' : 's'} ago`} (${formatDate(deadline)})
      · first session in ${weeksToFirst} week${weeksToFirst === 1 ? '' : 's'} (${formatDate(bundle.firstSession)}).</p>
      <p>Counselor side: ${fpStatus}.</p>`
    if (today >= addDaysISO(deadline, -3) && today <= deadline) {
      const status = await sendAdminAlert({
        dedupeKey: `min_enrollment:${bundle.id}:${deadline}`,
        adminEmail: ADMIN_EMAIL,
        templateKey: 'AL_MIN_ENROLLMENT',
        vars: {
          schoolNickname: bundle.schoolLabel,
          classType: bundle.classType,
          alertCounts: `${paidCount} paid / ${bundle.minEnrollment} minimum`,
        },
        subject: `Enrollment checkpoint — ${label}: ${paidCount} paid / ${bundle.minEnrollment} minimum`,
        body: pictureHtml + movesHtml,
      })
      if (status === 'sent') bump(c, 'admin_alert')
    } else if (today > deadline) {
      const status = await sendAdminAlert({
        dedupeKey: `min_enrollment_followup:${bundle.id}:${deadline}`,
        adminEmail: ADMIN_EMAIL,
        templateKey: 'AL_MIN_ENROLLMENT',
        vars: {
          schoolNickname: bundle.schoolLabel,
          classType: bundle.classType,
          alertCounts: `${paidCount} paid / ${bundle.minEnrollment} minimum`,
        },
        subject: `Deadline passed — decision needed: ${label} at ${paidCount} paid / ${bundle.minEnrollment} minimum`,
        body: `<p><strong>The registration deadline passed ${formatDate(deadline)} with the class
          still under minimum.</strong> One decision closes this out — nothing else will nag.</p>` +
          pictureHtml + movesHtml,
      })
      if (status === 'sent') bump(c, 'admin_alert')
    }
  }
}

/**
 * Instructor scheduling nudge (addendum §7.4) — internal, info@ → info@.
 * Fires once per class the moment paid enrollments reach min_enrollment with
 * no instructor assigned (which also covers "deadline passes with minimum
 * met"). Below minimum: nothing — the min-enrollment checkpoint owns that
 * case. Re-nudges at 11 and 8 days before the first session, most recent
 * window only, at most one send per sweep. Assigning an instructor (or
 * cancelling — the main loop skips cancelled) suppresses everything.
 */
async function sweepInstructorNudges(bundle: ClassBundle, c: Counters) {
  if (bundle.instructorId || bundle.instructorName) return
  const paid = bundle.enrollments.filter((e) => e.payment_status === 'Paid').length
  if (paid < bundle.minEnrollment) return
  const today = localDate(bundle.timezone)
  if (today > bundle.firstSession) return
  if (localHour(bundle.timezone) < 8) return

  const base = {
    label: `${bundle.schoolLabel} ${bundle.classType}`,
    schoolName: bundle.schoolName,
    paidCount: paid,
    minEnrollment: bundle.minEnrollment,
    firstSession: bundle.firstSession,
    adminUrl: `${emailBaseUrl()}/admin`,
  }

  // PL-66: registry copy when live (subject WITHOUT the [HGL Admin] prefix —
  // added below); the code twin already carries the prefix.
  const nudgeDetailsBlock = `<p><strong>${base.label}</strong> (${base.schoolName}) has
      <strong>${paid} paid</strong> enrollments against a minimum of
      <strong>${bundle.minEnrollment}</strong> — the class is running, and no instructor is
      assigned yet.</p>
      <p>First session: <strong>${formatDate(bundle.firstSession)}</strong>.</p>
      <p><a href="${base.adminUrl}">Open the admin class view</a> and select an instructor
      from the dropdown — or add a new one — so the class-details email can go out on
      schedule.</p>`
  const renderNudge = async (nudge: number) => {
    const email = await renderRegistered(
      'ADMIN_INSTRUCTOR_NUDGE',
      {
        parentFirstName: 'Ops Director',
        parentEmail: INTERNAL_EMAIL,
        schoolNickname: bundle.schoolLabel,
        classType: bundle.classType,
        schoolName: bundle.schoolName,
        firstSession: bundle.firstSession,
      },
      { alertDetailsBlock: nudgeDetailsBlock },
      () => instructorNudgeEmail({ ...base, nudge })
    )
    return {
      subject: email.subject.startsWith('[HGL Admin]') ? email.subject : `[HGL Admin] ${email.subject}`,
      html: email.html,
    }
  }

  const initial = await renderNudge(0)
  const initialStatus = await sendOnce({
    dedupeKey: `instructor_nudge:${bundle.id}`,
    emailType: 'instructor_nudge',
    templateKey: 'ADMIN_INSTRUCTOR_NUDGE',
    to: [INTERNAL_EMAIL],
    subject: initial.subject,
    html: initial.html,
  })
  if (initialStatus === 'sent') {
    bump(c, 'instructor_nudge')
    return // never a same-day re-nudge on top of the initial
  }

  for (const [n, days] of [
    [2, 8],
    [1, 11],
  ] as const) {
    if (today >= addDaysISO(bundle.firstSession, -days)) {
      const { subject, html } = await renderNudge(n)
      const status = await sendOnce({
        dedupeKey: `instructor_nudge:${bundle.id}:r${n}`,
        emailType: 'instructor_nudge',
        templateKey: 'ADMIN_INSTRUCTOR_NUDGE',
        to: [INTERNAL_EMAIL],
        subject,
        html,
      })
      if (status === 'sent') bump(c, 'instructor_nudge')
      return // most recent window only, one per sweep
    }
  }
}

// Admin roster report (ADMIN email — upgraded Phase 2 weekly digest, July 8
// punch list; strictly separate from the Phase 4 counselor digest): every
// open class's full roster with paid/pending/waitlist counts vs minimum and
// capacity, flagging in-person classes still under minimum (those drive
// travel-booking decisions), plus the existing email-health reporting.
async function sweepAdminRosterReport(bundles: ClassBundle[], c: Counters) {
  // Monday 8:00+ admin-local. Dedupe on the Monday date.
  const today = localDate(DEFAULT_TIMEZONE)
  const isMonday = new Date(today + 'T12:00:00Z').getUTCDay() === 1
  if (!isMonday || localHour(DEFAULT_TIMEZONE) < 8) return

  const weekAgo = Date.now() - 7 * 24 * 3_600_000
  const sections: string[] = []

  const live = bundles.filter((b) => b.status !== 'cancelled' && b.lastSession >= today)
  const underMinInPerson: string[] = []
  const classBlocks: string[] = []
  for (const b of live) {
    const active = b.enrollments.filter((e: EnrollmentRow) =>
      ['Paid', 'Completed', 'Pending', 'Waitlisted'].includes(e.payment_status)
    )
    const paid = active.filter(
      (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
    ).length
    const pending = active.filter((e) => e.payment_status === 'Pending').length
    const waitlisted = active.filter((e) => e.payment_status === 'Waitlisted').length
    const verdict =
      paid >= b.capacity
        ? `<span style="color:#15803d;font-weight:bold">FULL</span>`
        : paid >= b.minEnrollment
          ? `<span style="color:#15803d;font-weight:bold">runs (min ${b.minEnrollment} met)</span>`
          : `<span style="color:#b45309;font-weight:bold">below minimum — needs ${b.minEnrollment - paid} more paid</span>`
    if (paid < b.minEnrollment && b.deliveryMode !== 'online') {
      underMinInPerson.push(
        `<li><strong>${b.schoolLabel} ${b.classType}</strong> — ${paid} paid / ${b.minEnrollment} min, starts ${b.firstSession}</li>`
      )
    }
    const roster =
      active.length === 0
        ? '<li style="color:#64748b">no registrations yet</li>'
        : [...active]
            .sort((a, b2) => a.studentLastName.localeCompare(b2.studentLastName))
            .map((e) => {
              const isNew = new Date(e.enrolled_at).getTime() >= weekAgo
              return `<li>${e.studentFirstName} ${e.studentLastName} — ${e.payment_status}${
                isNew ? ' <span style="color:#0284c7;font-weight:bold">(new this week)</span>' : ''
              }</li>`
            })
            .join('')
    classBlocks.push(
      `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin:8px 0">
        <p style="margin:0"><strong>${b.schoolLabel} ${b.classType}</strong> — starts ${b.firstSession} ·
        ${paid} paid / ${pending} pending / ${waitlisted} waitlisted ·
        ${b.minEnrollment} min / ${b.capacity} cap · ${verdict}</p>
        <ul style="margin:6px 0 0">${roster}</ul>
      </div>`
    )
  }
  // Travel decisions first: in-person classes that don't run yet.
  if (underMinInPerson.length > 0) {
    sections.push(
      `<p><strong style="color:#b45309">⚠ In-person classes under minimum</strong>
       (travel booking waits on these):</p><ul>${underMinInPerson.join('')}</ul>`
    )
  }
  if (classBlocks.length > 0) {
    sections.push(`<p><strong>Open classes — full rosters:</strong></p>${classBlocks.join('')}`)
  }

  // Feature B3 abuse guard: instructor class messages sent this week, so the
  // admin always knows what went out from the portal under the HGL identity.
  const { data: imSends } = await supabase
    .from('email_sends')
    .select('sender_email, subject_rendered, class_id, classes ( class_type, schools ( nickname ) )')
    .eq('template_key', 'IM_INSTRUCTOR_MESSAGE')
    .eq('is_test', false)
    .in('status', ['sent', 'delivered', 'bounced', 'complained'])
    .gte('sent_at', new Date(weekAgo).toISOString())
  if (imSends && imSends.length > 0) {
    const byMessage = new Map<string, { sender: string; subject: string; label: string; n: number }>()
    for (const row of imSends) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const cls = (Array.isArray(row.classes) ? row.classes[0] : row.classes) as any
      const school = cls ? (Array.isArray(cls.schools) ? cls.schools[0] : cls.schools) : null
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const key = `${row.sender_email}|${row.subject_rendered}`
      const entry = byMessage.get(key) ?? {
        sender: row.sender_email ?? '—',
        subject: row.subject_rendered ?? '—',
        label: cls ? `${school?.nickname ?? ''} ${cls.class_type}` : '—',
        n: 0,
      }
      entry.n++
      byMessage.set(key, entry)
    }
    const items = [...byMessage.values()]
      .map((m) => `<li><strong>${m.sender}</strong> → ${m.label} · "${m.subject}" (${m.n} recipients)</li>`)
      .join('')
    sections.push(
      `<p><strong>Instructor messages sent from the portal this week:</strong></p><ul>${items}</ul>`
    )
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
    // Dedupe key kept from the Phase 2 weekly digest so a Monday deploy
    // can't send both the old and new report.
    dedupeKey: `weekly_digest:${today}`,
    adminEmail: REGISTRATION_NOTIFY_EMAIL,
    templateKey: 'AL_ROSTER_REPORT',
    subject: `Admin roster report — classes vs. minimums & email health`,
    body: sections.join(''),
  })
  if (status === 'sent') bump(c, 'admin_roster_report')
}

// ---------------------------------------------------------------------------
// 8. Phase 4 counselor loop (PHASE4_SPEC §4a/§4b): enrollment digests,
// final-days push, and the classroom-request ask + nudges. All derived from
// current DB state and deduped through email_log like everything else.
// ---------------------------------------------------------------------------

// One ACTIVE school affiliation + its contact. `id` is the affiliation id —
// digest tokens, digest_last_sent_at, dedupe keys, AND classes.counselor_id
// all bind to it (addendum §6: class contact assignments reference the
// affiliation, not the bare contact).
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
    .from('school_affiliations')
    .select('id, school_id, digest_frequency, digest_last_sent_at, contacts ( first_name, email )')
    .is('ended_at', null)
  if (error || !data) {
    console.error('loadCounselorsBySchool failed:', error?.message)
    return new Map()
  }
  const map = new Map<string, CounselorRow[]>()
  for (const row of data) {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
    if (!contact) continue
    const c: CounselorRow = {
      id: row.id,
      school_id: row.school_id,
      first_name: contact.first_name,
      email: contact.email,
      digest_frequency: row.digest_frequency as CounselorRow['digest_frequency'],
      digest_last_sent_at: row.digest_last_sent_at,
    }
    map.set(c.school_id, [...(map.get(c.school_id) ?? []), c])
  }
  return map
}

/**
 * Recipients for CLASS-specific sends (classroom requests, final-days push,
 * class-full note): the class's designated school contact when set, else
 * every contact at the school. Digests stay school-wide regardless.
 */
function contactsForClass(
  bundle: ClassBundle,
  counselorsBySchool: Map<string, CounselorRow[]>
): CounselorRow[] {
  if (!bundle.schoolId) return []
  const all = counselorsBySchool.get(bundle.schoolId) ?? []
  if (bundle.counselorId) {
    // counselor_id names an AFFILIATION; the map only holds active ones,
    // so an ended affiliation falls through to everyone at the school.
    const chosen = all.filter((c) => c.id === bundle.counselorId)
    if (chosen.length > 0) return chosen
  }
  return all
}

/** Classes a counselor's digest covers: registration still open, not cancelled. */
function digestClasses(bundles: ClassBundle[], schoolId: string): ClassBundle[] {
  return bundles.filter(
    (b) =>
      b.schoolId === schoolId &&
      b.status !== 'cancelled' &&
      localDate(b.timezone) <= registrationCloseFor(b)
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
        classType: b.classType,
        firstSession: b.firstSession,
        paid: paidCount(b),
        capacity: b.capacity,
        waitlistDepth: waitlistDepth(b),
        newSinceLast: b.enrollments.filter(
          (e) => e.enrolled_at >= since && e.payment_status !== 'Expired'
        ).length,
        regUrl: registrationUrlFor(b),
        materialsUrl: `${emailBaseUrl()}/portal`,
        // Only meaningful when the counselor has seen a previous digest —
        // otherwise there are no "posted copies" to replace yet.
        materialsUpdated:
          counselor.digest_last_sent_at != null &&
          b.collateralChangedAt != null &&
          b.collateralChangedAt >= counselor.digest_last_sent_at,
      }))

      const frequencyUrls = {
        weekly: digestFrequencyUrlFor(counselor.id, 'weekly'),
        biweekly: digestFrequencyUrlFor(counselor.id, 'biweekly'),
        monthly: digestFrequencyUrlFor(counselor.id, 'monthly'),
        paused: digestFrequencyUrlFor(counselor.id, 'paused'),
      }
      // PL-66: registry copy when CD is flipped live; code twin otherwise.
      const { subject, html } = await renderRegistered(
        'CD_COUNSELOR_DIGEST',
        {
          parentFirstName: counselor.first_name,
          parentEmail: counselor.email,
          schoolNickname: classes[0].schoolLabel,
          schoolName: classes[0].schoolName,
        },
        {
          counselorFirstName: counselor.first_name,
          digestCountSummary: digestSubjectCount(infos),
          digestClassListBlock: digestClassListHtml(infos),
          digestFrequencyBlock: digestFrequencyHtml(frequencyUrls),
        },
        () =>
          counselorDigestEmail({
            counselorFirst: counselor.first_name,
            schoolName: classes[0].schoolName,
            schoolNickname: classes[0].schoolLabel,
            classes: infos,
            frequencyUrls,
          })
      )
      const status = await sendOnce({
        dedupeKey: `counselor_digest:${counselor.id}:${today}`,
        emailType: 'counselor_digest',
        templateKey: 'CD_COUNSELOR_DIGEST',
        to: [counselor.email],
        subject,
        html,
      })
      if (status === 'sent') {
        await supabase
          .from('school_affiliations')
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
  const counselors = contactsForClass(bundle, counselorsBySchool)
  if (counselors.length === 0) return

  const today = localDate(bundle.timezone)
  if (today > registrationCloseFor(bundle)) return
  const deadline = bundle.enrollmentDeadline ?? bundle.firstSession
  const window = [addDaysISO(deadline, -3), addDaysISO(deadline, -1)]
  if (today < window[0] || today > window[1]) return
  if (localHour(bundle.timezone) < 8) return

  // FP-alt replaces the FP series when PAID count reaches capacity (deck
  // trigger). Spots can also all be *held* by pending registrations and
  // unexpired waitlist offers without being paid — then neither email is
  // honest ("0 spots open" / "class is full"), so send nothing that day.
  const paid = paidCount(bundle)
  const full = paid >= bundle.capacity
  const spotsLeft = bundle.capacity - spotsTaken(bundle)
  if (!full && spotsLeft <= 0) return
  const daysToDeadline = Math.round(
    (new Date(deadline + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) /
      86_400_000
  )

  for (const counselor of counselors) {
    if (full) {
      const { subject, html } = await renderRegistered(
        'FP_ALT_CLASS_FULL',
        {
          parentFirstName: counselor.first_name,
          parentEmail: counselor.email,
          schoolNickname: bundle.schoolLabel,
          classType: bundle.classType,
          schoolName: bundle.schoolName,
        },
        {
          counselorFirstName: counselor.first_name,
          waitlistDepth: String(waitlistDepth(bundle)),
          registrationLink: registrationUrlFor(bundle),
        },
        () =>
          classFullNoticeEmail({
            counselorFirst: counselor.first_name,
            label: `${bundle.schoolLabel} ${bundle.classType}`,
            capacity: bundle.capacity,
            waitlistDepth: waitlistDepth(bundle),
            regUrl: registrationUrlFor(bundle),
          })
      )
      const status = await sendOnce({
        dedupeKey: `class_full_notice:${bundle.id}:${counselor.id}`,
        emailType: 'class_full_notice',
        templateKey: 'FP_ALT_CLASS_FULL',
        to: [counselor.email],
        subject,
        html,
      })
      if (status === 'sent') bump(c, 'class_full_notice')
    } else {
      const { subject, html } = await renderRegistered(
        'FP_DEADLINE_PUSH',
        {
          parentFirstName: counselor.first_name,
          parentEmail: counselor.email,
          schoolNickname: bundle.schoolLabel,
          classType: bundle.classType,
          schoolName: bundle.schoolName,
        },
        {
          counselorFirstName: counselor.first_name,
          deadlineCountdown: daysToDeadline === 1 ? 'Last day' : `${daysToDeadline} days left`,
          spotsLeftPhrase: `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'}`,
          enrolledCountLine: `${paid} of ${bundle.capacity} enrolled`,
          registrationLink: registrationUrlFor(bundle),
        },
        () =>
          deadlinePushEmail({
            counselorFirst: counselor.first_name,
            label: `${bundle.schoolLabel} ${bundle.classType}`,
            spotsLeft,
            daysToDeadline,
            paidCount: paid,
            capacity: bundle.capacity,
            regUrl: registrationUrlFor(bundle),
          })
      )
      const status = await sendOnce({
        dedupeKey: `deadline_push:${bundle.id}:${counselor.id}:${today}`,
        emailType: 'deadline_push',
        templateKey: 'FP_DEADLINE_PUSH',
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
  const counselors = contactsForClass(bundle, counselorsBySchool)
  if (counselors.length === 0) return
  if (localHour(bundle.timezone) < 8) return

  const CR_KEYS = ['CR_CLASSROOM_REQUEST', 'CR_CLASSROOM_NUDGE_2', 'CR_CLASSROOM_NUDGE_3'] as const
  const sendAsk = async (nudge: number) => {
    for (const counselor of counselors) {
      const formUrl = classroomRequestUrlFor(bundle.id, counselor.email)
      const { subject, html } = await renderRegistered(
        CR_KEYS[nudge] ?? 'CR_CLASSROOM_REQUEST',
        {
          parentFirstName: counselor.first_name,
          parentEmail: counselor.email,
          schoolNickname: bundle.schoolLabel,
          classType: bundle.classType,
          schoolName: bundle.schoolName,
          firstSession: bundle.firstSession,
        },
        { counselorFirstName: counselor.first_name, classroomFormLink: formUrl },
        () =>
          classroomRequestEmail({
            counselorFirst: counselor.first_name,
            schoolNickname: bundle.schoolLabel,
            schoolName: bundle.schoolName,
            classType: bundle.classType,
            firstSession: bundle.firstSession,
            formUrl,
            nudge,
          })
      )
      const status = await sendOnce({
        dedupeKey: `classroom_request:${bundle.id}:${counselor.id}:${nudge}`,
        emailType: 'classroom_request',
        templateKey: CR_KEYS[nudge] ?? 'CR_CLASSROOM_REQUEST',
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
    // Cancelled classes send NOTHING, ever — the cancellation emails went out
    // from the admin confirm; every scheduled send derives from this status
    // (PHASE4_SPEC §12: atomic suppression). Feature A: any still-scheduled
    // email_sends rows for the class get audit-cancelled.
    if (bundle.status === 'cancelled') {
      const n = await cancelScheduledForClass(bundle.id, 'class cancelled')
      if (n > 0) counters.comms_cancelled = (counters.comms_cancelled ?? 0) + n
      continue
    }
    // Dead-class guard: a month after the last session there is nothing left
    // to send — skip entirely (prevents eternal hold-alerts on old classes).
    if (localDate(bundle.timezone) > addDaysISO(bundle.lastSession, 30)) {
      const n = await cancelScheduledForClass(bundle.id, 'class ended (30-day guard)')
      if (n > 0) counters.comms_cancelled = (counters.comms_cancelled ?? 0) + n
      continue
    }

    // Feature A projector: materialize/reconcile this class's upcoming sends
    // BEFORE the send passes, so held/cancelled/rescheduled rows exist for
    // sendOnce to honor and the dashboard's Upcoming tab reflects reality.
    const proj = await projectScheduledSends(bundle, packages.pre)
    if (proj.inserted > 0) counters.comms_projected = (counters.comms_projected ?? 0) + proj.inserted
    if (proj.retimed > 0) counters.comms_retimed = (counters.comms_retimed ?? 0) + proj.retimed
    if (proj.cancelled > 0) counters.comms_cancelled = (counters.comms_cancelled ?? 0) + proj.cancelled

    await sweepPaymentReminders(bundle, counters)
    // PL-78/79: welcome backfill, Monday digest, closed ping, calendar
    // converge — everything gated on instructors.comms_enabled and deduped,
    // so the hourly re-run IS the backfill mechanism.
    const inres = await sweepInstructorComms(bundle)
    if (inres.welcomed > 0) counters.instructor_welcomed = (counters.instructor_welcomed ?? 0) + inres.welcomed
    if (inres.digested > 0) counters.instructor_digested = (counters.instructor_digested ?? 0) + inres.digested
    await syncInstructorClassCalendar(bundle)
    await sweepCompletion(bundle, counters)
    await sweepThankYou(bundle, counters)
    await sweepUpsell(bundle, counters, packages.pre)
    await sweepSequence(bundle, counters, packages.post)
    await sweepScheduleUpdates(bundle, counters)
    await sweepWaitlist(bundle, counters)
    await sweepAdminCheckpoints(bundle, counters)
    await sweepInstructorNudges(bundle, counters)
    await sweepDeadlinePush(bundle, counselorsBySchool, counters)
    await sweepClassroomRequests(bundle, counselorsBySchool, counters)
  }
  await sweepCounselorDigests(bundles, counselorsBySchool, counters)
  await sweepAdminRosterReport(bundles, counters)

  // Phase 6: retry/backup pass over the QBO queue (the webhook's after()
  // trigger is the fast path) + the daily expired-connection nag.
  const qbo = await processQboQueue()
  if (qbo.synced > 0) counters.qbo_synced = qbo.synced
  if (qbo.failed > 0) counters.qbo_failed = qbo.failed
  if (qbo.deferred > 0) counters.qbo_deferred = qbo.deferred
  if ((await sweepQboHealth()) === 'alerted') bump(counters, 'qbo_expired_alert')

  // Phase 7a: retry/backup pass over the Google Calendar push queue (the
  // scheduling routes' after() triggers are the fast path).
  const gcal = await processGcalQueue()
  if (gcal.synced > 0) counters.gcal_synced = gcal.synced
  if (gcal.failed > 0) counters.gcal_failed = gcal.failed
  if (gcal.deferred > 0) counters.gcal_deferred = gcal.deferred

  // Phase 7b: past sessions auto-complete (tutors only correct exceptions),
  // then the daily timecard sweep — builds cards for the last closed
  // semi-monthly period, keeps open ones in step with late corrections, and
  // sends T5 once per new card. All idempotent.
  const completed = await autoCompleteSessions()
  if (completed > 0) counters.sessions_auto_completed = completed
  const tc = await sweepTimecards()
  if (tc.created > 0) counters.timecards_created = tc.created
  if (tc.t5Sent > 0) counters.timecards_t5_sent = tc.t5Sent

  // Phase 7c: the monthly billing cycle (spec §6). Generation fires on the
  // settings day (default the 20th, Denver); the proposal sweep (T1b nudge +
  // auto-confirm) and the collection sweep (unbilled catch-up, autopay
  // retries, 10/30-day escalation) run daily. Everything idempotent —
  // re-runs and generation-day repeats dedupe away.
  try {
    const cycleSettings = await loadCycleSettings()
    const denverDay = Number(
      new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }).slice(8, 10)
    )
    if (denverDay === cycleSettings.generateDay) {
      const gen = await generateMonthlyCycle()
      if (gen.sessionsCreated > 0) counters.billing_sessions_generated = gen.sessionsCreated
      if (gen.invoicesProposed > 0) counters.billing_invoices_proposed = gen.invoicesProposed
      if (gen.t1Sent > 0) counters.billing_t1_sent = gen.t1Sent
    }
    const proposals = await sweepProposals()
    if (proposals.nudged > 0) counters.billing_nudged = proposals.nudged
    if (proposals.autoConfirmed > 0) counters.billing_auto_confirmed = proposals.autoConfirmed
    const collections = await sweepCollections()
    if (collections.issued > 0) counters.billing_issued = collections.issued
    if (collections.retried > 0) counters.billing_retried = collections.retried
    if (collections.reminders > 0) counters.billing_reminders = collections.reminders
    if (collections.lateFeeFlags > 0) counters.billing_late_fee_flags = collections.lateFeeFlags
    // PL-53c: add-on scheduling nudge (+7d) and stall alert (+14d).
    await sweepAddonSchedulingNudges(counters)
    // PL-41: schedule-approval nudges (+2d, +5d + Ops alert; never auto-approves).
    const approvals = await runScheduleApprovalNudges()
    if (approvals.nudged > 0) counters.schedule_approval_nudged = approvals.nudged
    if (approvals.alerted > 0) counters.schedule_approval_alerted = approvals.alerted
    // PL-63: automatic agreement chase (+3d, +7d + Ops alert; stops on acceptance).
    const agreements = await runAgreementNudges()
    if (agreements.nudged1 > 0) counters.agreement_nudged_1 = agreements.nudged1
    if (agreements.nudged2 > 0) counters.agreement_nudged_2 = agreements.nudged2
    if (agreements.alerted > 0) counters.agreement_alerted = agreements.alerted
    // PL-81: due coalesced tutor schedule notices (45-min window, 3-h cap;
    // urgent ones already went out inline at change time).
    const tutorNotices = await sweepPendingTutorNotices()
    if (tutorNotices > 0) counters.tutor_notices_sent = tutorNotices
    // PL-86: the demoted CX_TUTORING_START — a self-serve conversion that
    // hasn't shared availability after a day gets the one follow-up (the
    // once-ever dedupe key means receipt OR nudge, never both).
    const cxFollowups = await sweepConversionFollowups()
    if (cxFollowups > 0) counters.conversion_followups = cxFollowups
  } catch (e) {
    console.error('tutoring billing sweep failed (continuing):', e)
  }

  return NextResponse.json({ ok: true, classes: bundles.length, actions: counters })
}
