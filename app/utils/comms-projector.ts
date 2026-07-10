import { supabaseAdmin as supabase } from './supabase-admin'
import {
  PAYMENT_REMINDERS,
  SEQUENCE,
  addDaysISO,
  localDate,
  stepTargetDate,
  type ClassBundle,
  type EnrollmentRow,
  type TutoringPackage,
} from './lifecycle'
import { templateMetaFor, zonedTimeToUtc } from './comms'

// Feature A1/A2 projector (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A2): the
// sweep still DECIDES what to send from current DB state — this pass runs
// first and MATERIALIZES those decisions as email_sends rows with
// status='scheduled', so the dashboard's Upcoming tab is real and admin
// controls (cancel/hold/reschedule) have something to act on before the send
// moment. Reconciliation on every sweep:
//   * missing rows are inserted (insert-if-absent — sent/cancelled history
//     rows win by unique dedupe_key)
//   * date changes update scheduled_for on scheduled rows only, and never on
//     rows an admin manually rescheduled
//   * rows that no longer apply (refunded enrollment, opt-out, cancelled or
//     ended class, superseded step) get status='cancelled' with a reason —
//     never deleted (they're the audit trail)
//
// Not projected (event-driven or capacity-derived, appear in history when
// sent): waitlist offers/confirmations, counselor digests/pushes/classroom
// requests, admin alerts, cancellation blasts, login links.

const RELATIONSHIP_TYPES = new Set(['faq', 'second_diagnostic', 'review_request', 'tutoring_offer'])

type Projected = {
  dedupe_key: string
  email_type: string
  enrollment_id: string
  recipient_email: string
  scheduled_for: string
}

function hoursAfter(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString()
}

/** Every send the pipeline would make for this bundle, as (key, time, recipient). */
export function projectBundle(bundle: ClassBundle, prePackages: TutoringPackage[]): Projected[] {
  const out: Projected[] = []
  if (bundle.status === 'cancelled') return out
  // Dead-class guard mirrors the sweep: nothing left to send a month out.
  if (localDate(bundle.timezone) > addDaysISO(bundle.lastSession, 30)) return out

  const audienceTargets = (e: EnrollmentRow, parentOnly = false) => {
    const targets: { tag: 'p' | 's'; to: string }[] = [{ tag: 'p', to: e.parentEmail }]
    if (!parentOnly && e.studentEmail) targets.push({ tag: 's', to: e.studentEmail })
    return targets
  }

  for (const e of bundle.enrollments) {
    if (e.payment_status === 'Pending') {
      for (const r of PAYMENT_REMINDERS) {
        out.push({
          dedupe_key: `payment_reminder_${r.n}:${e.id}`,
          email_type: 'payment_reminder',
          enrollment_id: e.id,
          recipient_email: e.parentEmail,
          scheduled_for: hoursAfter(e.enrolled_at, r.afterHours),
        })
      }
      continue
    }
    if (e.payment_status !== 'Paid' && e.payment_status !== 'Completed') continue

    // #1 thank-you (~3h after payment) — relationship, so opt-out suppresses.
    if (e.paid_at && !e.marketingOptOut) {
      out.push({
        dedupe_key: `thank_you:${e.id}`,
        email_type: 'thank_you',
        enrollment_id: e.id,
        recipient_email: e.parentEmail,
        scheduled_for: hoursAfter(e.paid_at, 3),
      })
    }

    // #9 pre-class upsell (~24h after payment, Paid only, no add-on, window open).
    if (
      e.payment_status === 'Paid' &&
      e.paid_at &&
      !e.marketingOptOut &&
      e.addons.length === 0 &&
      prePackages.length > 0 &&
      localDate(bundle.timezone) < bundle.firstSession
    ) {
      out.push({
        dedupe_key: `tutoring_upsell:${e.id}`,
        email_type: 'tutoring_upsell',
        enrollment_id: e.id,
        recipient_email: e.parentEmail,
        scheduled_for: hoursAfter(e.paid_at, 24),
      })
    }

    // The post-payment sequence #2–#8, audience-split like the sweep.
    for (const step of SEQUENCE) {
      if (RELATIONSHIP_TYPES.has(step.type) && e.marketingOptOut) continue
      const when = zonedTimeToUtc(stepTargetDate(step, bundle), step.hour, bundle.timezone).toISOString()
      for (const t of audienceTargets(e, step.type === 'review_request')) {
        out.push({
          dedupe_key: `${step.type}_${t.tag}:${e.id}`,
          email_type: step.type,
          enrollment_id: e.id,
          recipient_email: t.to,
          scheduled_for: when,
        })
      }
    }
  }
  return out
}

