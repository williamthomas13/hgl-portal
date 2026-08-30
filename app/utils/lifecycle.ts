import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from "./supabase-admin"
import { createHmac, timingSafeEqual } from 'crypto'
import { availabilityToken } from './intake'
import type { EnrollmentEmailContext, SessionInfo } from './email'
import { bySessionStart, formatDateFull as formatDate } from './dates'
import { checkToken, mintToken, signingSecret } from './signing'
import { classTutoringTier } from './tutoring-tier'
import { examFamilyFor } from './exam-family'

// Shared plumbing for the email lifecycle: loads every class with its school,
// sessions, and enrollments in one query, and provides the timezone-aware
// date math the sweep and webhook both use. All scheduling is derived from
// current DB state on every run — rescheduling a class automatically
// recomputes every pending send.

// PL-407: ops anchors Salt Lake City — the FALLBACK anywhere a timezone is
// assumed is America/Denver (labeled "Salt Lake City time" per PL-398). The
// old America/Mexico_City default was a relic of the first school; real
// classes/schools always carry their own timezone, so this only bites when
// nothing does (roster-report clock, bundle fallback). CLASS_TIMEZONE still
// overrides for dev parity — prod's effective value is surfaced on the
// System health card so dev/prod can't silently diverge.
export const DEFAULT_TIMEZONE = process.env.CLASS_TIMEZONE ?? 'America/Denver'
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
  /** PL-307/PL-322: which price sheet the row belongs to. */
  tier: 'international' | 'domestic'
}

