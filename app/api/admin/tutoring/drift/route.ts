import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { enqueueGcalSync, processGcalQueue, syncTutoringDriftTable } from '../../../../utils/gcal-sync'
import { rescheduleSession } from '../../../../utils/reschedule'

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

  if (body.action === 'adopt' || body.action === 'revert') {
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
        return NextResponse.json(
          { error: 'The calendar event was DELETED, so there is no time to adopt — use Revert to restore the event, or cancel/forfeit the session from its row if the deletion was the intent.' },
          { status: 400 }
        )
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

    // revert: the state-driven worker patches the event back to the
    // portal's time (and recreates it if it was hand-deleted).
    await enqueueGcalSync(body.sessionId, 'revert calendar-side edit (PL-180)')
    await supabase.from('calendar_drift').delete().eq('session_id', body.sessionId)
    after(() => processGcalQueue())
    return NextResponse.json({ ok: true, reverted: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
