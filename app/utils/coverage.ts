import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import { sendAdminAlert, sendOnce, wrap, footerT, type Rendered } from './email'
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

function fmtWhen(iso: string, tz: string | null | undefined) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: tz ?? 'America/Denver',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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
  const base = emailBaseUrl()
  const link = `${base}/admin/tutoring?schedule=${opts.session.studentId}`
  const when = fmtWhen(opts.session.startsAt, opts.session.tutor?.timezone)
  const headline =
    opts.event === 'requested'
      ? `${opts.requesterName} asked ${opts.candidateName} to cover ${opts.session.studentName}'s ${opts.session.subjectName} session on ${when}.`
      : opts.event === 'accepted'
        ? `${opts.candidateName} accepted coverage of ${opts.session.studentName}'s ${opts.session.subjectName} session on ${when} — the session moved to their schedule and calendar.`
        : opts.event === 'declined'
          ? `${opts.candidateName} declined to cover ${opts.session.studentName}'s ${opts.session.subjectName} session on ${when}. The session still needs coverage — ${opts.requesterName} can pick another candidate, or step in to help.`
          : `${opts.requesterName} withdrew the coverage request for ${opts.session.studentName}'s ${opts.session.subjectName} session on ${when} (they are keeping the session).`
  await sendAdminAlert({
    dedupeKey: `al_coverage:${opts.requestId}:${opts.event}`,
    adminEmail: ADMIN_EMAIL,
    templateKey: opts.event === 'requested' ? 'AL_COVERAGE_REQUEST' : 'AL_COVERAGE_RESOLVED',
    subject:
      opts.event === 'requested'
        ? `Substitute requested: ${opts.session.studentName} — ${when}`
        : `Substitute request ${opts.event}: ${opts.session.studentName} — ${when}`,
    body: `<p>${headline}</p>
      <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open ${opts.session.studentFirst}'s schedule</a></p>`,
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
  const when = fmtWhen(session.startsAt, candidate.timezone)
  const first = candidate.name?.split(' ')[0] ?? 'there'
  const sessionLines = [
    `${when} (your local time)`,
    `${session.studentFirst} · ${session.subjectName}`,
    ...(session.location ? [session.location] : []),
    ...(opts.note?.trim() ? [`From ${requesterName}: ${opts.note.trim()}`] : []),
  ]
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
      { preheader: `${session.studentFirst} · ${session.subjectName} · ${when}`, footer: footerT() }
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
      when: fmtWhen(session.startsAt, candidate?.timezone),
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
    const when = fmtWhen(session.startsAt, requester.timezone)
    const first = requester.name?.split(' ')[0] ?? 'there'
    const contact = await loadContactInfo()
    const outcomeLine = accepted
      ? `${candidateName} accepted — ${session.studentFirst}'s ${session.subjectName} session on ${when} has moved to their schedule and calendar. Nothing else to do.`
      : `${candidateName} can't cover ${session.studentFirst}'s ${session.subjectName} session on ${when}. It's still yours — pick another candidate from your portal, or your manager can help find a suitable replacement (${contact.email}).`
    const codeTwin = (): Rendered => ({
      subject: accepted ? `Covered: ${session.studentFirst} on ${when}` : `Not covered yet: ${session.studentFirst} on ${when}`,
      html: wrap(
        `<h2 style="color:#334155">Coverage ${accepted ? 'confirmed' : 'declined'}</h2>
         <p>Hi ${first},</p>
         <p>${outcomeLine}</p>
         <p style="margin:20px 0"><a href="${emailBaseUrl()}/portal?view=tutor" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open your portal</a></p>`,
        { preheader: outcomeLine.slice(0, 90), footer: footerT() }
      ),
    })
    const email = await renderRegistered(
      'SUB_COVERAGE_RESULT',
      { parentFirstName: first, parentEmail: requester.email },
      {
        tutorFirstName: first,
        coverageOutcomeLine: outcomeLine,
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