export type EnrollmentRow = {
  id: string
  payment_status: 'Pending' | 'Paid' | 'Completed' | 'Expired' | 'Waitlisted' | 'Refunded'
  enrolled_at: string
  /** PL-361/363: null = online; 'staff' = staff-assisted; 'import' = cutover import. */
  source: string | null
  paid_at: string | null
  amountPaid: number | null
  accommodations: string | null
  previousScores: string | null
  notes: string | null
  graduatingYear: string | null
  /** PL-364: physical add-on products (paid rows only). */
  products: { name: string; quantity: number; pricePaid: number | null; status: string; trackingUrl: string | null }[]
  addons: AddonRow[]
  waitlist_offer_sent_at: string | null
  waitlist_offer_expires_at: string | null
  /** PL-94: rescue rounds — each re-offer mints a fresh W2 dedupe key. */
  waitlist_offer_round: number
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
  /** PL-274: no school — an HGL open-enrollment class. */
  isOpenEnrollment: boolean
  schoolName: string
  schoolLabel: string
  timezone: string
  /** PL-382: school's city + the class's display_cities — publicTimeCityLabel inputs. */
  schoolCity: string | null
  displayCities: string | null
  /** PL-274 amendment B: per-class switches — emails/nags condition on these. */
  hasDiagnostics: boolean
  /** PL-274 amendment F: family-facing instructor intro; null drops cleanly. */
  instructorBio: string | null
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
  /** PL-335: 'run_anyway' = a recorded decision — the under-minimum
   *  checkpoint (alert + dashboard row) stops asking for this class. */
  minEnrollmentDecision: string | null
  registrationCloseDate: string | null
  startDate: string
  sessions: SessionInfo[]
  firstSession: string // falls back to start_date when no sessions exist
  lastSession: string
  /** PL-279: this class's follow-on target (drives the FO campaign). */
  followOnClassId: string | null
  /** PL-279: this FEEDER cohort's extended discount deadline (admin action). */
  foExtendedUntil: string | null
  /** PL-295C: per-cohort overrides — excluded from the campaign entirely /
   *  manual announce date (early start allowed) / manual discount end. */
  foExclude: boolean
  foAnnounceDate: string | null
  foDiscountEnd: string | null
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

// PL-89: the missing-details warning anchors to #4's SEND date, derived from
// the SEQUENCE offset (never hardcoded — retiming #4 retimes the warning).
export function classDetailsSendDate(bundle: Pick<ClassBundle, 'firstSession' | 'lastSession'>): string {
  const step = SEQUENCE.find((s) => s.type === 'class_details')!
  return stepTargetDate(step, bundle as ClassBundle)
}

/** The warning starts 3 days before #4 is due, daily until resolved. */
export function missingDetailsAlertStart(bundle: Pick<ClassBundle, 'firstSession' | 'lastSession'>): string {
  return addDaysISO(classDetailsSendDate(bundle), -3)
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
    min_enrollment_decision,
    delivery_mode, enrollment_deadline, registration_close_date, start_date,
    collateral_changed_at, timezone, has_diagnostics, display_cities,
    follow_on_class_id, fo_extended_until, fo_exclude, fo_announce_date, fo_discount_end,
    schools ( name, nickname, timezone, city ),
    instructors ( name, email, bio ),
    sessions ( id, session_date, start_time, end_time, location ),
    enrollments (
      id, payment_status, enrolled_at, paid_at, amount_paid, source,
      accommodations, previous_scores, notes,
      waitlist_offer_sent_at, waitlist_offer_expires_at, waitlist_offer_round,
      enrollment_addons ( hours, price_paid, tutoring_packages ( name ) ),
      product_orders ( quantity, price_paid, status, tracking_url, products ( name ) ),
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
          // PL-363: 'import' rows are cutover imports — the PR ladder and
          // expiry sweep leave them alone (staff-managed at cutover).
          source: e.source ?? null,
          paid_at: e.paid_at ?? null,
          amountPaid: e.amount_paid != null ? Number(e.amount_paid) : null,
          accommodations: e.accommodations ?? null,
          previousScores: e.previous_scores ?? null,
          notes: e.notes ?? null,
          graduatingYear: student.graduating_year ?? null,
          // PL-364: physical add-on products bought with this registration.
          products: (e.product_orders ?? [])
            .filter((po: any) => !['pending_payment', 'cancelled', 'refunded'].includes(po.status))
            .map((po: any) => ({
              name: one<any>(po.products)?.name ?? 'Add-on',
              quantity: Number(po.quantity),
              pricePaid: po.price_paid != null ? Number(po.price_paid) : null,
              status: po.status,
              trackingUrl: po.tracking_url ?? null,
            })),
          addons: (e.enrollment_addons ?? []).map((a: any) => ({
            name: one<any>(a.tutoring_packages)?.name ?? 'Tutoring package',
            hours: Number(a.hours),
            pricePaid: Number(a.price_paid),
          })),
          waitlist_offer_sent_at: e.waitlist_offer_sent_at,
          waitlist_offer_expires_at: e.waitlist_offer_expires_at,
          waitlist_offer_round: e.waitlist_offer_round ?? 0,
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
      // PL-274: a school-less class IS Higher Ground's own — the label must
      // not fabricate a school prefix, so className composes to just the
      // class type (e.g. "SAT Math Deep Dive", not "HGL SAT Math Deep Dive").
      isOpenEnrollment: !c.school_id,
      schoolName: school?.name ?? school?.nickname ?? 'Higher Ground Learning',
      schoolLabel: school?.nickname ?? 'HGL',
      // PL-274: class timezone wins (set at creation for open classes),
      // then the school's, then the default — one precedence everywhere.
      timezone: c.timezone ?? school?.timezone ?? DEFAULT_TIMEZONE,
      hasDiagnostics: c.has_diagnostics !== false,
      // PL-382: the public city label's inputs ride the bundle so email time
      // labels resolve exactly like the /c pages.
      schoolCity: school?.city ?? null,
      displayCities: c.display_cities ?? null,
      instructorBio: instructor?.bio || null,
      instructorId: c.instructor_id ?? null,
      instructorName: instructor?.name ?? instructor?.email ?? null,
      instructorEmail: instructor?.email ?? null,
      defaultLocation: c.default_location || null,
      synapGroup: c.synap_group || null,
      followOnClassId: c.follow_on_class_id ?? null,
      foExtendedUntil: c.fo_extended_until ?? null,
      foExclude: c.fo_exclude === true,
      foAnnounceDate: c.fo_announce_date ?? null,
      foDiscountEnd: c.fo_discount_end ?? null,
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
      minEnrollmentDecision: c.min_enrollment_decision ?? null,
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
  const token = createHmac('sha256', signingSecret())
    .update(`login:${email}`)
    .digest('hex')
    .slice(0, 32)
  return `${base}/portal?enrollment=${enrollmentId}&pe=${encodeURIComponent(email)}&pt=${token}`
}

export function emailContext(bundle: ClassBundle, e: EnrollmentRow): EnrollmentEmailContext {
  return {
    enrollmentId: e.id,
    classId: bundle.id,
    timezone: bundle.timezone,
    calendarPageUrl: calendarPageUrlFor(bundle.id),
    resumePaymentUrl: resumePaymentUrlFor(e.id),
    portalUrl: portalDeepLinkFor(e.id, e.parentEmail),
    // Always first session minus one day — computed, never stored.
    diagnosticDueDate: addDaysISO(bundle.firstSession, -1),
    addons: e.addons,
    products: e.products,
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
    // PL-274: open classes carry no school prefix — "SAT Math Deep Dive".
    className: bundle.isOpenEnrollment
      ? bundle.classType
      : `${bundle.schoolLabel} ${bundle.classType}`,
    classTime: classTimeFor(bundle.sessions),
    examInfo: examInfoFor(bundle.classType),
    instructorName: bundle.instructorName,
    instructorBio: bundle.instructorBio,
    isOpenEnrollment: bundle.isOpenEnrollment,
    hasDiagnostics: bundle.hasDiagnostics,
    schoolCity: bundle.schoolCity,
    displayCities: bundle.displayCities,
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
/** PL-274 amendment A: has this family COMPLETED any other HGL class?
 *  'Completed' flips the day after a class's last session (sweepCompletion),
 *  so this is exactly "the student has finished a class with us before". */
export async function isReturningFamily(familyId: string, excludeClassId: string): Promise<boolean> {
  const { supabaseAdmin } = await import('./supabase-admin')
  const { data } = await supabaseAdmin
    .from('enrollments')
    .select('id, class_id, students!inner ( family_id )')
    .eq('students.family_id', familyId)
    .eq('payment_status', 'Completed')
    .neq('class_id', excludeClassId)
    .limit(1)
  return Boolean(data && data.length > 0)
}

/** PL-274 amendment B / PL-310: sequence steps the class's diagnostics
 *  switch turns off. One switch since PL-310 — diagnostics run through
 *  Synap, so #2 (synap_access, the diagnostic intro + Synap link) and #6
 *  (second_diagnostic) both key off it. Used by the sweep AND the
 *  projector — the two must never disagree, or the comms dashboard shows
 *  steps as "not yet sent" forever. */
export function stepDisabledForClass(stepType: string, bundle: ClassBundle): string | null {
  if (stepType === 'synap_access' && !bundle.hasDiagnostics) {
    return 'class has no diagnostics (PL-310 switch)'
  }
  if (stepType === 'second_diagnostic' && !bundle.hasDiagnostics) {
    return 'class has no diagnostics (PL-310 switch)'
  }
  return null
}

export function registrationCloseFor(bundle: ClassBundle): string {
  return bundle.registrationCloseDate ?? bundle.firstSession
}

/**
 * PL-141: THE deadline every surface quotes — the go/no-go date for the
 * min-enrollment decision brief, the final-week counselor push, and the
 * FP-status line. Three call sites used to default differently (first
 * session −7 days in the brief, the first session in the push), so the brief
 * asserted a date no other calendar honored. One chain now: an explicit
 * enrollment deadline, else the registration close (which itself defaults to
 * the first session). Matches `collateral.ts`, which already read this way.
 */
export function effectiveDeadline(bundle: ClassBundle): string {
  return bundle.enrollmentDeadline ?? registrationCloseFor(bundle)
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
  // PL-149: minted with an issued-at + lifetime. (The offer's own 48-hour
  // deadline is the real gate here; the lifetime just stops an ancient
  // forwarded link from ever being a live entry point.)
  return mintToken('', enrollmentId, 'family-action')
}

export function claimUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/api/waitlist/claim?e=${enrollmentId}&t=${claimToken(enrollmentId)}`
}

/** PL-149: tri-state — 'expired' earns the friendly aged-out page. */
export function checkClaimToken(enrollmentId: string, token: string): 'ok' | 'expired' | 'invalid' {
  return checkToken('', enrollmentId, token, 'family-action')
}

export function verifyClaimToken(enrollmentId: string, token: string): boolean {
  return checkClaimToken(enrollmentId, token) === 'ok'
}

// PL-72: decline links — distinct HMAC prefix so a decline token can never
// double as a claim token (or vice versa).
function declineToken(enrollmentId: string) {
  // PL-149: minted with an issued-at + lifetime.
  return mintToken('decline:', enrollmentId, 'family-action')
}

export function declineUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/waitlist/decline?e=${enrollmentId}&t=${declineToken(enrollmentId)}`
}

/** PL-149: tri-state — 'expired' earns the friendly aged-out page. */
export function checkDeclineToken(enrollmentId: string, token: string): 'ok' | 'expired' | 'invalid' {
  return checkToken('decline:', enrollmentId, token, 'family-action')
}

export function verifyDeclineToken(enrollmentId: string, token: string): boolean {
  return checkDeclineToken(enrollmentId, token) === 'ok'
}

/** Active tutoring packages, split by phase. All pricing comes from here.
 *  PL-322: pass a tier to get one price sheet; omit for all rows (callers
 *  with a class in play filter by its flavor). */
export async function loadTutoringPackages(tier?: 'international' | 'domestic'): Promise<{
  pre: TutoringPackage[]
  post: TutoringPackage[]
}> {
  let q = supabase
    .from('tutoring_packages')
    .select('id, name, hours, hourly_rate, package_price, regular_hourly_rate, phase, tier')
    .eq('active', true)
    .order('hours')
  if (tier) q = q.eq('tier', tier)
  const { data, error } = await q
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
    tier: p.tier,
  }))
  return {
    pre: all.filter((p) => p.phase === 'pre_class'),
    post: all.filter((p) => p.phase === 'post_class'),
  }
}

