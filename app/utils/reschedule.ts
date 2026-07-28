import { supabaseAdmin as supabase } from './supabase-admin'
import { enqueueGcalSync } from './gcal-sync'
import { classifyNotice } from './tutoring'
import { sendScheduleChangeNotices } from './tutoring-emails'

// The ONE reschedule code path (extracted from the session route for
// PL-180): tombstone + replacement, 24h notice classification (fee logic),
// free-reschedule event move vs late-reschedule XCL, T3 family/tutor
// notices. The staff reschedule action AND PL-180's calendar-edit Adopt both
// run through here — adopting a calendar drag is never a back door around
// the machinery. The caller drains the gcal queue and awaits the returned
// notices promise (or lets after() do both).

export type RescheduleResult =
  | { ok: true; replacementId: string; notice: 'ok' | 'late'; followUp: () => Promise<unknown> }
  | { ok: false; error: string; status: number }

export async function rescheduleSession(opts: {
  id: string
  newStartsAt: string
  newEndsAt: string
  /** Override; default = 24h auto-classification against the ORIGINAL slot. */
  notice?: 'ok' | 'late'
  note?: string | null
  requestedBy?: string
}): Promise<RescheduleResult> {
  const { data: original } = await supabase
    .from('tutoring_sessions')
    .select('id, engagement_id, student_id, tutor_id, starts_at, rate_snapshot, status, gcal_event_id')
    .eq('id', opts.id)
    .maybeSingle()
  if (!original) return { ok: false, error: 'Unknown session.', status: 404 }
  if (original.status !== 'confirmed' && original.status !== 'proposed') {
    return { ok: false, error: `A ${original.status} session cannot be rescheduled.`, status: 400 }
  }
  const notice = opts.notice ?? classifyNotice(new Date(original.starts_at))

  const { data: replacement, error: insertError } = await supabase
    .from('tutoring_sessions')
    .insert({
      engagement_id: original.engagement_id,
      student_id: original.student_id,
      tutor_id: original.tutor_id,
      starts_at: opts.newStartsAt,
      ends_at: opts.newEndsAt,
      status: 'confirmed',
      rate_snapshot: original.rate_snapshot,
      // Free reschedule MOVES the Google event (spec §4): the replacement
      // inherits the id and the push patches it to the new time. Late
      // reschedule keeps the original event (XCL-marked — the tutor is
      // paid for the reserved slot) and this row gets a fresh event.
      gcal_event_id: notice === 'ok' ? original.gcal_event_id : null,
    })
    .select('id')
    .single()
  if (insertError || !replacement) {
    return { ok: false, error: insertError?.message ?? 'Insert failed.', status: 500 }
  }

  const { error: updateError } = await supabase
    .from('tutoring_sessions')
    .update({
      status: 'rescheduled',
      rescheduled_to_id: replacement.id,
      reschedule_notice: notice,
      gcal_event_id: notice === 'ok' ? null : original.gcal_event_id,
      cancelled_at: new Date().toISOString(),
      cancelled_by: opts.requestedBy ?? 'staff',
      cancel_note: opts.note ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', original.id)
  if (updateError) return { ok: false, error: updateError.message, status: 500 }

  await enqueueGcalSync(replacement.id, `reschedule (${notice})`)
  if (notice === 'late') await enqueueGcalSync(original.id, 'late reschedule — XCL original')

  const wasConfirmed = original.status === 'confirmed'
  // T3 (§6.5): confirmed-session changes notify the family + tutor. Returned
  // as a thunk so route callers can ride it on after() and direct callers
  // can await it.
  const followUp = () =>
    wasConfirmed
      ? sendScheduleChangeNotices({
          sessionId: original.id,
          kind: 'reschedule',
          notice,
          replacementId: replacement.id,
        })
      : Promise.resolve()

  return { ok: true, replacementId: replacement.id, notice, followUp }
}