/** Reconcile one bundle's projection against email_sends. */
export async function projectScheduledSends(
  bundle: ClassBundle,
  prePackages: TutoringPackage[]
): Promise<{ inserted: number; retimed: number; cancelled: number }> {
  const result = { inserted: 0, retimed: 0, cancelled: 0 }
  const projected = projectBundle(bundle, prePackages)
  const byKey = new Map(projected.map((p) => [p.dedupe_key, p]))

  const { data: existing, error } = await supabase
    .from('email_sends')
    .select('id, dedupe_key, status, scheduled_for, manually_rescheduled')
    .eq('class_id', bundle.id)
    .in('status', ['scheduled', 'held'])
  if (error) {
    console.error(`projector read failed for class ${bundle.id}:`, error.message)
    return result
  }
  const existingByKey = new Map((existing ?? []).map((r) => [r.dedupe_key, r]))

  // Insert-if-absent: history (sent/cancelled) rows win via unique dedupe_key.
  const toInsert = projected.filter((p) => !existingByKey.has(p.dedupe_key))
  if (toInsert.length > 0) {
    const rows = toInsert.map((p) => {
      const meta = templateMetaFor(p.email_type, p.dedupe_key)
      return {
        dedupe_key: p.dedupe_key,
        template_key: meta.key,
        recipient_role: meta.role,
        enrollment_id: p.enrollment_id,
        class_id: bundle.id,
        recipient_email: p.recipient_email.toLowerCase(),
        scheduled_for: p.scheduled_for,
        status: 'scheduled',
      }
    })
    const { error: insertError, count } = await supabase
      .from('email_sends')
      .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true, count: 'exact' })
    if (insertError) console.error(`projector insert failed for class ${bundle.id}:`, insertError.message)
    else result.inserted = count ?? rows.length
  }

  for (const row of existing ?? []) {
    const p = byKey.get(row.dedupe_key)
    if (!p) {
      // No longer applicable — audit-cancel, never delete. Manual reschedules
      // are not exempt: a refunded enrollment must stop mailing regardless.
      const { error: cancelError } = await supabase
        .from('email_sends')
        .update({
          status: 'cancelled',
          cancel_reason:
            bundle.status === 'cancelled'
              ? 'class cancelled'
              : 'no longer applicable (recomputed from current enrollment/class state)',
          cancelled_by: 'system',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .in('status', ['scheduled', 'held'])
      if (!cancelError) result.cancelled++
      continue
    }
    // Date-change recomputation: scheduled rows only, hands off manual times.
    if (
      row.status === 'scheduled' &&
      !row.manually_rescheduled &&
      Math.abs(new Date(row.scheduled_for).getTime() - new Date(p.scheduled_for).getTime()) > 60_000
    ) {
      const { error: retimeError } = await supabase
        .from('email_sends')
        .update({ scheduled_for: p.scheduled_for, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'scheduled')
      if (!retimeError) result.retimed++
    }
  }
  return result
}

/** Cancelled/dead classes: sweep skips them, so the projector cancels here. */
export async function cancelScheduledForClass(classId: string, reason: string): Promise<number> {
  const { data } = await supabase
    .from('email_sends')
    .update({
      status: 'cancelled',
      cancel_reason: reason,
      cancelled_by: 'system',
      updated_at: new Date().toISOString(),
    })
    .eq('class_id', classId)
    .in('status', ['scheduled', 'held'])
    .select('id')
  return data?.length ?? 0
}
