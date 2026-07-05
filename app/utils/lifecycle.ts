import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'
import type { EnrollmentEmailContext, SessionInfo } from './email'

// Shared plumbing for the email lifecycle: loads every class with its school,
// sessions, and enrollments in one query, and provides the timezone-aware
// date math the sweep and webhook both use. All scheduling is derived from
// current DB state on every run — rescheduling a class automatically
// recomputes every pending send.

export const DEFAULT_TIMEZONE = process.env.CLASS_TIMEZONE ?? 'America/Mexico_City'
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'williamraymondthomas@gmail.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnrollmentRow = {
  id: string
  payment_status: 'Pending' | 'Paid' | 'Completed' | 'Expired' | 'Waitlisted'
  enrolled_at: string
  waitlist_offer_sent_at: string | null
  waitlist_offer_expires_at: string | null
  familyId: string
  marketingOptOut: boolean
  parentFirstName: string
  parentEmail: string
  studentFirstName: string
  studentLastName: string
  studentEmail: string | null
}

export type ClassBundle = {
  id: string
  classType: string
  schoolId: string | null
  schoolLabel: string
  timezone: string
  instructorName: string | null
  instructorEmail: string | null
  defaultLocation: string | null
  synapGroup: string | null
  price: number
  capacity: number
  minEnrollment: number
  deliveryMode: string
  enrollmentDeadline: string | null
  startDate: string
  sessions: SessionInfo[]
  firstSession: string // falls back to start_date when no sessions exist
  lastSession: string
  enrollments: EnrollmentRow[]
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
    id, class_type, school_nickname, school_id, instructor_name, instructor_email,
    default_location, synap_group, price, capacity, min_enrollment,
    delivery_mode, enrollment_deadline, start_date,
    schools ( nickname, timezone ),
    sessions ( id, session_date, start_time, end_time, location ),
    enrollments (
      id, payment_status, enrolled_at,
      waitlist_offer_sent_at, waitlist_offer_expires_at,
      students (
        first_name, last_name, student_email,
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
    const sessions: SessionInfo[] = [...(c.sessions ?? [])].sort((a: SessionInfo, b: SessionInfo) =>
      a.session_date.localeCompare(b.session_date)
    )
    const enrollments: EnrollmentRow[] = (c.enrollments ?? [])
      .map((e: any) => {
        const student = one<any>(e.students)
        const family = one<any>(student?.families)
        if (!student || !family) return null
        return {
          id: e.id,
          payment_status: e.payment_status,
          enrolled_at: e.enrolled_at,
          waitlist_offer_sent_at: e.waitlist_offer_sent_at,
          waitlist_offer_expires_at: e.waitlist_offer_expires_at,
          familyId: family.id,
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
      classType: c.class_type,
      schoolId: c.school_id ?? null,
      schoolLabel: school?.nickname ?? c.school_nickname ?? 'HGL',
      timezone: school?.timezone ?? DEFAULT_TIMEZONE,
      instructorName: c.instructor_name || null,
      instructorEmail: c.instructor_email || null,
      defaultLocation: c.default_location || null,
      synapGroup: c.synap_group || null,
      price: Number(c.price),
      capacity: c.capacity,
      minEnrollment: c.min_enrollment ?? (c.delivery_mode === 'online' ? 3 : 8),
      deliveryMode: c.delivery_mode,
      enrollmentDeadline: c.enrollment_deadline,
      startDate: c.start_date,
      sessions,
      firstSession: sessions[0]?.session_date ?? c.start_date,
      lastSession: sessions[sessions.length - 1]?.session_date ?? c.start_date,
      enrollments,
    }
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function calendarPageUrlFor(classId: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/classes/${classId}/calendar`
}

export function emailContext(bundle: ClassBundle, e: EnrollmentRow): EnrollmentEmailContext {
  return {
    enrollmentId: e.id,
    classId: bundle.id,
    calendarPageUrl: calendarPageUrlFor(bundle.id),
    // Always first session minus one day — computed, never stored.
    diagnosticDueDate: addDaysISO(bundle.firstSession, -1),
    marketingOptOut: e.marketingOptOut,
    unsubscribeUrl: unsubscribeUrlFor(e.familyId),
    parentFirstName: e.parentFirstName,
    parentEmail: e.parentEmail,
    studentFirstName: e.studentFirstName,
    studentEmail: e.studentEmail,
    className: `${bundle.schoolLabel} — ${bundle.classType}`,
    instructorName: bundle.instructorName,
    defaultLocation: bundle.defaultLocation,
    synapGroup: bundle.synapGroup,
    startDate: bundle.startDate,
    firstSession: bundle.firstSession,
    lastSession: bundle.lastSession,
    price: bundle.price,
    sessions: bundle.sessions,
  }
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
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/api/waitlist/claim?e=${enrollmentId}&t=${claimToken(enrollmentId)}`
}

export function verifyClaimToken(enrollmentId: string, token: string) {
  const expected = Buffer.from(claimToken(enrollmentId))
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

export function unsubscribeUrlFor(familyId: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/api/unsubscribe?f=${familyId}&t=${unsubToken(familyId)}`
}

export function verifyUnsubToken(familyId: string, token: string) {
  const expected = Buffer.from(unsubToken(familyId))
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
