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
    case 'next_class_open': // PL-54: interest-list notify
      return { key: 'NW_NEXT_CLASS_OPEN', role: 'parent' }
    case 'waitlist_release': // PL-59: class completed still-full
      return { key: 'WR_WAITLIST_RELEASE', role: 'parent' }
    case 'agreement_request': // PL-63: first policies ask
      return { key: 'AG_REQUEST', role: 'parent' }
    case 'agreement_nudge': // PL-63: automatic chase
      return { key: 'AG_NUDGE', role: 'parent' }
    case 'tutor_schedule_notice': // PL-66: tutor-facing T3 sibling
      return { key: 'T3_TUTOR_NOTICE', role: 'instructor' }
    case 'cx_tutoring_start': // PL-76: cancelled-class → tutoring conversion
      return { key: 'CX_TUTORING_START', role: 'parent' }
    case 'instructor_welcome': // PL-78
      return { key: 'IN_WELCOME', role: 'instructor' }
    case 'instructor_digest':
      return { key: 'IN_DIGEST', role: 'instructor' }
    case 'instructor_fyi':
      return { key: 'IN_FYI', role: 'instructor' }
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
    // The cancel-class route emits these exact types (PL-55 alignment —
    // they previously fell through to raw default keys, so CX history rows
    // never matched the PL-13 registry templates). Legacy spellings kept
    // below for the migration-era mapping.
    case 'class_cancelled':
      return { key: 'CX_FAMILY', role: student ? 'student' : 'parent' }
    case 'cancel_waitlist':
      return { key: 'CX_WAITLIST', role: 'parent' }
    case 'cancel_counselor':
      return { key: 'CX_C_CANCELLATION', role: 'counselor' }
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
    // PL-111: session-note reminders (end-of-day list + single nudge)
    case 'T6_NOTES_EOD':
      return { key: 'T6_NOTES_EOD', role: 'instructor' }
    case 'T6_NOTES_NUDGE':
      return { key: 'T6_NOTES_NUDGE', role: 'instructor' }
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
  E3_VFAQ: '#3 — VERY FAQs',
  E4_CLASS_DETAILS: '#4 — Class details',
  E5_LOCATION: '#5 — Location reminder',
  E6_DIAG2: '#6 — Second diagnostic',
  E7_REVIEW: '#7 — Review request',
  E8_POSTCLASS_TUTORING: '#8 — Post-class tutoring offer',
  E8_ADDON_SCHEDULING: '#8b — Add-on hours: time to schedule',
  E8_ADDON_NUDGE: '#8b-n — Add-on hours nudge',
  E9_UPSELL: '#9 — Pre-class tutoring upsell',
  NW_NEXT_CLASS_OPEN: 'NW — Next class open (interest list)',
  WR_WAITLIST_RELEASE: 'WR — Waitlist release (class completed full)',
  AG_REQUEST: 'AG — Agreement request (policies)',
  AG_NUDGE: 'AG-N — Agreement nudge (automatic chase)',
  // PL-66: classroom-request re-nudges get their own keys (CR1 history stays
  // under CR_CLASSROOM_REQUEST); tutor T3 sibling is new
  CX_TUTORING_START: 'CX-T — Tutoring conversion (availability request)',
  CR_CLASSROOM_NUDGE_2: 'CR2 — Classroom request re-nudge',
  CR_CLASSROOM_NUDGE_3: 'CR3 — Classroom request (last call)',
  T3_TUTOR_NOTICE: 'T3-T — Schedule change notice (tutor)',
  T6_NOTES_EOD: 'T6 — Session notes end-of-day reminder (tutor)',
  T6_NOTES_NUDGE: 'T6-N — Session notes nudge (tutor)',
  IN_WELCOME: 'IN — Instructor class assignment welcome',
  IN_DIGEST: 'IN — Instructor enrollment digest / milestone ping',
  IN_FYI: 'IN — Instructor FYI copy (family logistics email)',
  // PL-66: internal [HGL Admin] alert family (subject shown WITHOUT the
  // [HGL Admin] prefix — the sender adds it)
  AL_REGISTRATION: 'AL — New registration',
  AL_ROSTER_REPORT: 'AL — Roster report (weekly)',
  AL_CLASS_DETAILS_HOLD: 'AL — #4 hold-and-alert (class details)',
  AL_MISSING_DETAILS: 'AL — Missing class details warning',
  AL_MIN_ENROLLMENT: 'AL — Minimum-enrollment checkpoint',
  AL_WAITLIST_ROLLOVER: 'AL — Waitlist offer rolled over',
  AL_NO_INSTRUCTOR: 'AL — No instructor assigned',
  AL_WEBHOOK_FAILURE: 'AL — Stripe webhook mismatch',
  AL_QBO_FAILURE: 'AL — QuickBooks sync failure',
  AL_UNAGREED: 'AL — Billed without signed agreement',
  AL_AVAILABILITY_SHARED: 'AL — Family shared availability',
  AL_INTAKE_COMPLETE: 'AL — Intake complete',
  AL_DUNNING_EXHAUSTED: 'AL — Autopay retries exhausted',
  AL_OVERDUE_10: 'AL — Invoice 10+ days past due',
  AL_OVERDUE_30: 'AL — Invoice 30+ days past due (late-fee decision)',
  W1_WAITLIST: 'W1 — Waitlist confirmation',
  W2_SPOT_OPEN: 'W2 — Waitlist spot open',
  SU_SCHEDULE_UPDATE: 'SU — Schedule update',
  LR_WELCOME: 'LR — Late-registration welcome',
  CD_COUNSELOR_DIGEST: 'CD — Counselor digest',
  CR_CLASSROOM_REQUEST: 'CR — Classroom request',
  FP_DEADLINE_PUSH: 'FP — Final-days push',
  FP_ALT_CLASS_FULL: 'FP-alt — Class full notice',
  CX_FAMILY: 'CX — Class cancellation',
  CX_WAITLIST: 'CX-W — Cancellation (waitlist)',
  CX_CANCELLATION: 'CX — Class cancellation (legacy rows)',
  CX_W_CANCELLATION: 'CX-W — Cancellation (waitlist, legacy rows)',
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


