import { emailBaseUrl } from './base-url'
import { checkToken, mintToken } from './signing'
import {
  coverageAlertDetails,
  coverageAlertSubject,
  coverageNoteButtonHtml,
  coverageNoteHtml,
  coverageOutcomeLine,
  coverageSessionLines,
} from './coverage-copy'
import { supabaseAdmin as supabase } from './supabase-admin'
import { formatTimeRange } from './dates'
import { sendAdminAlert, sendOnce, wrap, footerStaff, type Rendered } from './email'
import { renderRegistered } from './comms-registered'
import { enqueueGcalSync } from './gcal-sync'
import { loadContactInfo } from './tutoring-emails'

// PL-112: substitute coverage. A tutor offers ONE session to ONE
// subject-qualified colleague at a time; accept flips the session's
// tutor_id to the substitute, and pay (PL-103), the calendar, and the
// PL-111 note-history read all follow from that single fact.
//
// Matching discipline: candidates are filtered by SUBJECT QUALIFICATION
// ONLY. The admin fit/style notes (tutor_notes) are never queried here —
// absent from the payload, not just the UI (same server-side rule as the
// PL-104 no-amounts model).

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'williamraymondthomas@gmail.com'

type Result<T> = { ok: true } & T
type Failure = { ok: false; error: string; status: number }

const fail = (status: number, error: string): Failure => ({ ok: false, error, status })

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

