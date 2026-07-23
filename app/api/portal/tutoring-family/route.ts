import { emailBaseUrl } from '../../../utils/base-url'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionFamily } from '../../../utils/family-gate'
import { sendAdminAlert } from '../../../utils/email'
import { ADMIN_EMAIL } from '../../../utils/lifecycle'
import { classifyNotice } from '../../../utils/tutoring'
import { computeRescheduleOffers } from '../../../utils/reschedule-offers'
import { enqueueGcalSync, processGcalQueue } from '../../../utils/gcal-sync'
import { sendScheduleChangeNotices } from '../../../utils/tutoring-emails'

// Parent tutoring actions (Phase 7d §8). Three actions:
//   offer_slots — compute 2–3 pre-approved replacement slots for a ≥24h
//     reschedule (spec v1.4, July 15). Only the offered times leave the
//     server; the tutor's calendar is never exposed.
//   pick_slot — the parent taps one and the reschedule completes INSTANTLY
//     with the same semantics as the staff move (replacement row, Google
//     event patched via the queue, T3 to family + tutor), plus an Ops
//     Director alert — nothing happens invisibly.
//   reschedule_request — the free-text fallback: the parent asks, the Ops
//     Director executes. ≥24h is free per the signed policy; <24h the UI
//     shows the $40/hour terms first and it still routes here — the Ops
//     Director's discretion wins (§3: emergencies).

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

/** Load the session with family/student/subject context and verify the
 *  signed-in parent owns it. */
