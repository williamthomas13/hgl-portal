import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, wrap, footerT, type Rendered } from './email'
import { renderRegistered } from './comms-registered'
import { formatDateFull } from './dates'
import { classDetailsSendDate, localDate, registrationCloseFor, type ClassBundle } from './lifecycle'
import { createGcalEvent, deleteGcalEvent, loadGcalConnection, patchGcalEvent } from './gcal'

// PL-78/PL-79: instructors stop being out of the loop. Every send and every
// calendar event here is gated on instructors.comms_enabled — the explicit
// per-instructor switch that reproduces the batch-11 safety gate (the doc
// assumed no emails were on file; login emails exist, so the switch is the
// real opt-in, and flipping it on is the one-time idempotent backfill
// moment). Everything is dedupe-keyed, so the hourly cron re-running is the
// backfill mechanism: welcome + digest + calendar converge on their own.

const appUrl = () => emailBaseUrl()

export type ClassInstructor = {
  id: string
  name: string | null
  email: string
  commsEnabled: boolean
  timezone: string | null
}

/** The assigned, comms-enabled instructor for a bundle — or null. */
export async function loadClassInstructor(bundle: ClassBundle): Promise<ClassInstructor | null> {
  if (!bundle.instructorId) return null
  const { data } = await supabase
    .from('instructors')
    .select('id, name, email, comms_enabled, timezone')
    .eq('id', bundle.instructorId)
    .maybeSingle()
  if (!data?.email || !data.comms_enabled) return null
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    commsEnabled: true,
    timezone: data.timezone ?? null,
  }
}

