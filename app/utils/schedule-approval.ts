import { emailBaseUrl } from './base-url'
import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, sendAdminAlert, wrap, footerT } from './email'
import { ADMIN_EMAIL } from './lifecycle'
import { enqueueGcalSync } from './gcal-sync'
import { tutoringIcsToken } from './tutoring-billing'
import { contactBlockHtml, contactFrom, loadContactInfo, type ContactInfo } from './tutoring-emails'
import { renderRegistered } from './comms-registered'
import { zonedToUtc, type RecurrenceSlot } from './tutoring'
import { signingSecret } from './signing'

// PL-40/PL-41 (docs/SESSION_SETUP_COMMS_SPEC.md): propose → parent approves →
// sessions push to the TUTOR's calendar only, family gets ONE warm welcome
// email (calendar subscribe + PDF) instead of per-session Google invites.
// Nudges at +2/+5 days; +5 also alerts the Ops Director; NEVER auto-approves
// (a tutoring schedule must not lock in silently — Kelsie can override to
// active from the wizard/panel instead). All three emails send FROM the
// configurable tutoring contact (PL-50).

const appUrl = () => emailBaseUrl()

// ---------------------------------------------------------------------------
// Signed link (house HMAC pattern, distinct prefix)
// ---------------------------------------------------------------------------

function sig(id: string): string {
  return createHmac('sha256', signingSecret())
    .update(`schedule-approve:${id}`)
    .digest('hex')
    .slice(0, 32)
}

export function scheduleApproveToken(engagementId: string): string {
  return `${engagementId}.${sig(engagementId)}`
}

export function verifyScheduleApproveToken(token: string): string | null {
  const [id, given] = token.split('.')
  if (!id || !given) return null
  const expected = Buffer.from(sig(id))
  const got = Buffer.from(given)
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null
}

// ---------------------------------------------------------------------------
// Engagement loading + the plain-English schedule summary
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export type ApprovalEngagement = {
  id: string
  status: string
  recurrence: RecurrenceSlot[]
  start_date: string | null
  approval_requested_at: string | null
  approval_nudge_count: number
  studentFirst: string
  parentFirst: string
  parentEmail: string
  ccEmails: string[] | undefined
  familyId: string
  familyTz: string
  tutorName: string
  tutorFirst: string
  tutorTz: string
  subjectName: string
}

