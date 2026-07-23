import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from "./supabase-admin"
import { createHmac, timingSafeEqual } from 'crypto'
import { availabilityToken } from './intake'
import type { EnrollmentEmailContext, SessionInfo } from './email'
import { bySessionStart } from './dates'

// Shared plumbing for the email lifecycle: loads every class with its school,
// sessions, and enrollments in one query, and provides the timezone-aware
// date math the sweep and webhook both use. All scheduling is derived from
// current DB state on every run — rescheduling a class automatically
// recomputes every pending send.

export const DEFAULT_TIMEZONE = process.env.CLASS_TIMEZONE ?? 'America/Mexico_City'
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'williamraymondthomas@gmail.com'

/** Internal ops notifications (instructor scheduling nudge) — info@ to info@,
 * consistent with other admin-facing sends (addendum §7.4). */
export const INTERNAL_EMAIL = process.env.INTERNAL_EMAIL ?? 'info@highergroundlearning.com'

// Recipient for the ADMIN-side registration notification + weekly admin
// roster report (July 8 punch list). These are internal ops emails — strictly
// separate from the Phase 4 counselor digest.
// TODO: switch to INTERNAL_EMAIL (info@highergroundlearning.com) once the
// format is confirmed in testing.
export const REGISTRATION_NOTIFY_EMAIL = 'billy@highergroundlearning.com'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AddonRow = {
  name: string
  hours: number
  pricePaid: number
}

export type TutoringPackage = {
  id: string
  name: string
  hours: number
  hourlyRate: number
  packagePrice: number
  regularHourlyRate: number
  phase: 'pre_class' | 'post_class'
}

export type EnrollmentRow = {
  id: string
  payment_status: 'Pending' | 'Paid' | 'Completed' | 'Expired' | 'Waitlisted' | 'Refunded'
  enrolled_at: string
  paid_at: string | null
  amountPaid: number | null
  accommodations: string | null
  previousScores: string | null
  notes: string | null
  graduatingYear: string | null
  addons: AddonRow[]
  waitlist_offer_sent_at: string | null
  waitlist_offer_expires_at: string | null
  familyId: string
  pronouns: string | null
  marketingOptOut: boolean
  parentFirstName: string
  parentEmail: string
  studentFirstName: string
  studentLastName: string
  studentEmail: string | null
}

export type ClassBundle = {
  id: string
  slug: string | null
  /** open | cancelled — cancelled suppresses every scheduled send (§12). */
  status: string
  /** Optional per-class school contact (a school_affiliations.id — addendum §6);
   * class-specific sends target that affiliation's contact. */
  counselorId: string | null
  classType: string
  schoolId: string | null
  schoolName: string
  schoolLabel: string
  timezone: string
  instructorId: string | null
  instructorName: string | null
  instructorEmail: string | null
  defaultLocation: string | null
  synapGroup: string | null
  price: number
  capacity: number
  minEnrollment: number
  deliveryMode: string
  enrollmentDeadline: string | null
  registrationCloseDate: string | null
  startDate: string
  sessions: SessionInfo[]
  firstSession: string // falls back to start_date when no sessions exist
  lastSession: string
  enrollments: EnrollmentRow[]
  /** Last time a collateral-visible detail changed (Phase 4.5 §8) —
   *  DB-trigger-maintained, drives the digest's "materials updated" flag. */
  collateralChangedAt: string | null
}

// ---------------------------------------------------------------------------
// Timezone-aware date helpers (all dates are YYYY-MM-DD strings)
// ---------------------------------------------------------------------------

export function localDate(tz: string, d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

export function localHour(tz: string, d: Date = new Date()): number {
  return Number(d.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })) % 24
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** True once the school-local clock has reached `hour` on `targetDate`. */
export function isDue(tz: string, targetDate: string, hour: number): boolean {
  const today = localDate(tz)
  return today > targetDate || (today === targetDate && localHour(tz) >= hour)
}

export function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

// ---------------------------------------------------------------------------
// The post-payment sequence (offsets from first/last session)
// ---------------------------------------------------------------------------