export function packageSavings(p: TutoringPackage) {
  return p.hours * p.regularHourlyRate - p.packagePrice
}

/** PL-322: the price sheet for a student when NO class is in play (pure
 *  1-on-1 flows). The rule: their MOST RECENT group-class enrollment's
 *  flavor decides — an at-HGL class means domestic; school or online means
 *  international; no class history at all prices international (the
 *  pre-PL-322 sheet — nobody gets an unearned domestic discount, and staff
 *  can always override the rate on the engagement). Flows WITH a class in
 *  play never call this — they use classTutoringTier on that class. */
export async function studentTutoringTier(
  studentId: string
): Promise<'international' | 'domestic'> {
  const { data } = await supabase
    .from('enrollments')
    .select('enrolled_at, classes ( school_id, delivery_mode )')
    .eq('student_id', studentId)
    .in('payment_status', ['Paid', 'Completed'])
    .order('enrolled_at', { ascending: false })
    .limit(1)
  const cls = one<{ school_id: string | null; delivery_mode: string | null }>(
    (data?.[0] as { classes?: unknown } | undefined)?.classes as never
  )
  if (!cls) return 'international'
  return classTutoringTier(cls)
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

/** Exam family from class_type: drives the exam-registration FAQ answer.
 *  PL-368: delegates to THE one switch (exam-family.ts) — the /c pages use
 *  the same helper, so the two sides can never disagree on SAT/ACT/PSAT.
 *  PSAT: schoolBased=true, regLabel/regUrl null — composers render plain
 *  school-based wording, never a wrong College Board link. */
export function examInfoFor(
  classType: string
): { examName: string; schoolBased: boolean; regLabel: string | null; regUrl: string | null } | null {
  const fam = examFamilyFor(classType)
  if (!fam) return null
  return { examName: fam.examName, schoolBased: fam.schoolBased, regLabel: fam.regLabel, regUrl: fam.regUrl }
}

// Resume-payment links for the PR1-4 "Finalize Registration" buttons.
// Distinct HMAC prefix, as with claim/unsubscribe/addon tokens.
function resumeToken(enrollmentId: string) {
  // PL-149: minted with an issued-at + lifetime.
  return mintToken('resume:', enrollmentId, 'family-action')
}

export function resumePaymentUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/api/resume-payment?e=${enrollmentId}&t=${resumeToken(enrollmentId)}`
}

/** PL-149: tri-state — 'expired' earns the friendly aged-out page. */
export function checkResumeToken(enrollmentId: string, token: string): 'ok' | 'expired' | 'invalid' {
  return checkToken('resume:', enrollmentId, token, 'family-action')
}

export function verifyResumeToken(enrollmentId: string, token: string): boolean {
  return checkResumeToken(enrollmentId, token) === 'ok'
}

// Per-enrollment add-on page links (email #9). Distinct HMAC prefix, as with
// claim and unsubscribe tokens.
function addonToken(enrollmentId: string) {
  // PL-149: minted with an issued-at + lifetime.
  return mintToken('addon:', enrollmentId, 'family-form')
}

export function addonPageUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/addons/${enrollmentId}?t=${addonToken(enrollmentId)}`
}