export async function loadApprovalEngagement(id: string): Promise<ApprovalEngagement | null> {
  const { data } = await supabase
    .from('tutoring_engagements')
    .select(
      `id, status, recurrence, start_date, approval_requested_at, approval_nudge_count,
       students ( first_name, families ( id, parent_first_name, parent_email, billing_cc_emails, timezone ) ),
       subjects ( name ),
       instructors ( name, timezone )`
    )
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const student = one<any>(data.students)
  const family = one<any>(student?.families)
  const tutor = one<any>((data as any).instructors)
  if (!student || !family?.parent_email || !tutor) return null
  const tutorName = tutor.name ?? 'your tutor'
  return {
    id: data.id,
    status: data.status,
    recurrence: (data.recurrence as RecurrenceSlot[]) ?? [],
    start_date: data.start_date,
    approval_requested_at: data.approval_requested_at,
    approval_nudge_count: data.approval_nudge_count ?? 0,
    studentFirst: student.first_name,
    parentFirst: family.parent_first_name ?? 'there',
    parentEmail: family.parent_email,
    ccEmails: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
    familyId: family.id,
    familyTz: family.timezone ?? tutor.timezone ?? 'America/Denver',
    tutorName,
    tutorFirst: tutorName.split(' ')[0],
    tutorTz: tutor.timezone ?? 'America/Denver',
    subjectName: one<any>((data as any).subjects)?.name ?? 'tutoring',
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const DAY_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

/** "Mondays at 4:00 PM and Thursdays at 5:00 PM, starting July 21 — one hour
 *  each" — recurrence is the tutor's wall clock; the summary renders in the
 *  FAMILY's timezone (spec: all times in the family's timezone). */
export function scheduleSummaryText(e: ApprovalEngagement): string {
  if (e.recurrence.length === 0) return 'sessions scheduled one at a time (no fixed weekly slot yet)'
  const today = new Date().toLocaleDateString('en-CA', { timeZone: e.tutorTz })
  const from = e.start_date && e.start_date > today ? e.start_date : today
  const parts = e.recurrence.map((slot) => {
    // Anchor on the next occurrence to convert tutor wall clock → family tz.
    const d = new Date(from + 'T12:00:00Z')
    const anchorDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
    const daysAhead = (slot.weekday - anchorDow + 7) % 7
    const dateIso = new Date(d.getTime() + daysAhead * 86_400_000).toISOString().slice(0, 10)
    const starts = zonedToUtc(dateIso, slot.start_time, e.tutorTz)
    const famDay = starts.toLocaleDateString('en-US', { timeZone: e.familyTz, weekday: 'long' })
    const famTime = starts.toLocaleTimeString('en-US', { timeZone: e.familyTz, hour: 'numeric', minute: '2-digit' })
    const dayIdx = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(famDay)
    return { text: `${DAY_PLURAL[dayIdx] ?? famDay + 's'} at ${famTime}`, minutes: slot.duration_minutes }
  })
  const startLabel = new Date(from + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
  })
  const minutes = [...new Set(parts.map((p) => p.minutes))]
  const lengthLabel =
    minutes.length === 1
      ? minutes[0] === 60
        ? 'one hour each'
        : minutes[0] % 60 === 0
          ? `${minutes[0] / 60} hours each`
          : `${minutes[0]} minutes each`
      : null
  return (
    parts.map((p) => p.text).join(' and ') +
    `, starting ${startLabel}` +
    (lengthLabel ? ` — ${lengthLabel}` : '')
  )
}

// ---------------------------------------------------------------------------
// The three emails (copy APPROVED July 19; From = configured contact, PL-50)
// ---------------------------------------------------------------------------

const button = (label: string, href: string) =>
  `<p style="margin:24px 0">
    <a href="${href}" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">${label}</a>
  </p>`

function approvalEmailHtml(e: ApprovalEngagement, summary: string, link: string, contact: ContactInfo, nudge: boolean) {
  if (!nudge) {
    return wrap(
      `<p>Hi ${e.parentFirst},</p>
       <p>We'd like to set ${e.studentFirst} up for regular 1-on-1 tutoring with ${e.tutorName}.
       Here's the schedule we have in mind:</p>
       <p><strong>${summary}</strong></p>
       <p>If that works, just confirm and we'll lock it in and add it to your calendar:</p>
       ${button('Confirm this schedule', link)}
       <p>Prefer different times, or have a question? Reply to this email or reach us — we're
       happy to adjust before anything's set.</p>
       ${contactBlockHtml(contact)}`,
      { preheader: 'One quick tap to lock in the times.', footer: footerT() }
    )
  }
  return wrap(
    `<p>Hi ${e.parentFirst},</p>
     <p>Just circling back on ${e.studentFirst}'s proposed tutoring schedule with ${e.tutorName}:</p>
     <p><strong>${summary}</strong></p>
     <p>A quick tap confirms it and we'll add it to your calendar:</p>
     ${button('Confirm this schedule', link)}
     <p>If the times don't quite work, reply and we'll find something better.</p>
     ${contactBlockHtml(contact)}`,
    { preheader: 'Just need a quick confirm when you have a moment.', footer: footerT() }
  )
}

/** §4a/§4b — the approval request (or nudge). */
export async function sendScheduleApprovalEmail(
  engagementId: string,
  kind: 'initial' | 'nudge'
): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed' | 'skipped'> {
  const e = await loadApprovalEngagement(engagementId)
  if (!e) return 'skipped'
  const contact = await loadContactInfo()
  const summary = scheduleSummaryText(e)
  const link = `${appUrl()}/tutoring/confirm/${scheduleApproveToken(e.id)}`
  const nudge = kind === 'nudge'

  const email = await renderRegistered(
    nudge ? 'T_SCHEDULE_CONFIRM_NUDGE' : 'T_SCHEDULE_CONFIRM',
    { parentFirstName: e.parentFirst, parentEmail: e.parentEmail, studentFirstName: e.studentFirst },
    {
      tutorName: e.tutorName,
      tutorFirstName: e.tutorFirst,
      scheduleSummary: summary,
      approveLink: link,
      contactBlock: contactBlockHtml(contact),
    },
    () => ({
      subject: nudge
        ? `Still holding ${e.studentFirst}'s tutoring times`
        : `Please confirm ${e.studentFirst}'s tutoring schedule`,
      html: approvalEmailHtml(e, summary, link, contact, nudge),
    })
  )
  return sendOnce({
    // Initial keys on the request stamp so an Ops re-send (which re-stamps
    // approval_requested_at) goes out again; plain retries still dedupe.
    dedupeKey: nudge
      ? `t_schedule_confirm_nudge:${engagementId}:${e.approval_nudge_count + 1}`
      : `t_schedule_confirm:${engagementId}:${e.approval_requested_at ?? 'first'}`,
    emailType: nudge ? 'T_SCHEDULE_CONFIRM_NUDGE' : 'T_SCHEDULE_CONFIRM',
    to: [e.parentEmail],
    cc: e.ccEmails,
    from: contactFrom(contact),
    subject: email.subject,
    html: email.html,
  })
}