/** The session + everything emails and handoffs need, ownership included. */
async function loadSession(sessionId: string) {
  const { data } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, tutor_id, student_id, starts_at, ends_at, status,
       students ( first_name, last_name ),
       tutoring_engagements ( location, subjects ( name ) ),
       instructors ( name, email, timezone )`
    )
    .eq('id', sessionId)
    .maybeSingle()
  if (!data) return null
  const eng = one<any>(data.tutoring_engagements)
  const student = one<any>(data.students)
  return {
    id: data.id as string,
    tutorId: data.tutor_id as string,
    studentId: data.student_id as string,
    startsAt: data.starts_at as string,
    endsAt: data.ends_at as string,
    status: data.status as string,
    studentFirst: (student?.first_name as string) ?? 'the student',
    studentName: student ? `${student.first_name} ${student.last_name}` : '—',
    subjectName: (one<any>(eng?.subjects)?.name as string) ?? '',
    location: (eng?.location as string) ?? null,
    tutor: one<any>(data.instructors) as { name: string | null; email: string; timezone: string | null } | null,
  }
}

/** PL-339: "Monday, November 9, 4:00–5:30 PM" — the full range, in the
 *  reader's own timezone. */
function fmtWhen(iso: string, endIso: string | null | undefined, tz: string | null | undefined) {
  const zone = tz ?? 'America/Denver'
  const day = new Date(iso).toLocaleDateString('en-US', {
    timeZone: zone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  return `${day}, ${formatTimeRange(iso, endIso, zone)}`
}

export type CoverageCandidate = { id: string; name: string; needsPrep: boolean }

/**
 * Subject-qualified candidates for one session. Payload discipline: id,
 * name, and the needs-prep flag ONLY — never emails, never matching notes.
 */
export async function coverageCandidates(
  sessionId: string,
  callerIds: string[]
): Promise<Failure | Result<{ candidates: CoverageCandidate[]; managerLine: string }>> {
  const session = await loadSession(sessionId)
  if (!session || !callerIds.includes(session.tutorId)) return fail(403, 'Not your session.')
  if (new Date(session.startsAt) <= new Date()) return fail(400, 'That session already happened.')
  const { data: tutors } = await supabase
    .from('instructors')
    .select('id, name, subjects, subjects_with_prep')
    .eq('tutoring_active', true)
    .neq('id', session.tutorId)
  const candidates: CoverageCandidate[] = ((tutors as any[]) ?? [])
    .map((t) => {
      const ready = (t.subjects ?? []).includes(session.subjectName)
      const prep = (t.subjects_with_prep ?? []).includes(session.subjectName)
      if (!ready && !prep) return null
      return { id: t.id as string, name: (t.name as string) ?? 'Unnamed tutor', needsPrep: !ready }
    })
    .filter(Boolean) as CoverageCandidate[]
  candidates.sort((a, b) => Number(a.needsPrep) - Number(b.needsPrep) || a.name.localeCompare(b.name))
  const contact = await loadContactInfo()
  const managerLine = `Prefer a hand? Your manager can help find a suitable replacement — write to ${contact.email}${contact.phone ? ` or call ${contact.phone}` : ''}.`
  return { ok: true, candidates, managerLine }
}

async function opsAlert(opts: {
  event: 'requested' | 'accepted' | 'declined' | 'cancelled'
  requestId: string
  session: NonNullable<Awaited<ReturnType<typeof loadSession>>>
  requesterName: string
  candidateName: string
}) {
  const when = fmtWhen(opts.session.startsAt, opts.session.endsAt, opts.session.tutor?.timezone)
  await sendAdminAlert({
    dedupeKey: `al_coverage:${opts.requestId}:${opts.event}`,
    adminEmail: ADMIN_EMAIL,
    templateKey: opts.event === 'requested' ? 'AL_COVERAGE_REQUEST' : 'AL_COVERAGE_RESOLVED',
    // PL-137: subject and body both come from the leaf copy module, so the
    // sample pins can be computed from the exact same code.
    subject: coverageAlertSubject({ event: opts.event, studentName: opts.session.studentName, when }),
    body: coverageAlertDetails({
      baseUrl: emailBaseUrl(),
      event: opts.event,
      studentName: opts.session.studentName,
      studentFirst: opts.session.studentFirst,
      studentId: opts.session.studentId,
      subjectName: opts.session.subjectName,
      when,
      requesterName: opts.requesterName,
      candidateName: opts.candidateName,
    }),
    vars: { alertStudentName: opts.session.studentName },
  })
}

export async function requestCoverage(opts: {
  sessionId: string
  candidateId: string
  note?: string
  callerIds: string[]
}): Promise<Failure | Result<{ requestId: string }>> {
  const session = await loadSession(opts.sessionId)
  if (!session || !opts.callerIds.includes(session.tutorId)) return fail(403, 'Not your session.')
  if (new Date(session.startsAt) <= new Date()) return fail(400, 'That session already happened.')
  if (!['confirmed', 'proposed'].includes(session.status)) {
    return fail(400, `A ${session.status.replace('_', ' ')} session cannot be covered.`)
  }
  const { data: existing } = await supabase
    .from('coverage_requests')
    .select('id')
    .eq('session_id', session.id)
    .eq('status', 'offered')
    .maybeSingle()
  if (existing) return fail(400, 'A coverage request for this session is already waiting on an answer.')

  // Re-validate qualification server-side — the list the tutor saw is not trusted.
  const { data: candidate } = await supabase
    .from('instructors')
    .select('id, name, email, timezone, subjects, subjects_with_prep, tutoring_active')
    .eq('id', opts.candidateId)
    .maybeSingle()
  const qualified =
    candidate?.tutoring_active &&
    ((candidate.subjects ?? []).includes(session.subjectName) ||
      (candidate.subjects_with_prep ?? []).includes(session.subjectName))
  if (!qualified) return fail(400, 'That tutor is not qualified for this subject.')
  if (candidate.id === session.tutorId) return fail(400, 'You cannot cover your own session.')

  const { data: req, error } = await supabase
    .from('coverage_requests')
    .insert([{
      session_id: session.id,
      requesting_tutor_id: session.tutorId,
      candidate_tutor_id: candidate.id,
      note: opts.note?.trim() || null,
    }])
    .select('id')
    .single()
  if (error || !req) return fail(500, error?.message ?? 'Could not create the request.')

  const base = emailBaseUrl()
  const requesterName = session.tutor?.name ?? 'A colleague'
  const when = fmtWhen(session.startsAt, session.endsAt, candidate.timezone)
  const first = candidate.name?.split(' ')[0] ?? 'there'
  // PL-157: composed in coverage-copy.ts so the template sample derives from
  // the same code path.
  const sessionLines = coverageSessionLines({
    when,
    studentFirst: session.studentFirst,
    subjectName: session.subjectName,
    location: session.location,
    requesterName,
    note: opts.note,
  })
  const codeTwin = (): Rendered => ({
    subject: `Can you cover a session? ${when} — ${session.subjectName}`,
    html: wrap(
      `<h2 style="color:#334155">Coverage request from ${requesterName}</h2>
       <p>Hi ${first},</p>
       <p>${requesterName} is asking if you can cover one 1-on-1 session:</p>
       <ul>${sessionLines.map((l) => `<li>${l}</li>`).join('')}</ul>
       <p>Accept or decline from your portal — one click either way. If you accept, the session
       moves onto your schedule and calendar, and the student's session-note history opens up to
       you so you can walk in prepared.</p>
       <p style="margin:20px 0"><a href="${base}/portal?view=tutor" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Answer in your portal</a></p>`,
      { preheader: `${session.studentFirst} · ${session.subjectName} · ${when}`, footer: footerStaff() }
    ),
  })
  const email = await renderRegistered(
    'SUB_COVERAGE_OFFER',
    { parentFirstName: first, parentEmail: candidate.email },
    {
      tutorFirstName: first,
      coverageSessionBlock: sessionLines.join('\n'),
      coverageRespondLink: `${base}/portal?view=tutor`,
    },
    codeTwin
  )
  await sendOnce({
    dedupeKey: `sub_offer:${req.id}`,
    emailType: 'SUB_COVERAGE_OFFER',
    templateKey: 'SUB_COVERAGE_OFFER',
    to: [candidate.email],
    subject: email.subject,
    html: email.html,
  })
  await opsAlert({
    event: 'requested',
    requestId: req.id,
    session,
    requesterName,
    candidateName: candidate.name ?? candidate.email,
  })
  return { ok: true, requestId: req.id }
}

export type CoverageHandoff = {
  when: string
  studentName: string
  subjectName: string
  location: string | null
  notes: { starts_at: string; note: string; next_time: string | null }[]
}

export async function respondCoverage(opts: {
  requestId: string
  response: 'accept' | 'decline'
  callerIds: string[]
}): Promise<Failure | Result<{ handoff: CoverageHandoff | null }>> {
  const { data: req } = await supabase
    .from('coverage_requests')
    .select('id, session_id, requesting_tutor_id, candidate_tutor_id, status')
    .eq('id', opts.requestId)
    .maybeSingle()
  if (!req || !opts.callerIds.includes(req.candidate_tutor_id)) return fail(403, 'Not your request.')
  if (req.status !== 'offered') return fail(400, `This request is already ${req.status}.`)
  const session = await loadSession(req.session_id)
  if (!session) return fail(404, 'Session not found.')

  const accepted = opts.response === 'accept'
  const { data: updated } = await supabase
    .from('coverage_requests')
    .update({
      status: accepted ? 'accepted' : 'declined',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.id)
    .eq('status', 'offered') // guard the race with a cancel
    .select('id')
  if (!updated?.length) return fail(400, 'This request was just withdrawn.')

  const { data: candidate } = await supabase
    .from('instructors')
    .select('name, email, timezone')
    .eq('id', req.candidate_tutor_id)
    .maybeSingle()
  const { data: requester } = await supabase
    .from('instructors')
    .select('name, email, timezone')
    .eq('id', req.requesting_tutor_id)
    .maybeSingle()
  const candidateName = candidate?.name ?? 'The substitute'

  let handoff: CoverageHandoff | null = null
  if (accepted) {
    // The single fact everything follows from: the session is now theirs.
    await supabase
      .from('tutoring_sessions')
      .update({ tutor_id: req.candidate_tutor_id, updated_at: new Date().toISOString() })
      .eq('id', session.id)
    await enqueueGcalSync(session.id, 'substitute accepted coverage — session changes tutor')
    const { data: notes } = await supabase
      .from('session_notes')
      .select('note, next_time, tutoring_sessions!inner ( starts_at )')
      .eq('student_id', session.studentId)
      .order('created_at', { ascending: false })
      .limit(10)
    handoff = {
      when: fmtWhen(session.startsAt, session.endsAt, candidate?.timezone),
      studentName: session.studentName,
      subjectName: session.subjectName,
      location: session.location,
      notes: ((notes as any[]) ?? []).map((n) => ({
        starts_at: one<any>(n.tutoring_sessions)?.starts_at ?? '',
        note: n.note,
        next_time: n.next_time,
      })),
    }
  }

  if (requester?.email) {
    const when = fmtWhen(session.startsAt, session.endsAt, requester.timezone)
    const first = requester.name?.split(' ')[0] ?? 'there'
    const contact = await loadContactInfo()
    // PL-157: composed in coverage-copy.ts so the template sample derives
    // from the same code path.
    const outcomeLine = coverageOutcomeLine({
      accepted,
      candidateName,
      studentFirst: session.studentFirst,
      subjectName: session.subjectName,
      when,
      contactEmail: contact.email,
    })
    // PL-156: only the ACCEPTED outcome offers the note button — a declined
    // or withdrawn request has no substitute to hand anything to. The button
    // opens a form; it never sends from the email itself.
    const subFirstName = candidateName.split(' ')[0]
    const noteButton = accepted
      ? coverageNoteButtonHtml({
          noteUrl: coverageNoteUrlFor(req.id),
          subFirstName,
          studentFirst: session.studentFirst,
        })
      : ''
    const codeTwin = (): Rendered => ({
      subject: accepted ? `Covered: ${session.studentFirst} on ${when}` : `Not covered yet: ${session.studentFirst} on ${when}`,
      html: wrap(
        `<h2 style="color:#334155">Coverage ${accepted ? 'confirmed' : 'declined'}</h2>
         <p>Hi ${first},</p>
         <p>${outcomeLine}</p>
         ${noteButton}
         <p style="margin:20px 0"><a href="${emailBaseUrl()}/portal?view=tutor" style="display:inline-block;background:#506171;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open your portal</a></p>`,
        { preheader: outcomeLine.slice(0, 90), footer: footerStaff() }
      ),
    })
    const email = await renderRegistered(
      'SUB_COVERAGE_RESULT',
      { parentFirstName: first, parentEmail: requester.email },
      {
        tutorFirstName: first,
        coverageOutcomeLine: outcomeLine,
        coverageNoteButton: noteButton,
        coverageRespondLink: `${emailBaseUrl()}/portal?view=tutor`,
      },
      codeTwin
    )
    await sendOnce({
      dedupeKey: `sub_result:${req.id}`,
      emailType: 'SUB_COVERAGE_RESULT',
      templateKey: 'SUB_COVERAGE_RESULT',
      to: [requester.email],
      subject: email.subject,
      html: email.html,
    })
  }
  await opsAlert({
    event: accepted ? 'accepted' : 'declined',
    requestId: req.id,
    session,
    requesterName: requester?.name ?? '—',
    candidateName,
  })
  return { ok: true, handoff }
}