/** PL-149: tri-state — 'expired' earns the friendly aged-out page. */
export function checkAddonToken(enrollmentId: string, token: string): 'ok' | 'expired' | 'invalid' {
  return checkToken('addon:', enrollmentId, token, 'family-form')
}

export function verifyAddonToken(enrollmentId: string, token: string): boolean {
  return checkAddonToken(enrollmentId, token) === 'ok'
}

// Unsubscribe links (relationship emails only). Distinct HMAC input prefix so
// claim tokens and unsubscribe tokens can never be swapped for each other.
function unsubToken(familyId: string) {
  return createHmac('sha256', signingSecret())
    .update(`unsub:${familyId}`)
    .digest('hex')
    .slice(0, 32)
}

// PL-86: the self-serve conversion page's signed token (same HMAC pattern
// as claim/decline — enrollment-scoped; the page itself is read-only and
// the conversion fires only on a JS-executed POST behind one visible tap).
export function convertToken(enrollmentId: string) {
  // PL-149: minted with an issued-at + lifetime.
  return mintToken('convert:', enrollmentId, 'family-action')
}

/** PL-149: tri-state — 'expired' earns the friendly aged-out page. */
export function checkConvertToken(enrollmentId: string, token: string): 'ok' | 'expired' | 'invalid' {
  return checkToken('convert:', enrollmentId, token, 'family-action')
}

