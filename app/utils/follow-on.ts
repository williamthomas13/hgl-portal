import { supabaseAdmin as supabase } from './supabase-admin'
import { emailBaseUrl } from './base-url'
import { mintToken, checkToken } from './signing'
import { renderDbEmail } from './comms-db-render'
import { sendOnce } from './email'
import { emailContext, isDue, localDate, type ClassBundle } from './lifecycle'

// PL-279: the FO follow-on campaign — PL-274 amendment D's mechanics.
//
// Shape: a FEEDER class points at an open-enrollment FOLLOW-ON class
// (classes.follow_on_class_id). Each feeder cohort gets a rolling window
// anchored on ITS OWN last session: announce the day after the class ends,
// remind two days before the cohort's discount deadline, and — only when an
// admin deliberately extends (fo_extended_until) — the "Bad News, Great
// News" extension pair. ONE shared discount code (the follow-on class's
// promo_code) is validated per cohort: {endDate} and the checkout seam both
// compute from the RECIPIENT's feeder schedule, never a global date.
//
// The send engine renders REGISTRY-ONLY (renderDbEmail, no code twin): a
// draft template renders null and nothing sends — flipping the FO templates
// live in the editor IS the go-live switch, which is exactly the "samples
// before the sequence goes live" sign-off gate. Family marketing opt-out is
// honored; a family with any live registration in the follow-on class is
// suppressed at every stage.

export const FO_TEMPLATES = {
  announce: { parent: 'FO_ANNOUNCE_PARENT', student: 'FO_ANNOUNCE_STUDENT' },
  reminder: { parent: 'FO_REMINDER_PARENT', student: 'FO_REMINDER_STUDENT' },
  extension: { parent: 'FO_EXTENSION_PARENT', student: 'FO_EXTENSION_STUDENT' },
} as const
export type FoStage = keyof typeof FO_TEMPLATES

export {
  FO_WINDOW_DAYS,
  FO_REMINDER_BEFORE_DAYS,
  FO_EXTENSION_DAYS,
  FO_SEND_HOUR,
  cohortWindow,
  extensionTarget,
  foLongDate,
  type CohortWindow,
} from './follow-on-shared'
import { FO_SEND_HOUR, cohortWindow, foLongDate, type CohortWindow } from './follow-on-shared'

// ---------------------------------------------------------------------------
// Tokenized auto-apply links ('fo:' prefix; composite id like 'roster:')
// ---------------------------------------------------------------------------

export function foToken(enrollmentId: string, followOnClassId: string): string {
  return mintToken('fo:', `${enrollmentId}:${followOnClassId}`, 'family-form')
}

export function checkFoToken(
  enrollmentId: string,
  followOnClassId: string,
  token: string
): 'ok' | 'expired' | 'invalid' {
  return checkToken('fo:', `${enrollmentId}:${followOnClassId}`, token, 'family-form')
}

// ---------------------------------------------------------------------------
// The follow-on target (the open class being marketed)
// ---------------------------------------------------------------------------

export type FollowOnTarget = {
  id: string
  slug: string | null
  classType: string
  status: string
  schoolId: string | null
  shortName: string
  promoCode: string | null
  promoAmount: number | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadFollowOnTarget(classId: string): Promise<FollowOnTarget | null> {
  const { data } = await supabase
    .from('classes')
    .select('id, slug, class_type, status, school_id, fo_short_name, promo_code, promo_amount')
    .eq('id', classId)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    slug: data.slug,
    classType: data.class_type,
    status: data.status,
    schoolId: data.school_id,
    shortName: (data.fo_short_name as string | null)?.trim() || data.class_type,
    promoCode: (data.promo_code as string | null)?.trim() || null,
    promoAmount: data.promo_amount != null ? Number(data.promo_amount) : null,
  }
}

/** The campaign runs only when the target is a live open-enrollment class
 *  with a complete promo (code + amount) — PL-266 completeness discipline. */
export function foTargetReady(target: FollowOnTarget | null): target is FollowOnTarget {
  return Boolean(
    target &&
      target.status !== 'cancelled' &&
      target.schoolId === null &&
      target.promoCode &&
      target.promoAmount != null &&
      target.promoAmount > 0
  )
}

/** The ctx.followOn payload — every FO composer variable resolves from this. */
export function followOnOfferFor(
  target: FollowOnTarget,
  window: CohortWindow,
  enrollmentId: string
) {
  const token = foToken(enrollmentId, target.id)
  return {
    className: target.classType,
    shortName: target.shortName,
    registrationLink: `${emailBaseUrl()}/register/${target.slug ?? target.id}?fo=${encodeURIComponent(token)}&fe=${enrollmentId}`,
    discountAmount: `$${Number(target.promoAmount).toFixed(0)}`,
    discountCode: target.promoCode ?? '',
    endDate: foLongDate(window.deadline),
  }
}

// ---------------------------------------------------------------------------
// Checkout-side validation (the discount seam) — token path AND typed-code
// fallback, both computing expiry from the recipient's feeder cohort.
// ---------------------------------------------------------------------------