// PL-66: registry organization for the templates page — grouped headings with
// per-group counts, flat scan/search feel within each group. Templates map to
// the FIRST matching group; anything unmatched lands in "Class sequence"
// (the E-series + LR + SU).
export const TEMPLATE_GROUPS: { name: string; match: (key: string) => boolean }[] = [
  { name: 'Class sequence', match: (k) => /^E\d|^LR_|^SU_/.test(k) && !/^E8_ADDON/.test(k) },
  { name: 'Payment reminders', match: (k) => /^PR\d/.test(k) },
  { name: 'Waitlist & interest', match: (k) => /^W\d|^NW_|^WR_/.test(k) },
  { name: 'Cancellation', match: (k) => /^CX_/.test(k) && k !== 'CX_C_CANCELLATION' },
  { name: 'Agreements', match: (k) => /^AG_/.test(k) },
  {
    name: 'Tutoring families',
    match: (k) => /^T\d(?!_TUTOR|_NOTES)|^T1B|^T_SCHEDULE|^E8_ADDON/.test(k) && k !== 'T5_TIMECARD_READY',
  },
  {
    name: 'Counselors & schools',
    match: (k) => /^CD_|^FP_|^CR_/.test(k) || k === 'CX_C_CANCELLATION',
  },
  {
    name: 'Tutors & staff',
    match: (k) => k === 'T5_TIMECARD_READY' || k === 'T3_TUTOR_NOTICE' || /^T\d_NOTES|^IN_/.test(k),
  },
  {
    name: 'Internal admin alerts',
    match: (k) => /^AL_|^ADMIN_/.test(k),
  },
]

export function templateGroupFor(key: string): string {
  return TEMPLATE_GROUPS.find((g) => g.match(key))?.name ?? 'Class sequence'
}
