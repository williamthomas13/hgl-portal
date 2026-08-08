// PL-309: the [HGL Admin] alert taxonomy — ONE source mapping every alert
// (registry AL_*/ADMIN_* templates AND the code-only alerts, matched by
// their dedupe-key prefix) to exactly one subscription category. The
// Settings → Notifications panel renders these categories; sendAdminAlert
// resolves its recipients from the per-staff subscriptions by category.
// Unknown/future alerts land in 'system' rather than going nowhere.
// Leaf-safe: no imports.

export const ALERT_CATEGORIES = [
  { key: 'registrations', label: 'New registrations & roster reports' },
  { key: 'payments_qbo', label: 'Payments & QuickBooks' },
  { key: 'min_enrollment', label: 'Minimum-enrollment checkpoints' },
  { key: 'class_ops', label: 'Class operations & calendars' },
  { key: 'coverage', label: 'Coverage & substitute requests' },
  { key: 'timecards', label: 'Timecards' },
  { key: 'reschedule_requests', label: 'Reschedule & schedule-change requests' },
  { key: 'pipeline', label: 'Prospective students & intake' },
  { key: 'close_match', label: 'Possible duplicate people (link prompts)' },
  { key: 'agreements', label: 'Agreements' },
  { key: 'waitlist', label: 'Waitlist' },
  { key: 'system', label: 'System health' },
] as const

export type AlertCategory = (typeof ALERT_CATEGORIES)[number]['key']

/** Every registry alert template → its one category (no orphans — the
 *  regress:alert-categories gate walks the registry against this map). */
export const TEMPLATE_ALERT_CATEGORY: Record<string, AlertCategory> = {
  AL_REGISTRATION: 'registrations',
  AL_ROSTER_REPORT: 'registrations',
  AL_WEBHOOK_FAILURE: 'payments_qbo',
  AL_QBO_FAILURE: 'payments_qbo',
  AL_DUNNING_EXHAUSTED: 'payments_qbo',
  AL_OVERDUE_10: 'payments_qbo',
  AL_OVERDUE_30: 'payments_qbo',
  AL_REFUND_REQUEST: 'payments_qbo',
  AL_MIN_ENROLLMENT: 'min_enrollment',
  AL_CLASS_DETAILS_HOLD: 'class_ops',
  AL_MISSING_DETAILS: 'class_ops',
  AL_NO_INSTRUCTOR: 'class_ops',
  ADMIN_INSTRUCTOR_NUDGE: 'class_ops',
  AL_COVERAGE_REQUEST: 'coverage',
  AL_COVERAGE_RESOLVED: 'coverage',
  AL_LEAD_ASSIGNED: 'pipeline',
  AL_INTAKE_COMPLETE: 'pipeline',
  AL_AVAILABILITY_SHARED: 'pipeline',
  AL_CLOSE_MATCH: 'close_match',
  AL_UNAGREED: 'agreements',
  AL_WAITLIST_ROLLOVER: 'waitlist',
  AL_SWEEP_OVERDUE: 'system',
  ADMIN_ALERT: 'system',
}

/** Code-only alerts (no registry template) matched by dedupe-key prefix. */
const DEDUPE_ALERT_CATEGORY: [string, AlertCategory][] = [
  ['reschedule_request', 'reschedule_requests'],
  ['parent_pick', 'reschedule_requests'],
  ['t1_change_request', 'reschedule_requests'],
  ['schedule_accept_conflict', 'reschedule_requests'],
  ['schedule_declined', 'reschedule_requests'],
  ['schedule_unconfirmed', 'reschedule_requests'],
  ['tutoring_gen_failures', 'payments_qbo'],
  ['tutoring_invoice_failed', 'payments_qbo'],
  ['tutoring_refund', 'payments_qbo'],
  ['qbo_refund_extra', 'payments_qbo'],
  ['qbo_expired', 'payments_qbo'],
  ['paid_after_cancel', 'payments_qbo'],
  ['attach_override', 'payments_qbo'],
  ['resume_pkg_gone', 'payments_qbo'],
  ['resume_total_mismatch', 'payments_qbo'],
  ['self_serve_conversion', 'payments_qbo'],
  ['agreement_unsigned', 'agreements'],
  ['gcal_sync_failed', 'class_ops'],
  ['cal_drift', 'class_ops'],
  ['intl_cal_drift', 'class_ops'],
  ['addon_sched_stalled', 'class_ops'],
  ['fo_extend_nudge', 'class_ops'],
  ['cancel_sends_stuck', 'class_ops'],
  ['classroom_answer', 'class_ops'],
  ['web_inquiry', 'pipeline'],
  ['close_match', 'close_match'],
  ['origin_guard', 'system'],
  ['unresolved_vars', 'system'],
  ['campaign_paused', 'system'],
]

/** The category an alert belongs to — template key wins, then the dedupe
 *  prefix, then 'system' (never nowhere). */
export function alertCategory(templateKey?: string | null, dedupeKey?: string | null): AlertCategory {
  if (templateKey && TEMPLATE_ALERT_CATEGORY[templateKey]) return TEMPLATE_ALERT_CATEGORY[templateKey]
  if (dedupeKey) {
    for (const [prefix, cat] of DEDUPE_ALERT_CATEGORY) {
      if (dedupeKey.startsWith(prefix)) return cat
    }
  }
  return 'system'
}

/** PL-309 defaults: what a NEW manager (Kelsie) starts granted+enabled —
 *  the tutoring side plus the PL-313 close-match prompts. Admins start with
 *  everything (today's behavior preserved). */
export const MANAGER_DEFAULT_CATEGORIES: AlertCategory[] = [
  'reschedule_requests',
  'timecards',
  'coverage',
  'close_match',
]