export function verifyConvertToken(enrollmentId: string, token: string): boolean {
  return checkConvertToken(enrollmentId, token) === 'ok'
}

export function convertUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/convert/${enrollmentId}?t=${convertToken(enrollmentId)}`
}

// PL-128: the refund REQUEST link — distinct HMAC prefix (a refund token can
// never double as a convert token). The page is GET-safe (bot prefetchers
// stamp nothing); the confirm button POSTs the actual request. Refunds stay
// Option A: the request is tracked intent, the money moves only in Stripe.
function refundToken(enrollmentId: string) {
  // PL-149: minted with an issued-at + lifetime.
  return mintToken('refund:', enrollmentId, 'family-action')
}

export function refundRequestUrlFor(enrollmentId: string) {
  const base = emailBaseUrl()
  return `${base}/refund/${enrollmentId}?t=${refundToken(enrollmentId)}`
}

/** PL-149: tri-state — 'expired' earns the friendly aged-out page. */
export function checkRefundToken(enrollmentId: string, token: string): 'ok' | 'expired' | 'invalid' {
  return checkToken('refund:', enrollmentId, token, 'family-action')
}

export function verifyRefundToken(enrollmentId: string, token: string): boolean {
  return checkRefundToken(enrollmentId, token) === 'ok'
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
  return createHmac('sha256', signingSecret())
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
  return createHmac('sha256', signingSecret())
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

// ---------------------------------------------------------------------------
// PL-131: the counselor's no-login roster link
// ---------------------------------------------------------------------------
// Counselors already had tokenized room entry and a login portal. What was
// missing was the middle: a counselor reading a CD digest who wants to see
// the roster RIGHT NOW shouldn't have to find their login.
//
// The token is scoped to class AND counselor email — a bearer link, so it
// must never be a skeleton key for a school's other classes. The page it
// opens bypasses RLS (it renders server-side as admin), which is exactly why
// the school scoping has to be enforced in that page's own query.
function counselorRosterSig(classId: string, counselorEmail: string): string {
  return mintToken('roster:', `${classId}:${counselorEmail.trim().toLowerCase()}`, 'family-form')
}

export function counselorRosterUrlFor(classId: string, counselorEmail: string): string {
  return `${emailBaseUrl()}/class-roster/${classId}?t=${counselorRosterSig(classId, counselorEmail)}&ce=${encodeURIComponent(counselorEmail)}`
}

/** 'ok' | 'expired' | 'invalid' — expiry earns the friendly aged-out page. */
export function checkCounselorRosterToken(
  classId: string,
  counselorEmail: string,
  token: string
): 'ok' | 'expired' | 'invalid' {
  return checkToken('roster:', `${classId}:${counselorEmail.trim().toLowerCase()}`, token, 'family-form')
}

export type SnapshotSession = {
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

export function classDetailsSnapshot(bundle: ClassBundle) {
  return {
    first_session: bundle.firstSession,
    location: bundle.defaultLocation,
    instructor: bundle.instructorName,
    // PL-314: the full session list rides the snapshot — the sweep's diff
    // catches ANY session add/edit/remove, not just first-session moves.
    // Older stored snapshots lack this key; the diff skips the list for them.
    sessions: bundle.sessions.map((s) => ({
      session_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
      location: s.location,
    })) as SnapshotSession[],
  }
}

// PL-314: plain-English session-list diff — shared by the sweep and the
// per-session edit route so both paths word changes identically.
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth']
const ordinalWord = (i: number) => ORDINAL_WORDS[i] ?? `${i + 1}th`

const t12 = (t: string | null): string | null => {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

/** "5:00 PM–8:00 PM · Room 204" — the non-date half of a session line. */
function sessionDetailText(s: SnapshotSession): string {
  const parts: string[] = []
  const start = t12(s.start_time)
  const end = t12(s.end_time)
  if (start) parts.push(end ? `${start}–${end}` : start)
  if (s.location) parts.push(s.location)
  return parts.join(' · ')
}

/** Diff two session lists into complete sentences ("A fourth session was
 *  added: Tuesday, September 8, 2026 · 5:00 PM–8:00 PM."). Sessions match
 *  by date (same-date split days pair up in start-time order). A date move
 *  reads as removed + added — plain, and never wrong. */
export function sessionListChanges(
  before: SnapshotSession[],
  after: SnapshotSession[]
): { label: string; value: string; sentence: string }[] {
  const byDate = (list: SnapshotSession[]) => {
    const m = new Map<string, SnapshotSession[]>()
    for (const s of [...list].sort((a, b) =>
      (a.session_date + (a.start_time ?? '')).localeCompare(b.session_date + (b.start_time ?? ''))
    )) {
      const arr = m.get(s.session_date) ?? []
      arr.push(s)
      m.set(s.session_date, arr)
    }
    return m
  }
  const beforeBy = byDate(before)
  const afterBy = byDate(after)
  const sortedAfter = [...after].sort((a, b) =>
    (a.session_date + (a.start_time ?? '')).localeCompare(b.session_date + (b.start_time ?? ''))
  )
  const changes: { label: string; value: string; sentence: string }[] = []

  for (const [date, olds] of beforeBy) {
    const news = afterBy.get(date) ?? []
    for (let i = news.length; i < olds.length; i++) {
      changes.push({
        label: 'Session removed',
        value: formatDate(date),
        sentence: `The ${formatDate(date)} session was removed.`,
      })
    }
  }
  for (const [date, news] of afterBy) {
    const olds = beforeBy.get(date) ?? []
    for (let i = 0; i < news.length; i++) {
      const s = news[i]
      const b = olds[i]
      if (!b) {
        const position = sortedAfter.indexOf(s)
        const detail = sessionDetailText(s)
        changes.push({
          label: 'Session added',
          value: `${formatDate(date)}${detail ? ` · ${detail}` : ''}`,
          sentence: `A ${ordinalWord(position)} session was added: ${formatDate(date)}${detail ? ` · ${detail}` : ''}.`,
        })
      } else if (
        (b.start_time ?? '') !== (s.start_time ?? '') ||
        (b.end_time ?? '') !== (s.end_time ?? '') ||
        (b.location ?? '') !== (s.location ?? '')
      ) {
        const detail = sessionDetailText(s) || 'time TBD'
        changes.push({
          label: `The ${formatDate(date)} session`,
          value: detail,
          sentence: `The ${formatDate(date)} session now runs ${detail}.`,
        })
      }
    }
  }
  return changes
}
