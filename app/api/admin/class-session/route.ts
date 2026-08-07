import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { loadClassBundles, emailContext } from '../../../utils/lifecycle'
import { renderEmail } from '../../../utils/comms-db-render'
import { scheduleUpdateEmail, sendOnce, formatDate } from '../../../utils/email'
import { maybeSendInstructorFyi } from '../../../utils/instructor-comms'

// PL-277: per-session Edit on the roster — the missing half of "the only
// way to change a session is delete + re-add". The edit rides the SAME
// SU_SCHEDULE_UPDATE email as class-level changes, but EVENT-DRIVEN: the
// hourly sweep's snapshot diff only covers first-session/location/
// instructor (classDetailsSnapshot), so a middle-session change would
// otherwise move silently. Recipients mirror the sweep exactly — paid or
// completed enrollments that already RECEIVED the class-details email
// (everyone else gets the fresh details when #4 sends), plus the
// instructor's FYI. Dedupe is per session + transition hash: saving the
// same edit twice can't double-send; a genuinely new change sends again.
//
// When the edit moves the FIRST session, the stored E4 snapshots are
// patched to the new date so the sweep doesn't fire a second, duplicate SU
// for the same change on its next pass.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

type Body = {
  action: 'edit'
  id: string
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

const fmtT = (t: string | null) => (t ? t.slice(0, 5) : null)

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.action !== 'edit' || !body.id || !body.session_date) {
    return NextResponse.json({ error: 'Pass action=edit, id, and session_date.' }, { status: 400 })
  }
  if (body.start_time && body.end_time && body.end_time <= body.start_time) {
    return NextResponse.json({ error: 'End time must be after the start time.' }, { status: 400 })
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, start_time, end_time, location, classes ( id, status )')
    .eq('id', body.id)
    .maybeSingle()
  if (!session) return NextResponse.json({ error: 'Unknown session.' }, { status: 404 })
  const cls = one<any>(session.classes)
  if (cls?.status === 'cancelled') {
    return NextResponse.json({ error: 'This class is cancelled — its sessions are read-only.' }, { status: 400 })
  }

  // Plain-English change list (also the SU body's bullet list).
  const changes: { label: string; value: string }[] = []
  const oldLabel = `The ${formatDate(session.session_date)} session`
  if (session.session_date !== body.session_date) {
    changes.push({ label: oldLabel, value: `moved to ${formatDate(body.session_date)}` })
  }
  if (fmtT(session.start_time) !== fmtT(body.start_time) || fmtT(session.end_time) !== fmtT(body.end_time)) {
    const span = [fmtT(body.start_time), fmtT(body.end_time)].filter(Boolean).join('–') || 'time TBD'
    changes.push({
      label:
        session.session_date !== body.session_date
          ? `${oldLabel}'s time`
          : `${oldLabel}'s time`,
      value: `now ${span}`,
    })
  }
  if ((session.location ?? '') !== (body.location ?? '')) {
    changes.push({
      label: `${oldLabel}'s location`,
      value: body.location ? `now ${body.location}` : 'now the class default',
    })
  }
  if (changes.length === 0) return NextResponse.json({ ok: true, changed: false, emailed: 0 })

  const { error: upErr } = await supabase
    .from('sessions')
    .update({
      session_date: body.session_date,
      start_time: body.start_time,
      end_time: body.end_time,
      location: body.location,
    })
    .eq('id', session.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // Fresh bundle AFTER the write — session lists, first-session, contexts.
  const bundles = await loadClassBundles()
  const bundle = bundles.find((b) => b.id === session.class_id)
  if (!bundle) return NextResponse.json({ ok: true, changed: true, emailed: 0 })

  // Who already has details on paper: enrollments with a sent-ish E4 row.
  const enrollmentIds = bundle.enrollments.map((e) => e.id)
  const { data: sentDetails } = enrollmentIds.length
    ? await supabase
        .from('email_sends')
        .select('enrollment_id, payload')
        .eq('template_key', 'E4_CLASS_DETAILS')
        .in('status', ['sent', 'delivered', 'bounced', 'complained'])
        .in('enrollment_id', enrollmentIds)
    : { data: [] }
  const informed = new Set(((sentDetails as any[]) ?? []).map((r) => r.enrollment_id))

  const hash = createHash('md5')
    .update(
      `${session.session_date}|${fmtT(session.start_time)}|${fmtT(session.end_time)}|${session.location ?? ''}>` +
        `${body.session_date}|${fmtT(body.start_time)}|${fmtT(body.end_time)}|${body.location ?? ''}`
    )
    .digest('hex')
    .slice(0, 8)
  const changesBlock = `<ul style="padding-left:20px">${changes
    .map((ch) => `<li><strong>${ch.label}:</strong> ${ch.value}</li>`)
    .join('')}</ul>`

  let emailed = 0
  let lastHtml: { subject: string; html: string } | null = null
  for (const e of bundle.enrollments) {
    if (!informed.has(e.id)) continue
    if (e.payment_status !== 'Paid' && e.payment_status !== 'Completed') continue
    const ctx = emailContext(bundle, e)
    const parent = await renderEmail('SU_SCHEDULE_UPDATE', ctx, 'parent', { changesBlock }, () =>
      scheduleUpdateEmail(ctx, 'parent', changes)
    )
    const pStatus = await sendOnce({
      dedupeKey: `su_edit_p:${e.id}:${session.id}:${hash}`,
      emailType: 'schedule_update',
      templateKey: 'SU_SCHEDULE_UPDATE',
      to: [ctx.parentEmail],
      subject: parent.subject,
      html: parent.html,
    })
    if (pStatus === 'sent') emailed++
    lastHtml = parent
    if (ctx.studentEmail) {
      const student = await renderEmail('SU_SCHEDULE_UPDATE', ctx, 'student', { changesBlock }, () =>
        scheduleUpdateEmail(ctx, 'student', changes)
      )
      const sStatus = await sendOnce({
        dedupeKey: `su_edit_s:${e.id}:${session.id}:${hash}`,
        emailType: 'schedule_update',
        templateKey: 'SU_SCHEDULE_UPDATE',
        to: [ctx.studentEmail],
        subject: student.subject,
        html: student.html,
      })
      if (sStatus === 'sent') emailed++
    }
  }

  // Instructor FYI — same coalesced pathway every family-facing send uses.
  if (emailed > 0 && lastHtml) {
    await maybeSendInstructorFyi(bundle, 'SU_SCHEDULE_UPDATE', lastHtml.subject, lastHtml.html).catch(
      (err) => console.error('session-edit instructor FYI failed:', err)
    )
  }

  // First-session move: patch stored E4 snapshots so the sweep's own SU
  // diff doesn't re-announce the same change next hour.
  const newFirst = bundle.firstSession
  for (const row of (sentDetails as any[]) ?? []) {
    if (!row.payload || row.payload.first_session === newFirst) continue
    await supabase
      .from('email_sends')
      .update({ payload: { ...row.payload, first_session: newFirst } })
      .eq('template_key', 'E4_CLASS_DETAILS')
      .eq('enrollment_id', row.enrollment_id)
      .in('status', ['sent', 'delivered', 'bounced', 'complained'])
  }

  return NextResponse.json({ ok: true, changed: true, emailed })
}