async function ownedSession(sessionId: string, familyIds: string[]) {
  const { data: session } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, starts_at, ends_at, status, reschedule_requested_at,
       students!inner ( first_name, last_name, family_id ),
       tutoring_engagements ( subjects ( name ) ),
       instructors ( name )`
    )
    .eq('id', sessionId)
    .maybeSingle()
  const student: any = one(session?.students)
  if (!session || !student || !familyIds.includes(student.family_id)) return null
  return { session, student }
}

const fmtDenver = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

function subjectOf(session: any): string | null {
  const subjectName = one<any>(session.tutoring_engagements)?.subjects
  return (Array.isArray(subjectName) ? subjectName[0]?.name : subjectName?.name) ?? null
}

export async function POST(req: Request) {
  const caller = await sessionFamily()
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: {
    action?: 'reschedule_request' | 'offer_slots' | 'pick_slot'
    session_id?: string
    note?: string
    starts_at?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.session_id || !body.action) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  const owned = await ownedSession(body.session_id, caller.familyIds)
  if (!owned) return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
  const { session, student } = owned

  if (session.status !== 'confirmed') {
    return NextResponse.json({ error: 'Only upcoming confirmed sessions can be rescheduled.' }, { status: 400 })
  }
  if (new Date(session.starts_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'That session has already started — get in touch instead.' }, { status: 400 })
  }

  // -------------------------------------------------------------------------
  // offer_slots: the ≥24h self-serve path (spec §8, July 15). Empty `slots`
  // tells the client to fall back to the free-text request.
  // -------------------------------------------------------------------------
  if (body.action === 'offer_slots') {
    if (classifyNotice(new Date(session.starts_at)) !== 'ok') {
      return NextResponse.json({ slots: [] }) // <24h → $40/hr request path only
    }
    const offers = await computeRescheduleOffers(session.id)
    if (offers.reason) console.log(`offer_slots ${session.id}: falling back (${offers.reason})`)
    return NextResponse.json({ slots: offers.offered })
  }

  // -------------------------------------------------------------------------
  // pick_slot: complete the reschedule instantly. The picked time is only
  // honored if the RECOMPUTED candidate set still contains it — client
  // instants are never trusted (no-self-booking, §8).
  // -------------------------------------------------------------------------
  if (body.action === 'pick_slot') {
    const pickedMs = body.starts_at ? new Date(body.starts_at).getTime() : NaN
    if (!Number.isFinite(pickedMs)) {
      return NextResponse.json({ error: 'Invalid time.' }, { status: 400 })
    }
    const offers = await computeRescheduleOffers(session.id)
    const picked = offers.candidates.find((c) => new Date(c.starts_at).getTime() === pickedMs)
    if (!offers.session || !picked) {
      return NextResponse.json(
        { error: 'That time just became unavailable — pick another, or send us a note.' },
        { status: 409 }
      )
    }
    const original = offers.session

    // Same semantics as the staff reschedule (session route): the replacement
    // inherits the Google event (free move patches it to the new time), the
    // original becomes a plain-English "rescheduled" with the pointer.
    const { data: replacement, error: insertError } = await supabase
      .from('tutoring_sessions')
      .insert({
        engagement_id: original.engagement_id,
        student_id: original.student_id,
        tutor_id: original.tutor_id,
        starts_at: picked.starts_at,
        ends_at: picked.ends_at,
        status: 'confirmed',
        rate_snapshot: original.rate_snapshot,
        gcal_event_id: original.gcal_event_id,
      })
      .select('id')
      .single()
    if (insertError || !replacement) {
      return NextResponse.json({ error: insertError?.message ?? 'Insert failed.' }, { status: 500 })
    }

    // Conditional claim: if the session stopped being 'confirmed' between the
    // recompute and now (staff moved it, double-tap), roll back the
    // replacement instead of double-booking.
    const { data: claimed, error: updateError } = await supabase
      .from('tutoring_sessions')
      .update({
        status: 'rescheduled',
        rescheduled_to_id: replacement.id,
        reschedule_notice: 'ok',
        gcal_event_id: null,
        cancelled_at: new Date().toISOString(),
        cancelled_by: 'parent',
        cancel_note: 'Family picked an offered replacement time in the portal.',
        parent_rescheduled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', original.id)
      .eq('status', 'confirmed')
      .select('id')
    if (updateError || !claimed || claimed.length === 0) {
      await supabase.from('tutoring_sessions').delete().eq('id', replacement.id)
      return NextResponse.json(
        { error: updateError?.message ?? 'That session just changed on our side — refresh and try again.' },
        { status: 409 }
      )
    }

    await enqueueGcalSync(replacement.id, 'parent picked offered slot (free reschedule)')

    const subj = subjectOf(session)
    after(() =>
      Promise.allSettled([
        processGcalQueue(),
        // T3 (§6.5): family confirmation + tutor notice, same as a staff move.
        sendScheduleChangeNotices({ sessionId: original.id, kind: 'reschedule', notice: 'ok', replacementId: replacement.id }),
        // Activity guarantee (§8): every parent-completed pick alerts the Ops
        // Director; the /admin/tutoring recent-activity list shows the same.
        sendAdminAlert({
          dedupeKey: `parent_pick:${original.id}`,
          adminEmail: ADMIN_EMAIL,
          subject: `Parent rescheduled — ${student.first_name} ${student.last_name}: ${fmtDenver(original.starts_at)} → ${fmtDenver(picked.starts_at)}`,
          body: `<p><strong>${student.first_name} ${student.last_name}</strong>'s family moved their
            ${subj ?? 'tutoring'} session themselves in the portal (picked an offered slot):</p>
            <p><strong>${fmtDenver(original.starts_at)} → ${fmtDenver(picked.starts_at)}</strong> (Denver)</p>
            <p>Free reschedule (24h+ notice). The tutor's Google Calendar and the schedule-change emails are already
            handled — nothing to do unless it looks wrong. It's also listed under
            <a href="${emailBaseUrl()}/admin/tutoring" style="color:#00AEEE">Recent parent activity on the tutoring page</a>.</p>`,
        }),
      ])
    )
    return NextResponse.json({ ok: true, new_starts_at: picked.starts_at, new_ends_at: picked.ends_at })
  }

  // -------------------------------------------------------------------------
  // reschedule_request: the original 7d fallback path, unchanged.
  // -------------------------------------------------------------------------
  if (body.action !== 'reschedule_request') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  const notice = classifyNotice(new Date(session.starts_at))
  const note = (body.note ?? '').slice(0, 1000)
  await supabase
    .from('tutoring_sessions')
    .update({
      reschedule_requested_at: new Date().toISOString(),
      reschedule_request_note: note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  const subj = subjectOf(session)
  const when = fmtDenver(session.starts_at)
  await sendAdminAlert({
    dedupeKey: `reschedule_request:${session.id}:${Date.now()}`,
    adminEmail: ADMIN_EMAIL,
    subject: `Reschedule request — ${student.first_name} ${student.last_name}, ${when} (${notice === 'ok' ? 'free, 24h+ notice' : 'INSIDE 24h — $40/hr policy'})`,
    body: `<p><strong>${student.first_name} ${student.last_name}</strong>'s family asked to move the
      ${subj ?? 'tutoring'} session on <strong>${when}</strong> (Denver).</p>
      ${note ? `<blockquote style="border-left:3px solid #cbd5e1;margin:8px 0;padding:4px 12px;color:#334155">${note.replace(/</g, '&lt;')}</blockquote>` : ''}
      <p>Notice: <strong>${notice === 'ok' ? '24h+ — free reschedule' : 'inside 24h — $40/hour late-reschedule policy (your discretion)'}</strong>.
      Use Reschedule on the session in /admin/tutoring — the family and tutor get T3 automatically
      and the calendar moves.</p>`,
  }).catch((e) => console.error('reschedule-request alert failed:', e))

  return NextResponse.json({ ok: true, notice })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