export type SequenceStep = {
  type: string
  anchor: 'first' | 'last'
  offsetDays: number
  hour: number
  /** Hold and alert admin instead of sending when instructor/room are blank. */
  holdOnBlankDetails?: boolean
}

export const SEQUENCE: SequenceStep[] = [
  { type: 'synap_access', anchor: 'first', offsetDays: -10, hour: 8 },
  { type: 'faq', anchor: 'first', offsetDays: -7, hour: 8 },
  { type: 'class_details', anchor: 'first', offsetDays: -4, hour: 8, holdOnBlankDetails: true },
  { type: 'location_reminder', anchor: 'first', offsetDays: -1, hour: 11 },
  { type: 'second_diagnostic', anchor: 'first', offsetDays: 7, hour: 8 },
  { type: 'review_request', anchor: 'last', offsetDays: 1, hour: 8 },
  { type: 'tutoring_offer', anchor: 'last', offsetDays: 4, hour: 8 },
]

export function stepTargetDate(step: SequenceStep, bundle: ClassBundle): string {
  const anchor = step.anchor === 'first' ? bundle.firstSession : bundle.lastSession
  return addDaysISO(anchor, step.offsetDays)
}

// Payment reminder ladder for Pending enrollments (hours since registration),
// then expiry at 168h (7 days).
export const PAYMENT_REMINDERS = [
  { n: 1, afterHours: 2 },
  { n: 2, afterHours: 24 },
  { n: 3, afterHours: 72 },
  { n: 4, afterHours: 144 },
]
export const PAYMENT_EXPIRY_HOURS = 168