export async function cancelCoverage(opts: {
  requestId: string
  callerIds: string[]
}): Promise<Failure | Result<Record<never, never>>> {
  const { data: req } = await supabase
    .from('coverage_requests')
    .select('id, session_id, requesting_tutor_id, candidate_tutor_id, status')
    .eq('id', opts.requestId)
    .maybeSingle()
  if (!req || !opts.callerIds.includes(req.requesting_tutor_id)) return fail(403, 'Not your request.')
  if (req.status !== 'offered') return fail(400, `This request is already ${req.status}.`)
  const { data: updated } = await supabase
    .from('coverage_requests')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.id)
    .eq('status', 'offered')
    .select('id')
  if (!updated?.length) return fail(400, 'This request was already answered.')
  const session = await loadSession(req.session_id)
  if (session) {
    const { data: candidate } = await supabase
      .from('instructors').select('name, email').eq('id', req.candidate_tutor_id).maybeSingle()
    await opsAlert({
      event: 'cancelled',
      requestId: req.id,
      session,
      requesterName: session.tutor?.name ?? '—',
      candidateName: candidate?.name ?? candidate?.email ?? '—',
    })
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// PL-156: the requesting tutor's hand-over note to the substitute
// ---------------------------------------------------------------------------
// Coverage is a handoff between two people, and the accepted-outcome email
// used to end the conversation ("Nothing else to do"). The one thing the
// requesting tutor most wants at that moment is to say thanks and pass along
// context — where the student is stuck, what to bring, what not to repeat.
//
// The email carries a BUTTON, never the action: it opens a one-box form and
// the form sends. (Acting straight from an emailed link would let a mail
// scanner or a prefetcher fire a real send — the house rule since PL-62.)
// The note is emailed to the substitute AND stored on the request, so it
// rides the handoff bundle instead of living in one inbox.

export function coverageNoteToken(requestId: string): string {
  return `${requestId}.${mintToken('coverage-note:', requestId, 'tutor-action')}`
}

export function coverageNoteUrlFor(requestId: string): string {
  return `${emailBaseUrl()}/coverage/note/${coverageNoteToken(requestId)}`
}

/** 'ok' → the request id; otherwise why the link can't be used. */
export function verifyCoverageNoteToken(token: string): { id: string } | 'expired' | 'invalid' {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return 'invalid'
  const id = token.slice(0, dot)
  const state = checkToken('coverage-note:', id, token.slice(dot + 1), 'tutor-action')
  return state === 'ok' ? { id } : state
}

export type CoverageNoteContext = {
  requestId: string
  subFirstName: string
  studentFirst: string
  subjectName: string
  when: string
  alreadySent: string | null
}

/** What the note form needs to render — no emails, no ids beyond the request. */
export async function coverageNoteContext(requestId: string): Promise<CoverageNoteContext | null> {
  const { data: req } = await supabase
    .from('coverage_requests')
    .select('id, session_id, candidate_tutor_id, status, handoff_note, handoff_note_at')
    .eq('id', requestId)
    .maybeSingle()
  // Only an ACCEPTED request has a substitute to hand off to.
  if (!req || req.status !== 'accepted') return null
  const session = await loadSession(req.session_id)
  if (!session) return null
  const { data: sub } = await supabase
    .from('instructors')
    .select('name, timezone')
    .eq('id', req.candidate_tutor_id)
    .maybeSingle()
  return {
    requestId: req.id,
    subFirstName: sub?.name?.split(' ')[0] ?? 'your colleague',
    studentFirst: session.studentFirst,
    subjectName: session.subjectName,
    when: fmtWhen(session.startsAt, session.endsAt, sub?.timezone),
    alreadySent: req.handoff_note_at ?? null,
  }
}

/**
 * Send the note: email the substitute, and store it so the handoff bundle
 * carries it. Idempotent-ish by design — a second note replaces the stored
 * one and sends again (a tutor remembering one more thing is a feature),
 * but the dedupe key is keyed on the note's own timestamp so a double-submit
 * of the SAME note doesn't double-send.
 */
export async function sendCoverageNote(opts: {
  requestId: string
  note: string
}): Promise<Failure | Result<{ subFirstName: string }>> {
  const note = opts.note.trim()
  if (!note) return fail(400, 'Write a line or two first.')
  if (note.length > 4000) return fail(400, 'That note is too long — keep it under 4000 characters.')

  const { data: req } = await supabase
    .from('coverage_requests')
    .select('id, session_id, requesting_tutor_id, candidate_tutor_id, status')
    .eq('id', opts.requestId)
    .maybeSingle()
  if (!req) return fail(404, 'That coverage request no longer exists.')
  if (req.status !== 'accepted') {
    return fail(400, 'That session was never covered, so there is nobody to hand it to.')
  }
  const session = await loadSession(req.session_id)
  if (!session) return fail(404, 'That session no longer exists.')

  const [{ data: sub }, { data: requester }] = await Promise.all([
    supabase.from('instructors').select('name, email, timezone').eq('id', req.candidate_tutor_id).maybeSingle(),
    supabase.from('instructors').select('name, email').eq('id', req.requesting_tutor_id).maybeSingle(),
  ])
  if (!sub?.email) return fail(500, 'The substitute has no email on file.')

  const sentAt = new Date().toISOString()
  await supabase
    .from('coverage_requests')
    .update({ handoff_note: note, handoff_note_at: sentAt, updated_at: sentAt })
    .eq('id', req.id)

  const subFirst = sub.name?.split(' ')[0] ?? 'there'
  const fromName = requester?.name ?? 'Your colleague'
  const when = fmtWhen(session.startsAt, session.endsAt, sub.timezone)
  // PL-157: composed in coverage-copy.ts (which also fixes the escape order —
  // the inline version escaped its own <br> tags into visible text).
  const noteHtml = coverageNoteHtml(note)
  const codeTwin = (): Rendered => ({
    subject: `A note from ${fromName} about ${session.studentFirst}`,
    html: wrap(
      `<h2 style="color:#334155">Handover note</h2>
       <p>Hi ${subFirst},</p>
       <p>${fromName} sent this along about ${session.studentFirst}'s ${session.subjectName} session
       on ${when}, which you're covering:</p>
       <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #00AEEE;background:#f8fafc">${noteHtml}</blockquote>
       <p>It's saved with the rest of the handoff, so you don't need to keep this email.</p>
       <p style="margin:20px 0"><a href="${emailBaseUrl()}/portal?view=tutor" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open your portal</a></p>`,
      { preheader: `${fromName} on ${session.studentFirst} — ${when}`, footer: footerStaff() }
    ),
  })
  const email = await renderRegistered(
    'SUB_COVERAGE_NOTE',
    { parentFirstName: subFirst, parentEmail: sub.email },
    {
      tutorFirstName: subFirst,
      coverageNoteBlock: noteHtml,
      coverageNoteFrom: fromName,
      coverageRespondLink: `${emailBaseUrl()}/portal?view=tutor`,
    },
    codeTwin
  )
  await sendOnce({
    // Keyed on the note's timestamp: re-sending a REVISED note goes out, a
    // double-submit of the same one does not.
    dedupeKey: `sub_coverage_note:${req.id}:${sentAt}`,
    emailType: 'SUB_COVERAGE_NOTE',
    templateKey: 'SUB_COVERAGE_NOTE',
    to: [sub.email],
    subject: email.subject,
    html: email.html,
  })
  return { ok: true, subFirstName: subFirst }
}