/** §4c — the all-set welcome (fires on approval, or immediately on override).
 *  The ONE warm email that replaces per-session Google invites (PL-40). */
export async function sendScheduleSetEmail(
  engagementId: string
): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed' | 'skipped'> {
  const e = await loadApprovalEngagement(engagementId)
  if (!e) return 'skipped'
  const contact = await loadContactInfo()
  const summary = scheduleSummaryText(e)
  const base = appUrl()
  const icsToken = tutoringIcsToken(e.familyId)
  const calendarLink = `webcal://${base.replace(/^https?:\/\//, '')}/api/tutoring/calendar/${icsToken}`
  const pdfLink = `${base}/api/tutoring/schedule.pdf/${icsToken}`

  const email = await renderRegistered(
    'T_SCHEDULE_SET',
    {
      parentFirstName: e.parentFirst,
      parentEmail: e.parentEmail,
      studentFirstName: e.studentFirst,
      calendarPageUrl: calendarLink,
    },
    {
      tutorName: e.tutorName,
      tutorFirstName: e.tutorFirst,
      scheduleSummary: summary,
      schedulePdfLink: pdfLink,
      contactBlock: contactBlockHtml(contact),
    },
    () => ({
      subject: `${e.studentFirst}'s tutoring schedule is all set`,
      html: wrap(
        `<p>Hi ${e.parentFirst},</p>
         <p>Great news — ${e.studentFirst}'s 1-on-1 tutoring with ${e.tutorName} is all set up.
         Here's the regular plan:</p>
         <p><strong>${summary}</strong></p>
         <p>A couple of things to make life easier:</p>
         ${button('Add to your calendar', calendarLink)}
         <p style="color:#64748b;font-size:13px;margin-top:-12px">Subscribe once and every session
         (and any future change) shows up automatically.</p>
         ${button('Download the schedule (PDF)', pdfLink)}
         <p>You can reschedule any single session yourself from your parent portal — no need to
         email us for the small stuff. And if the regular time ever needs to change, just reach
         out and we'll take care of it.</p>
         <p>We're looking forward to working with ${e.studentFirst}.</p>
         ${contactBlockHtml(contact)}`,
        {
          preheader: "Here's the plan, plus calendar links so it's always in front of you.",
          footer: footerT(),
        }
      ),
    })
  )
  return sendOnce({
    dedupeKey: `t_schedule_set:${engagementId}`,
    emailType: 'T_SCHEDULE_SET',
    to: [e.parentEmail],
    cc: e.ccEmails,
    from: contactFrom(contact),
    subject: email.subject,
    html: email.html,
  })
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/** Approve (parent click or Ops override): pending → active, sessions
 *  proposed → confirmed and queued for the tutor's calendar, welcome sent
 *  once. Idempotent — a second click just reports ok. Caller drains the gcal
 *  queue (after() in routes). */
