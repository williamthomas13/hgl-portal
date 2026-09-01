import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, wrap, footerStaff, type Rendered } from './email'
import { renderRegistered } from './comms-registered'
import { renderMarkdownBody } from './comms-md'
import { contextTimeCityLabel, formatDateFull, formatDateOnly, instructorWhenPhrase } from './dates'
import { classDetailsSendDate, effectiveDeadline, localDate, localHour, registrationCloseFor, type ClassBundle } from './lifecycle'
import { createHash } from 'crypto'
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
  /** PL-327: 'on' = digest + instant milestone pings · 'weekly' = digest only. */
  digestPref: 'on' | 'weekly'
  /** PL-327: FYI copies of family logistics emails. */
  fyiCopies: boolean
  timezone: string | null
}

/** The assigned instructor for a bundle with their PL-327 email
 *  preferences — or null when digests are OFF (which also stops the class
 *  calendar events, the same coupling the old comms_enabled toggle had).
 *  Callers gate finer sends on the returned prefs. */
export async function loadClassInstructor(bundle: ClassBundle): Promise<ClassInstructor | null> {
  if (!bundle.instructorId) return null
  const { data } = await supabase
    .from('instructors')
    .select('id, name, email, pref_class_digests, pref_fyi_copies, timezone')
    .eq('id', bundle.instructorId)
    .maybeSingle()
  if (!data?.email || data.pref_class_digests === 'off') return null
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    commsEnabled: true,
    digestPref: (data.pref_class_digests ?? 'on') as 'on' | 'weekly',
    fyiCopies: data.pref_fyi_copies !== false,
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

// PL-441: session rows render on the INSTRUCTOR's clock via the one
// instructor-clock composer — labeled, class-local secondary when the zones
// differ. The old render was the reported bug: bare class-local 24h numbers
// ("18:30–20:30") with no zone anywhere, read as local by an SLC instructor.
// Exported for the compile-and-call harness (composer-path verification).
export function scheduleListHtml(bundle: ClassBundle, instructor: ClassInstructor): string {
  const cityLabel = contextTimeCityLabel(bundle)
  const rows = [...bundle.sessions]
    .sort((a, b) => `${a.session_date}${a.start_time ?? ''}`.localeCompare(`${b.session_date}${b.start_time ?? ''}`))
    .map((s) => {
      const when = instructorWhenPhrase({
        sessionDate: s.session_date,
        startHHMM: s.start_time,
        endHHMM: s.end_time,
        classTimezone: bundle.timezone,
        classCityLabel: cityLabel,
        instructorTimezone: instructor.timezone,
      })
      return `<li style="margin:2px 0">${when}${s.location ? ` · ${s.location}` : ''}</li>`
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
    classScheduleBlock: scheduleListHtml(bundle, instructor),
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
      { preheader: 'Count, calendar, and what families have been told — one page.', footer: footerStaff() }
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

// PL-403 (Scarlett's operating model): the roster is MOSTLY final at the
// registration deadline; one or two stragglers may trickle in until class
// start. So the briefing sends promptly the morning the deadline arrives —
// roster + the straggler caveat — and each late joiner triggers ONE short
// grouped roster-update note. "Final" is claimed never: the old
// registration_closed ping flipped at class-local MIDNIGHT after the close
// date (a date column has no time-of-day) and rode the hourly sweep with no
// hour gate — landing 11 PM the night day one ENDED. The deadline email is
// the briefing moment; class start is just the hard stop.
export type DigestVariant = 'weekly' | 'min_met' | 'class_full' | 'deadline_briefing' | 'roster_addition'

const MILESTONE_LINES: Record<Exclude<DigestVariant, 'weekly' | 'roster_addition'>, string> = {
  min_met: '<p><strong>🎉 The class just reached its minimum — it officially runs.</strong></p>',
  class_full: '<p><strong>The class is full — every spot is taken.</strong></p>',
  deadline_briefing: '<p><strong>The registration deadline has arrived — here&rsquo;s your roster.</strong></p>',
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
    return `<p style="${style}">Registration is effectively done — you'll get your roster briefing at the deadline. Nothing to do.</p>`
  }
  if (variant === 'deadline_briefing') {
    const paid = bundle.enrollments.filter(
      (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
    ).length
    return `<p style="${style}">Your roster: ${paid} student${paid === 1 ? '' : 's'}. Registration technically stays open until the first session (${formatDateFull(bundle.firstSession)}), so a straggler or two may still join — you'll get a short note if anyone does. Families get their location reminder before day one (FYI to you) · attendance lives on your class page from the first session.</p>`
  }
  if (variant === 'roster_addition') {
    return `<p style="${style}">Nothing you need to do — the roster on your class page is always current.</p>`
  }
  return `<p style="${style}">Nothing needed — this is just your weekly picture.</p>`
}

export async function sendInstructorDigest(
  bundle: ClassBundle,
  instructor: ClassInstructor,
  variant: DigestVariant,
  dedupeKey: string,
  /** PL-403: the roster_addition variant's grouped "+1" line — composed by
   *  the sweep from the actual late joiners, so it can't be a static map
   *  entry. */
  opts?: { additionsLine?: string }
): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed'> {
  const extras = {
    ...baseExtras(bundle, instructor),
    digestMilestoneLine:
      variant === 'weekly'
        ? ''
        : variant === 'roster_addition'
          ? (opts?.additionsLine ?? '')
          : MILESTONE_LINES[variant],
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
      { preheader: 'Your weekly enrollment picture.', footer: footerStaff() }
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
  // PL-403: civil-hours gate for the sweep-ridden digests — the old code had
  // none, so date-boundary flips sent at ~00:05 class-local (and the close
  // ping at 11 PM Denver, after day one had ended).
  const civilHours = localHour(bundle.timezone) >= 8
  const isMonday = new Date(today + 'T12:00:00Z').getUTCDay() === 1
  if (isMonday && civilHours && today <= regClose && today < bundle.firstSession) {
    if ((await sendInstructorDigest(bundle, instructor, 'weekly', `in_digest:${bundle.id}:${today}`)) === 'sent')
      result.digested++
  }

  // PL-403: the deadline briefing — fires the morning the registration
  // deadline arrives (deadline day itself: the roster is "mostly final" and
  // the copy says stragglers may still join), never after the hard close.
  // The deadline rides the dedupe key, so extending it re-arms the briefing
  // (the min-enrollment pattern).
  const deadline = effectiveDeadline(bundle)
  const briefKey = `in_digest_brief:${bundle.id}:${deadline}`
  if (civilHours && today >= deadline && today <= regClose) {
    if ((await sendInstructorDigest(bundle, instructor, 'deadline_briefing', briefKey)) === 'sent')
      result.digested++
  }

  // PL-403: stragglers — anyone whose payment landed AFTER the last roster
  // email (briefing or a previous +1 note) gets ONE short grouped note per
  // pass: "+1: {student} — now N". Only once a briefing exists (before the
  // deadline the weekly digest is the picture), and the class must not be
  // long over (payments can settle late).
  if (today >= deadline && today <= bundle.lastSession) {
    const { data: rosterSends } = await supabase
      .from('email_sends')
      .select('dedupe_key, created_at, status')
      .eq('class_id', bundle.id)
      .or(`dedupe_key.like.in_digest_brief:${bundle.id}%,dedupe_key.like.in_roster_add:${bundle.id}%`)
    const sentRows = ((rosterSends ?? []) as { dedupe_key: string; created_at: string; status: string }[]).filter(
      (r) => !['cancelled', 'held', 'failed'].includes(r.status)
    )
    const briefed = sentRows.some((r) => r.dedupe_key.startsWith('in_digest_brief:'))
    const lastNotified = sentRows.map((r) => r.created_at).sort().pop() ?? null
    if (briefed && lastNotified) {
      const paidRows = bundle.enrollments.filter(
        (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
      )
      const stragglers = paidRows.filter((e) => e.paid_at && e.paid_at > lastNotified)
      if (stragglers.length > 0) {
        const now_ = paidRows.length
        const additionsLine = `<p><strong>${stragglers
          .map((e) => `+1: ${e.studentFirstName} ${e.studentLastName}`)
          .join(' · ')} — now ${now_} student${now_ === 1 ? '' : 's'}.</strong></p>`
        const idsHash = createHash('md5')
          .update(stragglers.map((e) => e.id).sort().join('|'))
          .digest('hex')
          .slice(0, 12)
        if (
          (await sendInstructorDigest(bundle, instructor, 'roster_addition', `in_roster_add:${bundle.id}:${idsHash}`, {
            additionsLine,
          })) === 'sent'
        )
          result.digested++
      }
    }
  }
  void now
  return result
}

/** Event-driven pings (PL-51 pattern — fired from the payment webhook the
 *  moment a count crosses a milestone; dedupe keys make retries no-ops). */
export async function sendInstructorMilestones(bundle: ClassBundle): Promise<void> {
  const instructor = await loadClassInstructor(bundle)
  if (!instructor) return
  // PL-327: 'weekly' = digest only — instant milestone pings are the 'on'
  // cadence's extra.
  if (instructor.digestPref !== 'on') return
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
  // PL-327: FYI copies are their own preference.
  if (!instructor.fyiCopies) return
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
      { preheader: 'Copy of what your families just received — nothing to do.', footer: footerStaff() }
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
// PL-335 D — the minimum-enrollment decision note. Run-anyway and extend get
// a short direct email; cancel is covered by the existing cancellation comms
// (never double-send). Schedule-relevant, so it sends like T3-T-class
// information — a direct instructor load, NOT loadClassInstructor's
// pref-gated one (digests-off must still hear the class's fate).
// ---------------------------------------------------------------------------

function minDecisionMarkdown(v: {
  tutorFirstName: string
  minDecisionLine: string
  instructorCountsLine: string
  instructorViewLink: string
}): string {
  return `Hi ${v.tutorFirstName},

${v.minDecisionLine}

Current enrollment: **${v.instructorCountsLine}**.

Nothing you need to do — this is just so you always know where the class stands.

[button:Open your class page](${v.instructorViewLink})`
}

export async function sendMinEnrollmentDecisionNote(
  bundle: ClassBundle,
  decision: 'run_anyway' | 'extend',
  opts: { newDeadline?: string | null; decidedAt?: string } = {}
): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed' | 'skipped'> {
  if (!bundle.instructorId) return 'skipped'
  const { data } = await supabase
    .from('instructors')
    .select('id, name, email, timezone')
    .eq('id', bundle.instructorId)
    .maybeSingle()
  if (!data?.email) return 'skipped'
  const instructor: ClassInstructor = {
    id: data.id,
    name: data.name,
    email: data.email,
    commsEnabled: true,
    digestPref: 'on',
    fyiCopies: true,
    timezone: data.timezone ?? null,
  }
  const extendDateLong = opts.newDeadline ? formatDateFull(opts.newDeadline) : ''
  const extendDateShort = opts.newDeadline
    ? formatDateOnly(opts.newDeadline, { month: 'long', day: 'numeric' })
    : ''
  const minDecisionSubject =
    decision === 'run_anyway'
      ? 'running as planned'
      : `registration deadline extended to ${extendDateShort}`
  const minDecisionLine =
    decision === 'run_anyway'
      ? "The class is below its enrollment minimum, and we've decided to **run it as planned** — the schedule stands exactly as it is."
      : `The class is below its enrollment minimum, so we've **extended the registration deadline to ${extendDateLong}** to give sign-ups more time. The schedule itself hasn't changed — we'll confirm either way by the new deadline.`
  const extras = {
    ...baseExtras(bundle, instructor),
    minDecisionSubject,
    minDecisionLine,
  }
  const stub = instructorStub(bundle, instructor)
  const fallback = (): Rendered => ({
    subject: `${bundle.schoolLabel} ${bundle.classType}: ${minDecisionSubject}`,
    html: wrap(
      renderMarkdownBody(
        minDecisionMarkdown({
          tutorFirstName: extras.tutorFirstName,
          minDecisionLine,
          instructorCountsLine: extras.instructorCountsLine,
          instructorViewLink: extras.instructorViewLink,
        }),
        {}
      ),
      { preheader: 'Where the class stands — nothing you need to do.', footer: footerStaff() }
    ),
  })
  const email = await renderRegistered('IN_MIN_DECISION', stub, extras, fallback)
  // Re-stamping the decision (undo → run again) mints a fresh key; extending
  // to a NEW date sends, re-saving the same date dedupes.
  const dedupeKey =
    decision === 'run_anyway'
      ? `in_min_decision:${bundle.id}:run:${opts.decidedAt ?? 'first'}`
      : `in_min_decision:${bundle.id}:extend:${opts.newDeadline ?? 'none'}`
  return sendOnce({
    dedupeKey,
    emailType: 'instructor_min_decision',
    templateKey: 'IN_MIN_DECISION',
    recipientRole: 'instructor',
    classId: bundle.id,
    to: [instructor.email],
    subject: email.subject,
    html: email.html,
  })
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
