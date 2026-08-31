import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { enqueueGcalSync, processGcalQueue, syncTutoringDriftTable } from '../../../../utils/gcal-sync'
import { rescheduleSession } from '../../../../utils/reschedule'
import { classifyNotice } from '../../../../utils/tutoring'
import { sendScheduleChangeNotices } from '../../../../utils/tutoring-emails'

// PL-180: two-way calendar sync with a HUMAN GATE. Scan compares portal
// sessions against live calendar events (also run by the daily sweep);
// Adopt runs the NORMAL reschedule machinery with the calendar's time
// (parent notice, fee logic, timecards — never a back door); Revert patches
// the tutor's calendar back to the portal's time. Either way the drift row
// clears and the machinery converges — no detection loop (pending sync rows
// are skipped by the audit).

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  let body: { action?: string; sessionId?: string; tutorId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (body.action === 'scan') {
    const drift = await syncTutoringDriftTable(body.tutorId)
    return NextResponse.json({ ok: true, drift })
  }

  if (body.action === 'adopt' || body.action === 'revert' || body.action === 'record_no_show' || body.action === 'record_forfeited') {
    if (!body.sessionId) return NextResponse.json({ error: 'Missing session id.' }, { status: 400 })
    const { data: row } = await supabase
      .from('calendar_drift')
      .select('session_id, cal_starts_at, cal_ends_at')
      .eq('session_id', body.sessionId)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({
        ok: true,
        note: 'Already resolved — this drift is gone (a re-scan will confirm).',
      })
    }

    if (body.action === 'adopt') {
      if (!row.cal_starts_at || !row.cal_ends_at) {
        // PL-420: adopt-a-DELETION — the tutor deleted the event because the
        // session isn't happening. Cancel through the NORMAL machinery:
        // inside 24h = forfeited (reserved time — family billed, tutor
        // paid); ≥24h out = a free cancellation (status 'cancelled', the
        // PL-62 tombstone — never billed). Family notice either way; the
        // tutor-side notice is skipped for the free case (the change came
        // FROM their own calendar). Past sessions never adopt a deletion —
        // the PL-393 what-actually-happened buttons own that.
        const { data: before } = await supabase
          .from('tutoring_sessions')
          .select('status, starts_at')
          .eq('id', body.sessionId)
          .maybeSingle()
        if (!before || !['proposed', 'confirmed'].includes(before.status)) {
          return NextResponse.json(
            { error: 'This session is no longer in an adoptable state — re-scan and use the current options.' },
            { status: 400 }
          )
        }
        if (new Date(before.starts_at).getTime() < Date.now()) {
          return NextResponse.json(
            { error: "This session's time has passed — record what actually happened instead (no-show, forfeit, or keep the portal time)." },
            { status: 400 }
          )
        }
        const notice = classifyNotice(new Date(before.starts_at))
        const outcome = notice === 'late' ? 'forfeited' : 'cancelled'
        const wasLive = before.status === 'confirmed'
        const { error: cancelError } = await supabase
          .from('tutoring_sessions')
          .update({
            status: outcome,
            cancelled_at: new Date().toISOString(),
            cancelled_by: 'tutor',
            cancel_note: `calendar-drift banner (PL-420): adopted deletion — ${
              notice === 'late' ? 'inside 24 hours, reserved time (forfeited)' : 'free cancellation (≥24h notice)'
            }`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.sessionId)
          .in('status', ['proposed', 'confirmed'])
        if (cancelError) return NextResponse.json({ error: cancelError.message }, { status: 500 })
        await supabase.from('calendar_drift').delete().eq('session_id', body.sessionId)
        const sid = body.sessionId
        after(() =>
          Promise.allSettled(wasLive ? [sendScheduleChangeNotices({ sessionId: sid, kind: outcome })] : [])
        )
        return NextResponse.json({ ok: true, adoptedDeletion: true, outcome, notice })
      }
      // PL-393: a session whose time already passed (auto-completed) can't
      // run the reschedule machinery (nothing future to re-notice) — adopt
      // AS-HAPPENED: the record moves to the time the session actually ran;
      // open timecards/invoices follow from the sessions table as always.
      const { data: sess } = await supabase
        .from('tutoring_sessions')
        .select('status')
        .eq('id', body.sessionId)
        .maybeSingle()
      if (sess?.status === 'completed') {
        const { error } = await supabase
          .from('tutoring_sessions')
          .update({
            starts_at: row.cal_starts_at,
            ends_at: row.cal_ends_at,
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.sessionId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await supabase.from('calendar_drift').delete().eq('session_id', body.sessionId)
        return NextResponse.json({ ok: true, adopted: true, asHappened: true })
      }
      const result = await rescheduleSession({
        id: body.sessionId,
        newStartsAt: row.cal_starts_at,
        newEndsAt: row.cal_ends_at,
        requestedBy: 'staff',
        note: 'Adopted from a calendar-side edit (PL-180) — the tutor moved the event in Google.',
      })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      await supabase.from('calendar_drift').delete().eq('session_id', body.sessionId)
      after(() => Promise.allSettled([processGcalQueue(), result.followUp()]))
      return NextResponse.json({ ok: true, adopted: true, notice: result.notice, replacementId: result.replacementId })
    }

    // PL-393: past-appropriate outcomes — the session's time passed while
    // the drift sat unresolved; record what ACTUALLY happened. Same
    // mechanics as the session row's own cancel actions (reserved-time pay
    // rules unchanged: no-shows/forfeits stay payable per T5).
    if (body.action === 'record_no_show' || body.action === 'record_forfeited') {
      const outcome = body.action === 'record_no_show' ? 'no_show' : 'forfeited'
      const { error } = await supabase
        .from('tutoring_sessions')
        .update({
          status: outcome,
          cancelled_at: new Date().toISOString(),
          cancelled_by: 'staff',
          cancel_note: 'Recorded from the calendar-drift banner (PL-393) — the session time passed with the drift unresolved.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.sessionId)
        .in('status', ['proposed', 'confirmed', 'completed'])
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await supabase.from('calendar_drift').delete().eq('session_id', body.sessionId)
      await enqueueGcalSync(body.sessionId, 'drift banner past-session outcome (PL-393)')
      after(() => processGcalQueue())
      return NextResponse.json({ ok: true, recorded: outcome })
    }

    // revert: the state-driven worker patches the event back to the
    // portal's time (and recreates it if it was hand-deleted).
    await enqueueGcalSync(body.sessionId, 'revert calendar-side edit (PL-180)')
    await supabase.from('calendar_drift').delete().eq('session_id', body.sessionId)
    after(() => processGcalQueue())
    return NextResponse.json({ ok: true, reverted: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
