// Feature A (docs/COMMS_ATTENDANCE_PARENT_SPEC.md): shared comms plumbing —
// the template-key registry mapping the Phase 2 pipeline's email_type strings
// to stable spec keys (§A4), recipient-role derivation, and the timezone math
// that turns "8:00 school-local on 2026-08-01" into the UTC instant stored on
// scheduled email_sends rows.

export type RecipientRole = 'parent' | 'student' | 'counselor' | 'admin' | 'instructor'

export type SendStatus =
  | 'scheduled'
  | 'held'
  | 'cancelled'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'

/** Statuses that mean "this email already went out" (claims are final). */
export const SENT_STATUSES = ['sending', 'sent', 'delivered', 'bounced', 'complained'] as const

/**
 * email_type (+ dedupe-key audience tag) → spec A4 template_key + role.
 * The sweep keeps sending by email_type; this mapping stamps the registry key
 * on every email_sends row so the dashboard and (A4) the template editor
 * speak the spec's language.
 */
export function templateMetaFor(
  emailType: string,
  dedupeKey: string
): { key: string; role: RecipientRole } {
  const student = /_s:/.test(dedupeKey)
  switch (emailType) {
    case 'parent_confirmation':
      return { key: 'E0_CONFIRM_PARENT', role: 'parent' }
    case 'student_confirmation':
      return { key: 'E0_CONFIRM_STUDENT', role: 'student' }
    case 'payment_reminder': {
      const n = dedupeKey.match(/^payment_reminder_(\d)/)?.[1] ?? '1'
      return { key: `PR${n}`, role: 'parent' }
    }
    case 'thank_you':
      return { key: 'E1_THANKS', role: 'parent' }
    case 'synap_access':
      return student
        ? { key: 'E2_DIAG_STUDENT', role: 'student' }
        : { key: 'E2_DIAG_PARENT', role: 'parent' }
    case 'faq':
      return { key: 'E3_VFAQ', role: student ? 'student' : 'parent' }
    case 'class_details':
      return { key: 'E4_CLASS_DETAILS', role: student ? 'student' : 'parent' }
    case 'location_reminder':
      return { key: 'E5_LOCATION', role: student ? 'student' : 'parent' }
    case 'second_diagnostic':
      return { key: 'E6_DIAG2', role: student ? 'student' : 'parent' }
    case 'review_request':
      return { key: 'E7_REVIEW', role: 'parent' }
    case 'tutoring_offer':
      return { key: 'E8_POSTCLASS_TUTORING', role: student ? 'student' : 'parent' }
    case 'tutoring_addon_scheduling': // PL-53c: the has-hours fork of #8
      return { key: 'E8_ADDON_SCHEDULING', role: 'parent' }
    case 'tutoring_addon_nudge':
      return { key: 'E8_ADDON_NUDGE', role: 'parent' }
    case 'tutoring_upsell':
      return { key: 'E9_UPSELL', role: 'parent' }
    case 'waitlist_confirmation':
      return { key: 'W1_WAITLIST', role: 'parent' }
    case 'waitlist_offer':
      return { key: 'W2_SPOT_OPEN', role: 'parent' }
    case 'schedule_update':
      return { key: 'SU_SCHEDULE_UPDATE', role: student ? 'student' : 'parent' }
    case 'late_welcome':
      return { key: 'LR_WELCOME', role: student ? 'student' : 'parent' }
    case 'counselor_digest':
      return { key: 'CD_COUNSELOR_DIGEST', role: 'counselor' }
    case 'classroom_request':
      return { key: 'CR_CLASSROOM_REQUEST', role: 'counselor' }
    case 'deadline_push':
      return { key: 'FP_DEADLINE_PUSH', role: 'counselor' }
    case 'class_full_notice':
      return { key: 'FP_ALT_CLASS_FULL', role: 'counselor' }
    case 'class_cancellation':
      return { key: 'CX_CANCELLATION', role: student ? 'student' : 'parent' }
    case 'waitlist_cancellation':
      return { key: 'CX_W_CANCELLATION', role: 'parent' }
    case 'cancellation_counselor':
      return { key: 'CX_C_CANCELLATION', role: 'counselor' }
    case 'instructor_nudge':
      return { key: 'ADMIN_INSTRUCTOR_NUDGE', role: 'admin' }
    case 'admin_alert':
      return { key: 'ADMIN_ALERT', role: 'admin' }
    case 'login_link':
      return { key: 'LOGIN_LINK', role: 'parent' }
    case 'instructor_message':
      return { key: 'IM_INSTRUCTOR_MESSAGE', role: student ? 'student' : 'parent' }
    case 'T5_TIMECARD_READY': // Phase 7b: tutor pay-period close notice
      return { key: 'T5_TIMECARD_READY', role: 'instructor' }
    // Phase 7c monthly billing cycle (spec §6)
    case 'T1_MONTHLY_PROPOSAL':
      return { key: 'T1_MONTHLY_PROPOSAL', role: 'parent' }
    case 'T1B_PROPOSAL_NUDGE':
      return { key: 'T1B_PROPOSAL_NUDGE', role: 'parent' }
    case 'T2_INVOICE':
      return { key: 'T2_INVOICE', role: 'parent' }
    case 'T3_SCHEDULE_CHANGE':
      return { key: 'T3_SCHEDULE_CHANGE', role: 'parent' }
    case 'T4_PAYMENT_FAILED':
      return { key: 'T4_PAYMENT_FAILED', role: 'parent' }
    // Phase 7e intake & onboarding (spec §11)
    case 'T7_INTAKE_REQUEST':
      return { key: 'T7_INTAKE_REQUEST', role: 'parent' }
    case 'T8_WELCOME_HANDOFF':
      return { key: 'T8_WELCOME_HANDOFF', role: 'parent' }
    default:
      return { key: emailType.toUpperCase(), role: 'parent' }
  }
}

