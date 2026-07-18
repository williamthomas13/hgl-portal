import { supabaseAdmin as supabase } from './supabase-admin'
import { loadClassBundles, loadTutoringPackages } from './lifecycle'
import { projectBundle, insertScheduledRows } from './comms-projector'
import { renderSendRow } from './comms-render'
import { sendOnce } from './email'

// PL-51 (option a): time-sensitive emails must not wait for the daily cron —
// the free-tier Vercel cron ticks once a day (14:00 UTC), so anything
// scheduled after that tick used to sit until the next morning (PR1's "~2h"
// promise only held for morning registrations). This narrow pass runs behind
// the registration handler's and the payment webhook's own responses:
//
//   1. materialize THIS enrollment's projected sends immediately (the
//      Upcoming tab is real from minute one, and Kelsie can Send now), and
//   2. send anything already due for this enrollment (a resumed payment days
//      after registration releases the backed-up steps on the spot).
//
// The daily cron stays untouched as the batch backstop for 8 AM sequence
// sends, nudges, sweeps, and full reconciliation. Callers run this inside
// after() with an explicit .catch — never on the request's critical path
// (the 7c floating-promise rule).

export async function runEnrollmentCommsPass(
  enrollmentId: string
): Promise<{ materialized: number; sent: number }> {
  const result = { materialized: 0, sent: 0 }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, class_id')
    .eq('id', enrollmentId)
    .maybeSingle()
  if (!enrollment?.class_id) return result

  const [[bundle], packages] = await Promise.all([
    loadClassBundles(enrollment.class_id),
    loadTutoringPackages(),
  ])
  if (!bundle) return result

  // Narrow projection: this enrollment's rows only. Retiming stays with the
  // daily cron; obsolete rows are audit-cancelled below.
  const mine = projectBundle(bundle, packages.pre).filter((p) => p.enrollment_id === enrollmentId)
  const projectedKeys = new Set(mine.map((p) => p.dedupe_key))
  result.materialized = await insertScheduledRows(bundle.id, mine)

  const { data: scheduled } = await supabase
    .from('email_sends')
    .select('id, dedupe_key, template_key, enrollment_id, class_id, recipient_email, status, scheduled_for')
    .eq('enrollment_id', enrollmentId)
    .eq('status', 'scheduled')

  // State-driven like the sweep: a row the CURRENT projection no longer
  // contains must never send from here (e.g. PR reminders after the payment
  // that triggered this very pass) — audit-cancel it in place.
  const obsolete = (scheduled ?? []).filter((r) => !projectedKeys.has(r.dedupe_key))
  if (obsolete.length > 0) {
    await supabase
      .from('email_sends')
      .update({
        status: 'cancelled',
        cancel_reason: 'no longer applicable (recomputed from current enrollment/class state)',
        cancelled_by: 'system',
        updated_at: new Date().toISOString(),
      })
      .in('id', obsolete.map((r) => r.id))
      .eq('status', 'scheduled')
  }

  // Send anything still projected AND already due. Held rows stay held;
  // renderSendRow returns null for anything not reconstructable outside the
  // pipeline (those wait for their event/sweep).
  const now = Date.now()
  const due = (scheduled ?? []).filter(
    (r) => projectedKeys.has(r.dedupe_key) && new Date(r.scheduled_for).getTime() <= now
  )
  for (const row of due) {
    try {
      const rendered = await renderSendRow(row)
      if (!rendered) continue
      const status = await sendOnce({
        dedupeKey: row.dedupe_key,
        emailType: rendered.emailType,
        enrollmentId: row.enrollment_id ?? undefined,
        classId: row.class_id ?? undefined,
        to: [row.recipient_email],
        from: rendered.from,
        subject: rendered.subject,
        html: rendered.html,
      })
      if (status === 'sent') result.sent++
    } catch (e) {
      console.error(`inline send failed for ${row.dedupe_key} (cron will retry):`, e)
    }
  }
  return result
}