/** PL-73 house format. */
export function instructorCountsLine(bundle: ClassBundle): string {
  const paid = bundle.enrollments.filter(
    (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
  ).length
  return `${paid} enrolled / ${bundle.minEnrollment} min / ${bundle.capacity} cap`
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || 'there'

function scheduleListHtml(bundle: ClassBundle): string {
  const rows = [...bundle.sessions]
    .sort((a, b) => `${a.session_date}${a.start_time ?? ''}`.localeCompare(`${b.session_date}${b.start_time ?? ''}`))
    .map((s) => {
      const t = s.start_time ? ` — ${s.start_time.slice(0, 5)}${s.end_time ? `–${s.end_time.slice(0, 5)}` : ''}` : ''
      return `<li style="margin:2px 0">${formatDateFull(s.session_date)}${t}${s.location ? ` · ${s.location}` : ''}</li>`
    })
  return rows.length ? `<ul style="margin:0;padding-left:20px;color:#334155">${rows.join('')}</ul>` : ''
}

function instructorStub(bundle: ClassBundle, instructor: ClassInstructor) {
  return {
    parentFirstName: firstName(instructor.name),
    parentEmail: instructor.email,
    schoolNickname: bundle.schoolLabel,
    classType: bundle.classType,
    schoolName: bundle.schoolName,
    firstSession: bundle.firstSession,
    calendarPageUrl: `${appUrl()}/classes/${bundle.id}/calendar`,
  }
}

function baseExtras(bundle: ClassBundle, instructor: ClassInstructor) {
  return {
    tutorFirstName: firstName(instructor.name),
    instructorCountsLine: instructorCountsLine(bundle),
    instructorViewLink: `${appUrl()}/portal?view=instructor`,
    registrationCloseDate: formatDateFull(registrationCloseFor(bundle)),
    // PL-88: name the school — "in person at SIS (Stockholm International
    // School)" / online equivalent.
    classSummaryLine: `<strong>${bundle.schoolLabel} ${bundle.classType}</strong> — starts ${formatDateFull(bundle.firstSession)}, ${
      bundle.deliveryMode === 'online'
        ? `online — ${bundle.schoolLabel} (${bundle.schoolName})`
        : `in person at ${bundle.schoolLabel} (${bundle.schoolName})`
    }`,
  }
}

// ---------------------------------------------------------------------------
// IN_WELCOME — once per class × instructor; the cron pass IS the backfill.
// ---------------------------------------------------------------------------

export async function sendInstructorWelcome(
  bundle: ClassBundle,
  instructor: ClassInstructor
): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed'> {
  const extras = {
    ...baseExtras(bundle, instructor),
    // PL-80c: IN_WELCOME's own variable — {scheduleBlock} belongs to tutoring.
    classScheduleBlock: scheduleListHtml(bundle),
  }
  const stub = instructorStub(bundle, instructor)
  const fallback = (): Rendered => ({
    subject: `You're teaching ${bundle.schoolLabel} ${bundle.classType} — everything about it lives here`,
    html: wrap(
      `<p>Hi ${extras.tutorFirstName},</p>
       <p>You're the instructor for <strong>${bundle.schoolLabel} ${bundle.classType}</strong> — here's your setup in one email.</p>
       <p>${extras.classSummaryLine}</p>
       <p>Current enrollment: <strong>${extras.instructorCountsLine}</strong>.</p>
       ${extras.classScheduleBlock}
       <p><strong>Your class page</strong> has the live count, the session calendar, and a timeline
       of every email your families receive (so you never have to guess what they've been told):</p>
       <p style="margin:20px 0"><a href="${extras.instructorViewLink}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open your class page</a></p>
       <p>Want the sessions in your own calendar? They're already being added for you — and the
       <a href="${stub.calendarPageUrl}">subscribe link</a> works in any calendar app as a backup.</p>
       <p>One line on what to expect: you'll get a weekly enrollment update while registration is
       open, and an FYI copy whenever we send your families logistics emails. Nothing in those
       needs a reply — they're there so you're never out of the loop.</p>`,
      { preheader: 'Count, calendar, and what families have been told — one page.', footer: footerT() }
    ),
  })
  const email = await renderRegistered('IN_WELCOME', stub, extras, fallback)
  return sendOnce({
    dedupeKey: `in_welcome:${bundle.id}:${instructor.id}`,
    emailType: 'instructor_welcome',
    templateKey: 'IN_WELCOME',
    recipientRole: 'instructor',
    classId: bundle.id,
    to: [instructor.email],
    subject: email.subject,
    html: email.html,
  })
}

// ---------------------------------------------------------------------------
// IN_DIGEST — weekly Mondays while registration is open, plus instant
// milestone pings (same template, variant line, distinct dedupe keys).
// ---------------------------------------------------------------------------

export type DigestVariant = 'weekly' | 'min_met' | 'class_full' | 'registration_closed'

const MILESTONE_LINES: Record<Exclude<DigestVariant, 'weekly'>, string> = {
  min_met: '<p><strong>🎉 The class just reached its minimum — it officially runs.</strong></p>',
  class_full: '<p><strong>The class is full — every spot is taken.</strong></p>',
  registration_closed: '<p><strong>Registration is closed — this is the final count.</strong></p>',
}

// PL-95: the "what happens from here" footer, per variant — reassurance
// about what's automatic, so a ping never reads like assigned homework.
// Same composed-variant machinery as the milestone lines. Exported for the
// regression scripts.
export function digestNextStepsHtml(bundle: ClassBundle, variant: DigestVariant): string {
  const regClose = formatDateFull(registrationCloseFor(bundle))
  const style = 'color:#64748b;font-size:13px;margin-top:16px'
  if (variant === 'min_met') {
    const fourSend = formatDateFull(classDetailsSendDate(bundle))
    return `<p style="${style}">Nothing you need to do. From here, automatically: families get the class-details email on ${fourSend} — you'll receive an FYI copy · registration stays open through ${regClose}, and you'll get another ping if the class fills · the sessions are already on your calendar.</p>`
  }
  if (variant === 'class_full') {
    return `<p style="${style}">Registration is effectively done — you'll get the final count when it closes on ${regClose}. Nothing to do.</p>`
  }
  if (variant === 'registration_closed') {
    const paid = bundle.enrollments.filter(
      (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
    ).length
    return `<p style="${style}">Final roster: ${paid} student${paid === 1 ? '' : 's'}. Families get their location reminder before day one (FYI to you) · attendance lives on your class page from the first session.</p>`
  }
  return `<p style="${style}">Nothing needed — this is just your weekly picture.</p>`
}

export async function sendInstructorDigest(
  bundle: ClassBundle,
  instructor: ClassInstructor,
  variant: DigestVariant,
  dedupeKey: string
): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed'> {
  const extras = {
    ...baseExtras(bundle, instructor),
    digestMilestoneLine: variant === 'weekly' ? '' : MILESTONE_LINES[variant],
    digestNextStepsBlock: digestNextStepsHtml(bundle, variant),
  }
  const stub = instructorStub(bundle, instructor)
  const fallback = (): Rendered => ({
    subject: `${bundle.schoolLabel} ${bundle.classType}: ${extras.instructorCountsLine}`,
    html: wrap(
      `<p>Hi ${extras.tutorFirstName},</p>
       ${extras.digestMilestoneLine}
       <p><strong>${bundle.schoolLabel} ${bundle.classType}</strong>: ${extras.instructorCountsLine}
       · registration closes ${extras.registrationCloseDate} · first session ${formatDateFull(bundle.firstSession)}.</p>
       <p style="margin:20px 0"><a href="${extras.instructorViewLink}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open your class page</a></p>
       ${extras.digestNextStepsBlock}`,
      { preheader: 'Your weekly enrollment picture.', footer: footerT() }
    ),
  })
  const email = await renderRegistered('IN_DIGEST', stub, extras, fallback)
  return sendOnce({
    dedupeKey,
    emailType: 'instructor_digest',
    templateKey: 'IN_DIGEST',
    recipientRole: 'instructor',
    classId: bundle.id,
    to: [instructor.email],
    subject: email.subject,
    html: email.html,
  })
}

/** Cron pass: welcome backfill + Monday digest + registration-closed ping. */
export async function sweepInstructorComms(
  bundle: ClassBundle,
  now: Date = new Date()
): Promise<{ welcomed: number; digested: number }> {
  const result = { welcomed: 0, digested: 0 }
  if (bundle.status === 'cancelled') return result
  const instructor = await loadClassInstructor(bundle)
  if (!instructor) return result

  const today = localDate(bundle.timezone)
  if ((await sendInstructorWelcome(bundle, instructor)) === 'sent') result.welcomed++

  const regClose = registrationCloseFor(bundle)
  const isMonday = new Date(today + 'T12:00:00Z').getUTCDay() === 1
  if (isMonday && today <= regClose && today < bundle.firstSession) {
    if ((await sendInstructorDigest(bundle, instructor, 'weekly', `in_digest:${bundle.id}:${today}`)) === 'sent')
      result.digested++
  }
  if (today > regClose) {
    if (
      (await sendInstructorDigest(
        bundle,
        instructor,
        'registration_closed',
        `in_digest_closed:${bundle.id}`
      )) === 'sent'
    )
      result.digested++
  }
  void now
  return result
}

/** Event-driven pings (PL-51 pattern — fired from the payment webhook the
 *  moment a count crosses a milestone; dedupe keys make retries no-ops). */
export async function sendInstructorMilestones(bundle: ClassBundle): Promise<void> {
  const instructor = await loadClassInstructor(bundle)
  if (!instructor) return
  const paid = bundle.enrollments.filter(
    (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
  ).length
  if (paid >= bundle.minEnrollment) {
    await sendInstructorDigest(bundle, instructor, 'min_met', `in_digest_min:${bundle.id}`)
  }
  if (paid >= bundle.capacity) {
    await sendInstructorDigest(bundle, instructor, 'class_full', `in_digest_full:${bundle.id}`)
  }
}

// ---------------------------------------------------------------------------
// IN_FYI — one copy per family logistics batch (#4 / #5 / SU / CX). The
// per-day dedupe key makes "once per batch" emerge naturally from the loops.
// ---------------------------------------------------------------------------

/** Pull the body content out of a wrap()-rendered email so it can ride
 *  {familyEmailBlock} inside the FYI's own shell (never nest full docs). */
export function extractEmailBody(html: string): string {
  const start = html.indexOf('<div style="border-top:4px solid #00AEEE;padding:24px 8px">')
  const footer = html.indexOf('<div style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:12px">')
  if (start === -1 || footer === -1 || footer <= start) return html
  return html.slice(start + '<div style="border-top:4px solid #00AEEE;padding:24px 8px">'.length, footer)
}

export async function maybeSendInstructorFyi(
  bundle: ClassBundle,
  familyTemplateKey: string,
  familySubject: string,
  familyHtml: string
): Promise<void> {
  const instructor = await loadClassInstructor(bundle)
  if (!instructor) return
  const day = localDate(bundle.timezone)
  const extras = {
    ...baseExtras(bundle, instructor),
    fyiOriginalSubject: familySubject,
    familyEmailBlock: extractEmailBody(familyHtml),
  }
  const stub = instructorStub(bundle, instructor)
  const fallback = (): Rendered => ({
    subject: `FYI: ${familySubject}`,
    html: wrap(
      `<p><strong>FYI — this was just sent to your ${bundle.schoolLabel} ${bundle.classType}
       families. Nothing for you to do.</strong></p>
       ${extras.familyEmailBlock}`,
      { preheader: 'Copy of what your families just received — nothing to do.', footer: footerT() }
    ),
  })
  const email = await renderRegistered('IN_FYI', stub, extras, fallback)
  await sendOnce({
    dedupeKey: `in_fyi:${bundle.id}:${familyTemplateKey}:${day}`,
    emailType: 'instructor_fyi',
    templateKey: 'IN_FYI',
    recipientRole: 'instructor',
    classId: bundle.id,
    to: [instructor.email],
    subject: email.subject,
    html: email.html,
  }).catch((e) => console.error('instructor FYI failed (family sends stand):', e))
}

// ---------------------------------------------------------------------------
// PL-79 — class sessions on the instructor's own calendar. Events are created
// via the delegated service account ON the instructor's primary calendar (no
// attendees → sendUpdates=none: zero invite noise; IN_WELCOME is what tells
// them to look). Idempotent converge: create missing, patch drifted,
// delete when the owner changed or comms is off. Past sessions are left
// alone.
// ---------------------------------------------------------------------------

export async function syncInstructorClassCalendar(bundle: ClassBundle): Promise<void> {
  const conn = await loadGcalConnection()
  if (!conn?.key || conn.status !== 'connected') return
  const instructor = bundle.status === 'cancelled' ? null : await loadClassInstructor(bundle)
  const desiredEmail = instructor?.email ?? null

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, session_date, start_time, end_time, location, instructor_gcal_event_id, instructor_gcal_email')
    .eq('class_id', bundle.id)
  const today = localDate(bundle.timezone)

  for (const s of sessions ?? []) {
    if (s.session_date < today) continue // never touch the past
    const label = `${bundle.schoolLabel} ${bundle.classType}`
    const startsAt = `${s.session_date}T${s.start_time ?? '09:00:00'}`
    const endsAt = `${s.session_date}T${s.end_time ?? s.start_time ?? '10:00:00'}`
    const input = {
      tutorEmail: desiredEmail ?? s.instructor_gcal_email ?? '',
      calendarId: null,
      summary: `${label} — class session`,
      description: `Higher Ground Learning class session.\nYour class page: ${appUrl()}/portal?view=instructor`,
      location: s.location ?? bundle.defaultLocation ?? null,
      startsAt,
      endsAt,
      timezone: bundle.timezone,
      attendees: [] as string[], // none → sendUpdates=none, never invite noise
    }
    try {
      if (s.instructor_gcal_event_id && s.instructor_gcal_email !== desiredEmail) {
        // Owner changed (reassignment or comms switched off): remove the old
        // instructor's event.
        await deleteGcalEvent(conn.key, s.instructor_gcal_email!, null, s.instructor_gcal_event_id)
        await supabase
          .from('sessions')
          .update({ instructor_gcal_event_id: null, instructor_gcal_email: null })
          .eq('id', s.id)
        s.instructor_gcal_event_id = null
        s.instructor_gcal_email = null
      }
      if (!desiredEmail) continue
      if (s.instructor_gcal_event_id) {
        // Converge details (time/location edits flow through automatically).
        await patchGcalEvent(conn.key, s.instructor_gcal_event_id, { ...input, tutorEmail: desiredEmail })
      } else {
        const eventId = await createGcalEvent(conn.key, { ...input, tutorEmail: desiredEmail })
        await supabase
          .from('sessions')
          .update({ instructor_gcal_event_id: eventId, instructor_gcal_email: desiredEmail })
          .eq('id', s.id)
      }
    } catch (e) {
      console.error(`instructor calendar sync failed for session ${s.id} (next sweep retries):`, e)
    }
  }
}