/** Human labels for the dashboard rows ("#4 — Class details"). */
export const TEMPLATE_LABELS: Record<string, string> = {
  E0_CONFIRM_PARENT: '#0-P — Registration confirmation (parent)',
  E0_CONFIRM_STUDENT: '#0-S — Registration confirmation (student)',
  PR1: 'PR1 — Payment reminder (2h)',
  PR2: 'PR2 — Payment reminder (24h)',
  PR3: 'PR3 — Payment reminder (72h)',
  PR4: 'PR4 — Payment reminder (final)',
  E1_THANKS: '#1 — Thank you',
  E2_DIAG_PARENT: '#2-P — Diagnostic & Synap access (parent)',
  E2_DIAG_STUDENT: '#2-S — Diagnostic & Synap access (student)',
  E3_VFAQ: '#3 — Video FAQs',
  E4_CLASS_DETAILS: '#4 — Class details',
  E5_LOCATION: '#5 — Location reminder',
  E6_DIAG2: '#6 — Second diagnostic',
  E7_REVIEW: '#7 — Review request',
  E8_POSTCLASS_TUTORING: '#8 — Post-class tutoring offer',
  E8_ADDON_SCHEDULING: '#8b — Add-on hours: time to schedule',
  E8_ADDON_NUDGE: '#8b-n — Add-on hours nudge',
  E9_UPSELL: '#9 — Pre-class tutoring upsell',
  W1_WAITLIST: 'W1 — Waitlist confirmation',
  W2_SPOT_OPEN: 'W2 — Waitlist spot open',
  SU_SCHEDULE_UPDATE: 'SU — Schedule update',
  LR_WELCOME: 'LR — Late-registration welcome',
  CD_COUNSELOR_DIGEST: 'CD — Counselor digest',
  CR_CLASSROOM_REQUEST: 'CR — Classroom request',
  FP_DEADLINE_PUSH: 'FP — Final-days push',
  FP_ALT_CLASS_FULL: 'FP-alt — Class full notice',
  CX_CANCELLATION: 'CX — Class cancellation',
  CX_W_CANCELLATION: 'CX-W — Cancellation (waitlist)',
  CX_C_CANCELLATION: 'CX-C — Cancellation (counselor)',
  ADMIN_INSTRUCTOR_NUDGE: 'Internal — Instructor scheduling nudge',
  ADMIN_ALERT: 'Internal — Admin alert',
  LOGIN_LINK: 'Login — Sign-in link',
  IM_INSTRUCTOR_MESSAGE: 'IM — Instructor class message',
  SUPERSEDED: '(superseded by combined welcome)',
}

export function templateLabel(key: string) {
  return TEMPLATE_LABELS[key] ?? key
}

/**
 * The UTC instant of "{hour}:00 on {dateISO}" in an IANA timezone, without a
 * tz library: two-pass offset correction (start from the UTC-naive guess,
 * measure how that instant renders in the target zone, adjust; second pass
 * absorbs DST-boundary drift).
 */
export function zonedTimeToUtc(dateISO: string, hour: number, tz: string): Date {
  const wallMs = Date.parse(`${dateISO}T${String(hour).padStart(2, '0')}:00:00Z`)
  let guess = wallMs
  for (let i = 0; i < 2; i++) {
    const rendered = new Date(guess).toLocaleString('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    // en-CA renders "YYYY-MM-DD, HH:mm:ss"
    const asUtc = Date.parse(rendered.replace(', ', 'T').replace(/(\d{2}):(\d{2}):(\d{2})$/, '$1:$2:$3Z'))
    guess += wallMs - asUtc
  }
  return new Date(guess)
}
