import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { loadClassBundles, emailContext, classDetailsSnapshot, sessionListChanges } from '../../../utils/lifecycle'
import { renderEmail } from '../../../utils/comms-db-render'
import { scheduleUpdateEmail, scheduleChangeLi, sendOnce, formatDate } from '../../../utils/email'
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

type Body =
  | {
      action: 'edit'
      id: string
      session_date: string
      start_time: string | null
      end_time: string | null
      location: string | null
    }
  | {
      /** PL-329: bulk time/location edit — ONE schedule-update pair per
       *  family summarizing every changed session via the shared differ,
       *  never one email per session. */
      action: 'bulk_edit'
      class_id: string
      start_time?: string | null
      end_time?: string | null
      location?: string | null
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
  // ------------------------------------------------------------------
  // PL-329: bulk edit — apply one time/location to EVERY session of a
  // class, then notify each informed family ONCE with the full change
  // list from the shared PL-314 differ.
  if (body.action === 'bulk_edit') {
    if (!body.class_id || (body.start_time == null && body.end_time == null && body.location === undefined)) {
      return NextResponse.json({ error: 'Pass class_id and at least one field to apply.' }, { status: 400 })
    }
    if (body.start_time && body.end_time && body.end_time <= body.start_time) {
      return NextResponse.json({ error: 'End time must be after the start time.' }, { status: 400 })
    }
    const { data: clsRow } = await supabase
      .from('classes')
      .select('id, status')
      .eq('id', body.class_id)
      .maybeSingle()
    if (!clsRow) return NextResponse.json({ error: 'Unknown class.' }, { status: 404 })
    if (clsRow.status === 'cancelled') {
      return NextResponse.json({ error: 'This class is cancelled — its sessions are read-only.' }, { status: 400 })
    }
    const beforeBundle = (await loadClassBundles()).find((b) => b.id === body.class_id)
    if (!beforeBundle) return NextResponse.json({ error: 'Unknown class.' }, { status: 404 })
    const beforeSessions = classDetailsSnapshot(beforeBundle).sessions

    const patch: Record<string, unknown> = {}
    if (body.start_time != null) patch.start_time = body.start_time
    if (body.end_time != null) patch.end_time = body.end_time
    if (body.location !== undefined) patch.location = body.location
    const { error: bulkErr } = await supabase.from('sessions').update(patch).eq('class_id', body.class_id)
    if (bulkErr) return NextResponse.json({ error: bulkErr.message }, { status: 500 })

    const bundle = (await loadClassBundles()).find((b) => b.id === body.class_id)
    if (!bundle) return NextResponse.json({ ok: true, changed: true, emailed: 0 })
    const afterSessions = classDetailsSnapshot(bundle).sessions
    const changes = sessionListChanges(beforeSessions, afterSessions)
    if (changes.length === 0) return NextResponse.json({ ok: true, changed: false, emailed: 0 })

    const enrollmentIds = bundle.enrollments.map((e) => e.id)
    const { data: sentDetails } = enrollmentIds.length
      ? await supabase
          .from('email_sends')
          .select('enrollment_id, payload')
          .eq('template_key', 'E4_CLASS_DETAILS')
          .in('status', ['sent', 'delivered', 'bounced', 'complained'])
          .in('enrollment_id', enrollmentIds)
      : { data: [] }
    const e4Informed = new Set(((sentDetails as any[]) ?? []).map((r) => r.enrollment_id))
    const informed = new Set(e4Informed)
    const { data: regRows } = enrollmentIds.length
      ? await supabase
          .from('enrollments')
          .select('id, schedule_snapshot')
          .in('id', enrollmentIds)
          .not('schedule_snapshot', 'is', null)
      : { data: [] }
    for (const r of (regRows as any[]) ?? []) informed.add(r.id)

    const bulkHash = createHash('md5')
      .update(JSON.stringify(changes.map((c) => c.sentence)))
      .digest('hex')
      .slice(0, 8)
    const changesBlock = `<ul style="padding-left:20px">${changes.map(scheduleChangeLi).join('')}</ul>`
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
        dedupeKey: `su_bulk_p:${e.id}:${bulkHash}`,
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
          dedupeKey: `su_bulk_s:${e.id}:${bulkHash}`,
          emailType: 'schedule_update',
          templateKey: 'SU_SCHEDULE_UPDATE',
          to: [ctx.studentEmail],
          subject: student.subject,
          html: student.html,
        })
        if (sStatus === 'sent') emailed++
      }
    }
    if (emailed > 0 && lastHtml) {
      await maybeSendInstructorFyi(bundle, 'SU_SCHEDULE_UPDATE', lastHtml.subject, lastHtml.html).catch(
        (err) => console.error('bulk-edit instructor FYI failed:', err)
      )
    }
    // Refresh both baseline kinds so the sweep doesn't re-announce.
    const freshSessions = afterSessions
    const newFirst = bundle.firstSession
    for (const row of (sentDetails as any[]) ?? []) {
      if (!row.payload) continue
      await supabase
        .from('email_sends')
        .update({
          payload: {
            ...row.payload,
            first_session: newFirst,
            ...(Array.isArray(row.payload.sessions) ? { sessions: freshSessions } : {}),
          },
        })
        .eq('template_key', 'E4_CLASS_DETAILS')
        .eq('enrollment_id', row.enrollment_id)
        .in('status', ['sent', 'delivered', 'bounced', 'complained'])
    }
    for (const row of (regRows as any[]) ?? []) {
      if (e4Informed.has(row.id)) continue
      await supabase
        .from('enrollments')
        .update({
          schedule_snapshot: { ...row.schedule_snapshot, first_session: newFirst, sessions: freshSessions },
        })
        .eq('id', row.id)
    }
    return NextResponse.json({ ok: true, changed: true, emailed, changes: changes.map((c) => c.sentence) })
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

  // Plain-English change list — complete sentences (PL-314's shared shape,
  // rendered identically by the sweep, this route, and the SU twin).
  const changes: { label: string; value: string; sentence: string }[] = []
  const oldLabel = `The ${formatDate(session.session_date)} session`
  if (session.session_date !== body.session_date) {
    changes.push({
      label: oldLabel,
      value: `moved to ${formatDate(body.session_date)}`,
      sentence: `${oldLabel} moved to ${formatDate(body.session_date)}.`,
    })
  }
  if (fmtT(session.start_time) !== fmtT(body.start_time) || fmtT(session.end_time) !== fmtT(body.end_time)) {
    const span = [fmtT(body.start_time), fmtT(body.end_time)].filter(Boolean).join('–') || 'time TBD'
    changes.push({
      label: `${oldLabel}'s time`,
      value: span,
      sentence: `${oldLabel}'s time is now ${span}.`,
    })
  }
  if ((session.location ?? '') !== (body.location ?? '')) {
    changes.push({
      label: `${oldLabel}'s location`,
      value: body.location ?? 'the class default',
      sentence: `${oldLabel}'s location is now ${body.location ?? 'the class default'}.`,
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

  // Who knows the schedule: enrollments with a sent-ish E4 row — PLUS, per
  // PL-314, every enrollment carrying a registration snapshot (families
  // registered SEEING the session calendar; they paid for what they saw).
  const enrollmentIds = bundle.enrollments.map((e) => e.id)
  const { data: sentDetails } = enrollmentIds.length
    ? await supabase
        .from('email_sends')
        .select('enrollment_id, payload')
        .eq('template_key', 'E4_CLASS_DETAILS')
        .in('status', ['sent', 'delivered', 'bounced', 'complained'])
        .in('enrollment_id', enrollmentIds)
    : { data: [] }
  const e4Informed = new Set(((sentDetails as any[]) ?? []).map((r) => r.enrollment_id))
  const informed = new Set(e4Informed)
  const { data: regRows } = enrollmentIds.length
    ? await supabase
        .from('enrollments')
        .select('id, schedule_snapshot')
        .in('id', enrollmentIds)
        .not('schedule_snapshot', 'is', null)
    : { data: [] }
  for (const r of (regRows as any[]) ?? []) informed.add(r.id)

  const hash = createHash('md5')
    .update(
      `${session.session_date}|${fmtT(session.start_time)}|${fmtT(session.end_time)}|${session.location ?? ''}>` +
        `${body.session_date}|${fmtT(body.start_time)}|${fmtT(body.end_time)}|${body.location ?? ''}`
    )
    .digest('hex')
    .slice(0, 8)
  const changesBlock = `<ul style="padding-left:20px">${changes
    .map(scheduleChangeLi)
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

  // Patch stored baselines so the sweep's own SU diff doesn't re-announce
  // the same change next hour: E4 snapshots get the new first-session AND
  // (PL-314) the fresh session list when they carry one; registration
  // snapshots always carry the list, so they refresh to current.
  const newFirst = bundle.firstSession
  const freshSessions = classDetailsSnapshot(bundle).sessions
  for (const row of (sentDetails as any[]) ?? []) {
    if (!row.payload) continue
    const carriesList = Array.isArray(row.payload.sessions)
    if (row.payload.first_session === newFirst && !carriesList) continue
    await supabase
      .from('email_sends')
      .update({
        payload: {
          ...row.payload,
          first_session: newFirst,
          ...(carriesList ? { sessions: freshSessions } : {}),
        },
      })
      .eq('template_key', 'E4_CLASS_DETAILS')
      .eq('enrollment_id', row.enrollment_id)
      .in('status', ['sent', 'delivered', 'bounced', 'complained'])
  }
  for (const row of (regRows as any[]) ?? []) {
    if (e4Informed.has(row.id)) continue
    await supabase
      .from('enrollments')
      .update({
        schedule_snapshot: {
          ...row.schedule_snapshot,
          first_session: newFirst,
          sessions: freshSessions,
        },
      })
      .eq('id', row.id)
  }

  return NextResponse.json({ ok: true, changed: true, emailed })
}