export const WAITLIST_CLAIM_HOURS = 48

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function loadClassBundles(classId?: string): Promise<ClassBundle[]> {
  let query = supabase.from('classes').select(
    `
    id, slug, status, counselor_id, class_type, school_id, instructor_id,
    default_location, synap_group, price, capacity, min_enrollment,
    delivery_mode, enrollment_deadline, registration_close_date, start_date,
    collateral_changed_at,
    schools ( name, nickname, timezone ),
    instructors ( name, email ),
    sessions ( id, session_date, start_time, end_time, location ),
    enrollments (
      id, payment_status, enrolled_at, paid_at, amount_paid,
      accommodations, previous_scores, notes,
      waitlist_offer_sent_at, waitlist_offer_expires_at,
      enrollment_addons ( hours, price_paid, tutoring_packages ( name ) ),
      students (
        first_name, last_name, student_email, graduating_year, pronouns,
        families ( id, parent_first_name, parent_email, marketing_opt_out )
      )
    )
  `
  )
  if (classId) query = query.eq('id', classId)
  const { data, error } = await query

  if (error || !data) {
    console.error('loadClassBundles failed:', error?.message)
    return []
  }

  return (data as any[]).map((c) => {
    const school = one<any>(c.schools)
    const instructor = one<any>(c.instructors)
    const sessions: SessionInfo[] = [...(c.sessions ?? [])].sort(bySessionStart)
    const enrollments: EnrollmentRow[] = (c.enrollments ?? [])
      .map((e: any) => {
        const student = one<any>(e.students)
        const family = one<any>(student?.families)
        if (!student || !family) return null
        return {
          id: e.id,
          payment_status: e.payment_status,
          enrolled_at: e.enrolled_at,
          paid_at: e.paid_at ?? null,
          amountPaid: e.amount_paid != null ? Number(e.amount_paid) : null,
          accommodations: e.accommodations ?? null,
          previousScores: e.previous_scores ?? null,
          notes: e.notes ?? null,
          graduatingYear: student.graduating_year ?? null,
          addons: (e.enrollment_addons ?? []).map((a: any) => ({
            name: one<any>(a.tutoring_packages)?.name ?? 'Tutoring package',
            hours: Number(a.hours),
            pricePaid: Number(a.price_paid),
          })),
          waitlist_offer_sent_at: e.waitlist_offer_sent_at,
          waitlist_offer_expires_at: e.waitlist_offer_expires_at,
          familyId: family.id,
          pronouns: student.pronouns ?? null,
          marketingOptOut: family.marketing_opt_out ?? false,
          parentFirstName: family.parent_first_name,
          parentEmail: family.parent_email,
          studentFirstName: student.first_name,
          studentLastName: student.last_name,
          studentEmail: student.student_email ?? null,
        }
      })
      .filter(Boolean) as EnrollmentRow[]

    return {
      id: c.id,
      slug: c.slug ?? null,
      status: c.status ?? 'open',
      counselorId: c.counselor_id ?? null,
      classType: c.class_type,
      schoolId: c.school_id ?? null,
      schoolName: school?.name ?? school?.nickname ?? 'Higher Ground Learning',
      schoolLabel: school?.nickname ?? 'HGL',
      timezone: school?.timezone ?? DEFAULT_TIMEZONE,
      instructorId: c.instructor_id ?? null,
      instructorName: instructor?.name ?? instructor?.email ?? null,
      instructorEmail: instructor?.email ?? null,
      defaultLocation: c.default_location || null,
      synapGroup: c.synap_group || null,
      price: Number(c.price),
      capacity: c.capacity,
      // PL-61: a nonsensical stored minimum (Cape Town briefly had -1) must
      // never drive "runs (min -1 met)" verdicts — fall back to the default.
      minEnrollment:
        c.min_enrollment != null && Number(c.min_enrollment) >= 1
          ? Number(c.min_enrollment)
          : c.delivery_mode === 'online'
            ? 3
            : 8,
      deliveryMode: c.delivery_mode,
      enrollmentDeadline: c.enrollment_deadline,
      registrationCloseDate: c.registration_close_date ?? null,
      startDate: c.start_date,
      sessions,
      firstSession: sessions[0]?.session_date ?? c.start_date,
      lastSession: sessions[sessions.length - 1]?.session_date ?? c.start_date,
      enrollments,
      collateralChangedAt: c.collateral_changed_at ?? null,
    }
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function calendarPageUrlFor(classId: string) {
  const base = emailBaseUrl()
  return `${base}/classes/${classId}/calendar`
}

/**
 * #0's "View your registration" button (PHASE4_SPEC §9). With a session,
 * /portal deep-links to the enrollment card; without one, the proxy bounces
 * to /login carrying pe/pt so the email is prefilled — one tap for the link.
 * The pt HMAC matches portal-auth's loginPrefillToken.
 */
export function portalDeepLinkFor(enrollmentId: string, parentEmail: string) {
  const base = emailBaseUrl()
  const email = parentEmail.trim().toLowerCase()
  const token = createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`login:${email}`)
    .digest('hex')
    .slice(0, 32)
  return `${base}/portal?enrollment=${enrollmentId}&pe=${encodeURIComponent(email)}&pt=${token}`
}

export function emailContext(bundle: ClassBundle, e: EnrollmentRow): EnrollmentEmailContext {
  return {
    enrollmentId: e.id,
    classId: bundle.id,
    calendarPageUrl: calendarPageUrlFor(bundle.id),
    resumePaymentUrl: resumePaymentUrlFor(e.id),
    portalUrl: portalDeepLinkFor(e.id, e.parentEmail),
    // Always first session minus one day — computed, never stored.
    diagnosticDueDate: addDaysISO(bundle.firstSession, -1),
    addons: e.addons,
    marketingOptOut: e.marketingOptOut,
    unsubscribeUrl: unsubscribeUrlFor(e.familyId),
    availabilityUrl: availabilityUrlFor(e.familyId),
    parentFirstName: e.parentFirstName,
    parentEmail: e.parentEmail,
    studentFirstName: e.studentFirstName,
    studentLastName: e.studentLastName,
    studentEmail: e.studentEmail,
    studentPronouns: e.pronouns,
    graduatingYear: e.graduatingYear,
    accommodations: e.accommodations,
    previousScores: e.previousScores,
    notes: e.notes,
    amountPaid: e.amountPaid,
    paidAt: e.paid_at,
    enrolledAt: e.enrolled_at,
    schoolName: bundle.schoolName,
    schoolNickname: bundle.schoolLabel,
    classType: bundle.classType,
    className: `${bundle.schoolLabel} ${bundle.classType}`,
    classTime: classTimeFor(bundle.sessions),
    examInfo: examInfoFor(bundle.classType),
    instructorName: bundle.instructorName,
    defaultLocation: bundle.defaultLocation,
    deliveryMode: bundle.deliveryMode,
    synapGroup: bundle.synapGroup,
    startDate: bundle.startDate,
    firstSession: bundle.firstSession,
    lastSession: bundle.lastSession,
    price: bundle.price,
    sessions: bundle.sessions,
  }
}

/**
 * Registration (and new waitlist offers) close after this date. Default is
 * the first session; registration_close_date overrides per class (e.g. the
 * third session's date to allow joining after missing one or two).
 */
export function registrationCloseFor(bundle: ClassBundle): string {
  return bundle.registrationCloseDate ?? bundle.firstSession
}

/** Spots taken = Pending + Paid + waitlisted holders of an unexpired offer. */
export function spotsTaken(bundle: ClassBundle): number {
  const now = Date.now()
  return bundle.enrollments.filter(
    (e) =>
      e.payment_status === 'Pending' ||
      e.payment_status === 'Paid' ||
      (e.payment_status === 'Waitlisted' &&
        e.waitlist_offer_expires_at != null &&
        new Date(e.waitlist_offer_expires_at).getTime() > now)
  ).length
}

// ---------------------------------------------------------------------------
// Waitlist claim links: signed so positions can't be claimed by guessing ids
// ---------------------------------------------------------------------------

function claimToken(enrollmentId: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(enrollmentId)
    .digest('hex')
    .slice(0, 32)
}

export function claimUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/api/waitlist/claim?e=${enrollmentId}&t=${claimToken(enrollmentId)}`
}

export function verifyClaimToken(enrollmentId: string, token: string) {
  const expected = Buffer.from(claimToken(enrollmentId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// PL-72: decline links — distinct HMAC prefix so a decline token can never
// double as a claim token (or vice versa).
function declineToken(enrollmentId: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`decline:${enrollmentId}`)
    .digest('hex')
    .slice(0, 32)
}

export function declineUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/waitlist/decline?e=${enrollmentId}&t=${declineToken(enrollmentId)}`
}

export function verifyDeclineToken(enrollmentId: string, token: string) {
  const expected = Buffer.from(declineToken(enrollmentId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Active tutoring packages, split by phase. All pricing comes from here. */
export async function loadTutoringPackages(): Promise<{
  pre: TutoringPackage[]
  post: TutoringPackage[]
}> {
  const { data, error } = await supabase
    .from('tutoring_packages')
    .select('id, name, hours, hourly_rate, package_price, regular_hourly_rate, phase')
    .eq('active', true)
    .order('hours')
  if (error || !data) {
    console.error('loadTutoringPackages failed:', error?.message)
    return { pre: [], post: [] }
  }
  const all: TutoringPackage[] = data.map((p) => ({
    id: p.id,
    name: p.name,
    hours: Number(p.hours),
    hourlyRate: Number(p.hourly_rate),
    packagePrice: Number(p.package_price),
    regularHourlyRate: Number(p.regular_hourly_rate),
    phase: p.phase,
  }))
  return {
    pre: all.filter((p) => p.phase === 'pre_class'),
    post: all.filter((p) => p.phase === 'post_class'),
  }
}

export function packageSavings(p: TutoringPackage) {
  return p.hours * p.regularHourlyRate - p.packagePrice
}

/**
 * {classTime}: if every session shares one time range, render it;
 * otherwise the copy says "see the class calendar".
 */
export function classTimeFor(sessions: SessionInfo[]): string | null {
  const withTimes = sessions.filter((s) => s.start_time)
  if (withTimes.length === 0 || withTimes.length !== sessions.length) return null
  const key = (s: SessionInfo) => `${s.start_time}|${s.end_time ?? ''}`
  if (!withTimes.every((s) => key(s) === key(withTimes[0]))) return null
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 === 0 ? 12 : h % 12
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
  }
  const first = withTimes[0]
  return first.end_time
    ? `${fmt(first.start_time as string)} to ${fmt(first.end_time)}`
    : fmt(first.start_time as string)
}

/** Exam family from class_type: drives the exam-registration FAQ answer. */
export function examInfoFor(classType: string): { examName: string; regLabel: string; regUrl: string } | null {
  if (/sat/i.test(classType)) {
    return { examName: 'SAT', regLabel: 'College Board Website', regUrl: 'https://www.collegeboard.org' }
  }
  if (/act/i.test(classType)) {
    return { examName: 'ACT', regLabel: 'ACT Website', regUrl: 'https://www.act.org' }
  }
  return null
}

// Resume-payment links for the PR1-4 "Finalize Registration" buttons.
// Distinct HMAC prefix, as with claim/unsubscribe/addon tokens.
function resumeToken(enrollmentId: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`resume:${enrollmentId}`)
    .digest('hex')
    .slice(0, 32)
}

export function resumePaymentUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/api/resume-payment?e=${enrollmentId}&t=${resumeToken(enrollmentId)}`
}

export function verifyResumeToken(enrollmentId: string, token: string) {
  const expected = Buffer.from(resumeToken(enrollmentId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// Per-enrollment add-on page links (email #9). Distinct HMAC prefix, as with
// claim and unsubscribe tokens.
function addonToken(enrollmentId: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`addon:${enrollmentId}`)
    .digest('hex')
    .slice(0, 32)
}

export function addonPageUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/addons/${enrollmentId}?t=${addonToken(enrollmentId)}`
}

export function verifyAddonToken(enrollmentId: string, token: string) {
  const expected = Buffer.from(addonToken(enrollmentId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// Unsubscribe links (relationship emails only). Distinct HMAC input prefix so
// claim tokens and unsubscribe tokens can never be swapped for each other.
function unsubToken(familyId: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`unsub:${familyId}`)
    .digest('hex')
    .slice(0, 32)
}

/** PL-53b: the family's signed share-your-availability page. */
export function availabilityUrlFor(familyId: string) {
  const base = emailBaseUrl()
  return `${base}/availability/${availabilityToken(familyId)}`
}

export function unsubscribeUrlFor(familyId: string) {
  const base = emailBaseUrl()
  return `${base}/api/unsubscribe?f=${familyId}&t=${unsubToken(familyId)}`
}

export function verifyUnsubToken(familyId: string, token: string) {
  const expected = Buffer.from(unsubToken(familyId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Public registration link for a class (slug preferred, uuid fallback). */
export function registrationUrlFor(bundle: Pick<ClassBundle, 'id' | 'slug'>) {
  const base = emailBaseUrl()
  return `${base}/register/${bundle.slug ?? bundle.id}`
}

// Counselor digest frequency links (PHASE4_SPEC §4a): tokenized one-click,
// no login. One token per school AFFILIATION (digest prefs live there, so a
// two-school contact manages each independently); the freq travels as a
// plain param. Distinct HMAC prefix, as with the other signed-link families.
function digestToken(affiliationId: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`digest:${affiliationId}`)
    .digest('hex')
    .slice(0, 32)
}

export function digestFrequencyUrlFor(affiliationId: string, frequency: string) {
  const base = emailBaseUrl()
  return `${base}/api/counselor-digest/frequency?c=${affiliationId}&f=${frequency}&t=${digestToken(affiliationId)}`
}

export function verifyDigestToken(affiliationId: string, token: string) {
  const expected = Buffer.from(digestToken(affiliationId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// Classroom-request form links (PHASE4_SPEC §4b): single-question tokenized
// form, no login. `ce` (counselor email) rides along so we know who answered.
function classroomRequestToken(classId: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`room:${classId}`)
    .digest('hex')
    .slice(0, 32)
}

export function classroomRequestUrlFor(classId: string, counselorEmail: string) {
  const base = emailBaseUrl()
  return `${base}/classroom-request/${classId}?t=${classroomRequestToken(classId)}&ce=${encodeURIComponent(counselorEmail)}`
}

export function verifyClassroomRequestToken(classId: string, token: string) {
  const expected = Buffer.from(classroomRequestToken(classId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function classDetailsSnapshot(bundle: ClassBundle) {
  return {
    first_session: bundle.firstSession,
    location: bundle.defaultLocation,
    instructor: bundle.instructorName,
  }
}