export async function activatePendingEngagement(
  engagementId: string,
  how: 'parent' | 'override'
): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const { data: eng } = await supabase
    .from('tutoring_engagements')
    .select('id, status')
    .eq('id', engagementId)
    .maybeSingle()
  if (!eng) return { ok: false, error: 'Unknown schedule.' }
  if (eng.status === 'active') return { ok: true, already: true }
  if (eng.status !== 'pending_parent_confirmation') {
    return { ok: false, error: 'This schedule is no longer awaiting confirmation.' }
  }

  const { error: updateError } = await supabase
    .from('tutoring_engagements')
    .update({
      status: 'active',
      parent_approved_at: how === 'parent' ? new Date().toISOString() : null,
      parent_decline_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', engagementId)
    .eq('status', 'pending_parent_confirmation')
  if (updateError) return { ok: false, error: updateError.message }

  // Confirm + queue the held sessions (they were created 'proposed', never
  // pushed — PL-40 pushes go to the tutor's calendar only).
  const { data: sessions } = await supabase
    .from('tutoring_sessions')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('engagement_id', engagementId)
    .eq('status', 'proposed')
    .select('id')
  for (const s of sessions ?? []) await enqueueGcalSync(s.id, `schedule approved (${how})`)

  await sendScheduleSetEmail(engagementId).catch((e) =>
    console.error('T_SCHEDULE_SET failed (activation stands):', e)
  )
  return { ok: true }
}

/** Decline / "different times": stays pending, Ops alerted with the note. */
export async function declineEngagement(engagementId: string, note: string | null): Promise<{ ok: boolean }> {
  const e = await loadApprovalEngagement(engagementId)
  if (!e) return { ok: false }
  await supabase
    .from('tutoring_engagements')
    .update({ parent_decline_note: note ?? '(no note)', updated_at: new Date().toISOString() })
    .eq('id', engagementId)
  await sendAdminAlert({
    dedupeKey: `schedule_declined:${engagementId}:${Date.now()}`,
    adminEmail: ADMIN_EMAIL,
    subject: `Family asked for different tutoring times — ${e.studentFirst}`,
    body: `<p><strong>${e.parentFirst}</strong> (${e.parentEmail}) responded to
      ${e.studentFirst}'s proposed schedule with ${e.tutorName}:</p>
      <blockquote>${note ?? '(no note)'}</blockquote>
      <p>The schedule stays unconfirmed. Adjust it on
      <a href="${appUrl()}/admin/tutoring?family=${e.familyId}" style="color:#00AEEE">the family's record on the tutoring page</a>
      and re-send the confirmation.</p>`,
  }).catch((err) => console.error('decline alert failed:', err))
  return { ok: true }
}

/** Cron leg: +2d nudge, +5d nudge + Ops alert. NEVER auto-approves. */
export async function runScheduleApprovalNudges(): Promise<{ nudged: number; alerted: number }> {
  const result = { nudged: 0, alerted: 0 }
  const { data: pending } = await supabase
    .from('tutoring_engagements')
    .select('id, approval_requested_at, approval_nudge_count')
    .eq('status', 'pending_parent_confirmation')
    .not('approval_requested_at', 'is', null)
  for (const eng of pending ?? []) {
    const ageDays = (Date.now() - new Date(eng.approval_requested_at as string).getTime()) / 86_400_000
    const count = eng.approval_nudge_count ?? 0
    const due = (count === 0 && ageDays >= 2) || (count === 1 && ageDays >= 5)
    if (!due) continue
    const sent = await sendScheduleApprovalEmail(eng.id, 'nudge')
    if (sent !== 'sent' && sent !== 'duplicate') continue
    await supabase
      .from('tutoring_engagements')
      .update({ approval_nudge_count: count + 1, updated_at: new Date().toISOString() })
      .eq('id', eng.id)
    result.nudged++
    if (count === 1) {
      // Second nudge → also point Kelsie at the phone. No silent lock-in.
      const e = await loadApprovalEngagement(eng.id)
      await sendAdminAlert({
        dedupeKey: `schedule_unconfirmed:${eng.id}`,
        adminEmail: ADMIN_EMAIL,
        subject: `Still unconfirmed after 5 days — ${e?.studentFirst ?? 'a student'}'s tutoring schedule`,
        body: `<p>The family (${e?.parentEmail ?? '—'}) hasn't confirmed
          ${e?.studentFirst ?? 'the student'}'s proposed schedule with ${e?.tutorName ?? 'the tutor'}
          after two emails. Worth a call — the schedule never locks in on its own. You can also
          set it live directly from
          <a href="${appUrl()}/admin/tutoring?family=${e?.familyId ?? ''}" style="color:#00AEEE">the family's row on the Students panel</a>.</p>`,
      }).catch((err) => console.error('unconfirmed alert failed:', err))
      result.alerted++
    }
  }
  return result
}