type FeederRow = { id: string; lastSession: string; foExtendedUntil: string | null }

async function loadFeeder(classId: string): Promise<FeederRow | null> {
  const { data } = await supabase
    .from('classes')
    .select('id, start_date, fo_extended_until, follow_on_class_id, sessions ( session_date )')
    .eq('id', classId)
    .maybeSingle()
  if (!data) return null
  const dates = ((data.sessions as any[]) ?? []).map((s) => s.session_date).sort()
  return {
    id: data.id,
    lastSession: dates[dates.length - 1] ?? data.start_date,
    foExtendedUntil: data.fo_extended_until,
  }
}

export type FoDiscount = {
  ok: true
  amount: number
  code: string
  endDateIso: string
  endDate: string
  feederClassId: string
}
export type FoDiscountRefusal = { ok: false; reason: string }

/**
 * Validate a follow-on discount for a checkout at `classId` (the follow-on
 * class). Token path: `token` + `feederEnrollmentId` from the emailed link.
 * Code path: `code` typed at registration + the registering family's
 * `parentEmail`. Refusals are plain-English and safe to show families.
 */
export async function validateFollowOnDiscount(opts: {
  classId: string
  token?: string | null
  feederEnrollmentId?: string | null
  code?: string | null
  parentEmail?: string | null
}): Promise<FoDiscount | FoDiscountRefusal> {
  const target = await loadFollowOnTarget(opts.classId)
  if (!foTargetReady(target)) {
    return { ok: false, reason: 'This class has no discount offer right now.' }
  }

  const accept = (feeder: FeederRow): FoDiscount | FoDiscountRefusal => {
    const w = cohortWindow(feeder)
    // The cohort clock: valid through the END of the deadline day ("until
    // {endDate}" and stage 3's "at midnight" both mean the whole day).
    if (localDate('America/Denver') > w.deadline) {
      return {
        ok: false,
        reason: `This discount ended ${foLongDate(w.deadline)} — registration itself may still be open.`,
      }
    }
    return {
      ok: true,
      amount: target.promoAmount!,
      code: target.promoCode!,
      endDateIso: w.deadline,
      endDate: foLongDate(w.deadline),
      feederClassId: feeder.id,
    }
  }

  // --- token path (the emailed auto-apply link) ---------------------------
  if (opts.token && opts.feederEnrollmentId) {
    if (checkFoToken(opts.feederEnrollmentId, opts.classId, opts.token) !== 'ok') {
      return { ok: false, reason: 'This discount link is no longer valid — you can still type the code from your email.' }
    }
    const { data: enr } = await supabase
      .from('enrollments')
      .select('id, class_id, classes ( follow_on_class_id )')
      .eq('id', opts.feederEnrollmentId)
      .maybeSingle()
    const pointsHere = (one(enr?.classes) as any)?.follow_on_class_id === opts.classId
    if (!enr || !pointsHere) {
      return { ok: false, reason: 'This discount link is no longer valid — you can still type the code from your email.' }
    }
    const feeder = await loadFeeder(enr.class_id)
    if (!feeder) return { ok: false, reason: 'This discount link is no longer valid.' }
    return accept(feeder)
  }

  // --- typed-code fallback -------------------------------------------------
  if (opts.code && opts.parentEmail) {
    if (opts.code.trim().toUpperCase() !== target.promoCode!.toUpperCase()) {
      return { ok: false, reason: "That code doesn't match — check the spelling in your email." }
    }
    const email = opts.parentEmail.trim().toLowerCase()
    const { data: fams } = await supabase.from('families').select('id').ilike('parent_email', email)
    const familyIds = (fams ?? []).map((f) => f.id)
    if (familyIds.length === 0) {
      return {
        ok: false,
        reason: 'This code is for families from one of our partner classes — we could not find a matching registration for this email.',
      }
    }
    const { data: feeders } = await supabase
      .from('classes')
      .select('id, start_date, fo_extended_until, sessions ( session_date )')
      .eq('follow_on_class_id', opts.classId)
    let best: FoDiscount | FoDiscountRefusal = {
      ok: false,
      reason: 'This code is for families from one of our partner classes — we could not find a matching registration for this email.',
    }
    for (const f of (feeders as any[]) ?? []) {
      const { data: enrs } = await supabase
        .from('enrollments')
        .select('id, students!inner ( family_id )')
        .eq('class_id', f.id)
        .in('payment_status', ['Paid', 'Completed'])
        .in('students.family_id', familyIds)
        .limit(1)
      if (!enrs || enrs.length === 0) continue
      const dates = ((f.sessions as any[]) ?? []).map((s) => s.session_date).sort()
      const verdict = accept({
        id: f.id,
        lastSession: dates[dates.length - 1] ?? f.start_date,
        foExtendedUntil: f.fo_extended_until,
      })
      if (verdict.ok) return verdict
      best = verdict // an expired cohort beats "no registration found"
    }
    return best
  }

  return { ok: false, reason: 'No discount to apply.' }
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

// ---------------------------------------------------------------------------
// The hourly-sweep leg
// ---------------------------------------------------------------------------

export type FoAttempt = {
  stage: FoStage
  audience: 'parent' | 'student'
  enrollmentId: string
  dedupeKey: string
  to: string
  subject: string
  status: string
}

export type FoSweepReport = {
  ran: boolean
  reason?: string
  attempts: FoAttempt[]
  suppressed: string[] // enrollment ids skipped as already-registered
}

/**
 * One feeder bundle's FO pass. Called from the hourly sweep per class; also
 * called directly by the verify harness (which is why it reports instead of
 * only counting). Idempotent via sendOnce dedupe keys.
 */
export async function sweepFollowOnForBundle(bundle: ClassBundle): Promise<FoSweepReport> {
  const report: FoSweepReport = { ran: false, attempts: [], suppressed: [] }
  if (!bundle.followOnClassId) return { ...report, reason: 'no follow-on class linked' }
  if (bundle.status === 'cancelled') return { ...report, reason: 'feeder cancelled' }

  const target = await loadFollowOnTarget(bundle.followOnClassId)
  if (!foTargetReady(target)) {
    return { ...report, reason: 'follow-on class is not an open class with a complete promo (code + amount)' }
  }

  const window = cohortWindow({
    lastSession: bundle.lastSession,
    foExtendedUntil: bundle.foExtendedUntil,
  })
  const today = localDate(bundle.timezone)

  // Which stages are due right now (cohort clock = the feeder's timezone)?
  const stages: FoStage[] = []
  if (isDue(bundle.timezone, window.announceDate, FO_SEND_HOUR) && today <= window.deadline) {
    stages.push('announce')
  }
  if (isDue(bundle.timezone, window.reminderDate, FO_SEND_HOUR) && today <= window.baseDeadline) {
    stages.push('reminder')
  }
  if (window.extended && today <= window.deadline) {
    stages.push('extension')
  }
  if (stages.length === 0) return { ...report, reason: 'no stage due' }
  report.ran = true

  // Families already registered in the follow-on class are suppressed at
  // every stage (re-checked each sweep, so registering mid-sequence stops
  // the rest). Any live row counts — including a pending checkout.
  const familyIds = [...new Set(bundle.enrollments.map((e) => e.familyId))]
  const { data: registered } = await supabase
    .from('enrollments')
    .select('id, payment_status, students!inner ( family_id )')
    .eq('class_id', target.id)
    .in('students.family_id', familyIds)
  const registeredFamilies = new Set(
    ((registered as any[]) ?? [])
      .filter((r) => !['Cancelled', 'Expired', 'Refunded'].includes(r.payment_status))
      .map((r) => one<any>(r.students)?.family_id)
  )

  for (const e of bundle.enrollments) {
    // The audience: families who finished (or fully paid) the feeder class.
    if (e.payment_status !== 'Paid' && e.payment_status !== 'Completed') continue
    if (e.marketingOptOut) continue // marketing-shaped — the opt-out is honored
    if (registeredFamilies.has(e.familyId)) {
      report.suppressed.push(e.id)
      continue
    }

    const ctx = emailContext(bundle, e)
    ctx.followOn = followOnOfferFor(target, window, e.id)

    for (const stage of stages) {
      const keys = FO_TEMPLATES[stage]
      // Parent leg.
      const parent = await renderDbEmail(keys.parent, ctx, 'parent', {})
      if (parent) {
        const dedupeKey = `fo_${stage}:${e.id}`
        const status = await sendOnce({
          dedupeKey,
          emailType: `fo_${stage}`,
          enrollmentId: e.id,
          classId: bundle.id,
          to: [ctx.parentEmail],
          from: parent.from,
          subject: parent.subject,
          html: parent.html,
          bodySnapshotId: parent.versionId,
        })
        report.attempts.push({
          stage,
          audience: 'parent',
          enrollmentId: e.id,
          dedupeKey,
          to: ctx.parentEmail,
          subject: parent.subject,
          status,
        })
      }
      // Student leg (only when the student has an email).
      if (ctx.studentEmail) {
        const student = await renderDbEmail(keys.student, ctx, 'student', {})
        if (student) {
          const dedupeKey = `fo_${stage}_s:${e.id}`
          const status = await sendOnce({
            dedupeKey,
            emailType: `fo_${stage}`,
            enrollmentId: e.id,
            classId: bundle.id,
            to: [ctx.studentEmail],
            from: student.from,
            subject: student.subject,
            html: student.html,
            bodySnapshotId: student.versionId,
          })
          report.attempts.push({
            stage,
            audience: 'student',
            enrollmentId: e.id,
            dedupeKey,
            to: ctx.studentEmail,
            subject: student.subject,
            status,
          })
        }
      }
    }
  }
  return report
}
/* eslint-enable @typescript-eslint/no-explicit-any */
