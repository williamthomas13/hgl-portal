import { supabaseAdmin as supabase } from './supabase-admin'
import { renderRegistered } from './comms-registered'
import { sendOnce, wrap, footerStaff, footerT } from './email'
import { formatTimeRange } from './dates'
import { recordTutorScheduleChange } from './tutor-notices'
import { scheduleSummaryText } from './schedule-approval'
import { autopayNudgeHtml } from './autopay-nudge'

// Phase 7c tutoring emails (spec §6): T1 monthly proposal, T1b nudge,
// T2 invoice, T3 schedule change, T4 payment failed. Code-rendered (the A4
// registry can adopt them later); every one carries the §8 human-help block:
// the portal is the convenient path, never the only path — replying to any
// of these emails or calling gets the same outcome, with the Ops Director
// doing the action on the family's behalf.

export type ContactInfo = { name: string; email: string; phone: string }

/** PL-50: the tutoring point-of-contact is a configurable app_settings
 *  triple (name/email/phone), editable only by an admin — reassigning the
 *  contact person updates the contact block everywhere AND the From identity
 *  of the schedule emails at once. Fallbacks only cover a wiped settings
 *  table; the real values are seeded. */
export async function loadContactInfo(): Promise<ContactInfo> {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['contact_name', 'contact_email', 'contact_phone'])
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  return {
    // PL-123: fallbacks are POSITION-based, never a person — the role
    // record (app_settings via the contact settings panel) is the source;
    // an empty record falls back to the shared inbox.
    name: map.contact_name ?? 'the Higher Ground office',
    email: map.contact_email ?? 'info@highergroundlearning.com',
    phone: map.contact_phone ?? '+1 (801) 524-0817',
  }
}

/** From-identity for emails sent "by" the tutoring contact (PL-40/41). */
export function contactFrom(c: ContactInfo): string {
  return `${c.name} <${c.email}>`
}

/** §8 block, styled for email bodies. */
export function contactBlockHtml(c: ContactInfo): string {
  return `<p style="margin-top:24px;padding:12px 16px;background:#f1f5f9;border-radius:8px;color:#334155;font-size:14px">
    Questions, or want to handle this by hand? Email
    <a href="mailto:${c.email}" style="color:#00AEEE">${c.email}</a> or give us a call at
    <strong>${c.phone}</strong> — replying to this email works too, and we'll take care of it for you.
  </p>`
}

export const money = (n: number) =>
  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export type StudentScheduleBlock = {
  studentFirst: string
  subjectName: string
  tutorFirst: string
  /** Pre-rendered lines in the family's timezone, e.g. "Tue, Sep 1 · 4:00–5:00 PM". */
  sessionLines: string[]
}

export function scheduleHtml(blocks: StudentScheduleBlock[]): string {
  return blocks
    .map(
      (b) => `<h3 style="color:#334155;margin:18px 0 6px">${b.studentFirst} — ${b.subjectName} with ${b.tutorFirst}</h3>
      <ul style="margin:0;padding-left:20px;color:#334155">
        ${b.sessionLines.map((l) => `<li style="margin:2px 0">${l}</li>`).join('')}
      </ul>`
    )
    .join('')
}

const firstNames = (blocks: StudentScheduleBlock[]) =>
  [...new Set(blocks.map((b) => b.studentFirst))].join(' & ')

// PL-76: the cancelled-class → 1-on-1 conversion on-ramp. Warm and short —
// the family already chose tutoring in their CX reply; this just gets their
// availability so the standard pipeline (wizard → approval → welcome) takes
// over. Sent from the PL-50 configured contact.
// PL-84: the terms sentence is the ONE conversion source of truth — hours
// variant when the cancellation carried an hours offer (the normal case),
// dollar-credit wording only as the no-offer fallback. Shared by the code
// twin and the registry's {conversionTermsBlock} so wording never drifts.
export function conversionTermsHtml(opts: {
  studentFirst: string
  classLabel: string
  offerHours: number | null
  creditAmount: string // "$899.00" — used only when offerHours is null
}): string {
  if (opts.offerHours && opts.offerHours > 0) {
    return `<p>Wonderful — you chose 1-on-1 tutoring for ${opts.studentFirst}. Your ${opts.classLabel} payment converts to <strong>${opts.offerHours} hours</strong> of 1-on-1 tutoring — nothing to pay until those are used.</p>`
  }
  return `<p>Wonderful — you chose 1-on-1 tutoring for ${opts.studentFirst}. Your ${opts.classLabel} payment (<strong>${opts.creditAmount}</strong>) is applied as credit toward these sessions, so there's nothing to pay now.</p>`
}

export function cxTutoringStartEmail(opts: {
  parentFirst: string | null
  studentFirst: string
  classLabel: string
  creditAmount: string // "$899.00"
  offerHours?: number | null // PL-84: hours offer wins when present
  availabilityLink: string
  contact: ContactInfo
}): { subject: string; html: string } {
  const subject = `Let's get ${opts.studentFirst}'s 1-on-1 tutoring going`
  const html = wrap(
    `<p>Hi ${opts.parentFirst ?? 'there'},</p>
     ${conversionTermsHtml({
       studentFirst: opts.studentFirst,
       classLabel: opts.classLabel,
       offerHours: opts.offerHours ?? null,
       creditAmount: opts.creditAmount,
     })}
     <p>One quick step: share when ${opts.studentFirst} is usually available, and we'll propose
     times that fit your family.</p>
     <p style="margin:24px 0"><a href="${opts.availabilityLink}" style="background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Share ${opts.studentFirst}'s availability</a></p>
     <p style="color:#64748b;font-size:13px">Prefer to talk it through? Just reply — we'll set
     everything up together.</p>
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `Your ${opts.classLabel} payment carries over — pick times that fit.`, footer: footerT() }
  )
  return { subject, html }
}

export function t1ProposalEmail(opts: {
  monthLabel: string // "September 2026"
  blocks: StudentScheduleBlock[]
  totalDue: number // 0 for fully package-covered months
  packageNote: string | null // e.g. "Covered by your prepaid package hours."
  link: string
  autoconfirmDays: number
  /** PL-362: THE one autopay nudge ('' composed for autopay families). */
  nudgeFamily: { id: string; autopay?: boolean | null } | null
  contact: ContactInfo
}): { subject: string; html: string } {
  const names = firstNames(opts.blocks)
  const subject = `${names}'s tutoring schedule for ${opts.monthLabel}`
  const html = wrap(
    `<h2 style="color:#334155">${names}'s ${opts.monthLabel} tutoring schedule</h2>
     <p>Here's the plan for ${opts.monthLabel} — same as always unless you'd like a change:</p>
     ${scheduleHtml(opts.blocks)}
     ${
       opts.totalDue > 0
         ? `<p style="font-size:16px"><strong>Month total: ${money(opts.totalDue)}</strong> — billed once you confirm, due by the end of this month.</p>`
         : ''
     }
     ${opts.packageNote ? `<p>${opts.packageNote}</p>` : ''}
     <p style="margin:24px 0">
       <a href="${opts.link}?confirm=1" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Confirm schedule</a>
       &nbsp;&nbsp;<a href="${opts.link}" style="color:#00AEEE">Request changes →</a>
     </p>
     <p style="color:#64748b;font-size:13px">Requesting changes takes one tap per session on that
     page — or just reply to this email if that's easier; both reach us the same way.</p>
     <p style="color:#64748b;font-size:13px">If we don't hear from you within ${opts.autoconfirmDays} days,
     the schedule confirms automatically and stays exactly as shown — same as our usual policy
     (schedule changes for the coming month need to reach us before month-end).</p>
     ${opts.nudgeFamily ? autopayNudgeHtml(opts.nudgeFamily, 'invoice') : ''}
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `${opts.monthLabel} schedule — confirm or request changes`, footer: footerT() }
  )
  return { subject, html }
}

export function t1bNudgeEmail(opts: {
  monthLabel: string
  names: string | null // student first names; null → generic wording
  link: string
  daysLeft: number
  /** PL-362: THE one autopay nudge ('' composed for autopay families). */
  nudgeFamily: { id: string; autopay?: boolean | null } | null
  contact: ContactInfo
}): { subject: string; html: string } {
  const whose = opts.names ? `${opts.names}'s` : 'your'
  const subject = `Reminder: ${whose} ${opts.monthLabel} tutoring schedule`
  const html = wrap(
    `<h2 style="color:#334155">Quick reminder — ${opts.monthLabel} schedule</h2>
     <p>We sent over ${whose} ${opts.monthLabel} tutoring schedule a couple of days ago.
     If it looks right, one click confirms it; if not, tell us what to change.</p>
     <p style="margin:24px 0">
       <a href="${opts.link}" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Review the schedule</a>
     </p>
     <p style="color:#64748b;font-size:13px">No action needed to keep everything as-is — the schedule
     confirms automatically in ${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}.</p>
     ${opts.nudgeFamily ? autopayNudgeHtml(opts.nudgeFamily, 'invoice') : ''}
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `One click to confirm ${opts.monthLabel}`, footer: footerT() }
  )
  return { subject, html }
}

export function t2InvoiceEmail(opts: {
  monthLabel: string
  total: number
  hostedUrl: string
  dueLabel: string // "August 31"
  /** PL-362: THE one autopay nudge, pre-composed ('' for autopay families). */
  nudgeFamily: { id: string; autopay?: boolean | null } | null
  contact: ContactInfo
  /** +10-day past-due reminder variant (§6.4 escalation). */
  reminder?: boolean
}): { subject: string; html: string } {
  const subject = opts.reminder
    ? `Reminder: HGL tutoring invoice for ${opts.monthLabel} — ${money(opts.total)}`
    : `Your HGL tutoring invoice for ${opts.monthLabel} — ${money(opts.total)}`
  const html = wrap(
    `<h2 style="color:#334155">${opts.monthLabel} tutoring invoice${opts.reminder ? ' — friendly reminder' : ''}</h2>
     ${
       opts.reminder
         ? `<p>Just a nudge that the ${opts.monthLabel} tutoring invoice (<strong>${money(opts.total)}</strong>,
            due ${opts.dueLabel}) is still open. If it's already on its way — thank you, ignore this!</p>`
         : `<p>Your invoice for ${opts.monthLabel} tutoring is ready: <strong>${money(opts.total)}</strong>,
            due by <strong>${opts.dueLabel}</strong>.</p>`
     }
     <p style="margin:24px 0">
       <a href="${opts.hostedUrl}" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">View &amp; pay invoice</a>
     </p>
     <p style="color:#64748b;font-size:13px">Pay by card or directly from a US bank account (ACH) —
     both options are on the invoice page.</p>
     ${opts.nudgeFamily ? autopayNudgeHtml(opts.nudgeFamily, 'invoice') : ''}
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `${money(opts.total)} due by ${opts.dueLabel}`, footer: footerT() }
  )
  return { subject, html }
}

/** PL-334: the repeating unpaid-invoice reminder's code twin (draft until
 *  Scarlett flips T2B_PAYMENT_REMINDER live). Same copy shape as the seed:
 *  a payment reminder, financial facts only, never marketing. */
export function t2bPaymentReminderEmail(opts: {
  monthLabel: string
  total: number
  hostedUrl: string
  dueLabel: string // "August 31"
  /** PL-362: THE one autopay nudge ('' composed for autopay families). */
  nudgeFamily: { id: string; autopay?: boolean | null } | null
  contact: ContactInfo
}): { subject: string; html: string } {
  const subject = `Reminder: your HGL tutoring invoice for ${opts.monthLabel} — ${money(opts.total)}`
  const html = wrap(
    `<h2 style="color:#334155">${opts.monthLabel} tutoring invoice — friendly reminder</h2>
     <p>The ${opts.monthLabel} tutoring invoice (<strong>${money(opts.total)}</strong>, due
     ${opts.dueLabel}) is still open.</p>
     <p style="margin:24px 0">
       <a href="${opts.hostedUrl}" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">View &amp; pay invoice</a>
     </p>
     <p style="color:#64748b;font-size:13px">Pay by card or directly from a US bank account (ACH) —
     both options are on the invoice page. If the payment is already on its way — thank you,
     please ignore this. And if anything on the invoice looks off, just reply and we'll sort it
     out.</p>
     ${opts.nudgeFamily ? autopayNudgeHtml(opts.nudgeFamily, 'invoice') : ''}
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `${money(opts.total)} — originally due ${opts.dueLabel}`, footer: footerT() }
  )
  return { subject, html }
}

export function t3ScheduleChangeEmail(opts: {
  studentFirst: string
  changeLines: string[] // plain-English before/after lines
  contact: ContactInfo
}): { subject: string; html: string } {
  const subject = `${opts.studentFirst}'s tutoring schedule changed`
  const html = wrap(
    `<h2 style="color:#334155">Schedule change confirmed</h2>
     <p>Here's what changed for ${opts.studentFirst}:</p>
     <ul style="margin:0;padding-left:20px;color:#334155">
       ${opts.changeLines.map((l) => `<li style="margin:2px 0">${l}</li>`).join('')}
     </ul>
     <p style="color:#64748b;font-size:13px;margin-top:16px">If this doesn't look right, just say so and we'll fix it.</p>
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `Change to ${opts.studentFirst}'s tutoring`, footer: footerT() }
  )
  return { subject, html }
}

export function t4PaymentFailedEmail(opts: {
  monthLabel: string
  total: number
  attempt: number
  maxAttempts: number
  hostedUrl: string | null // pay-by-link fallback when autopay keeps failing
  willRetry: boolean
  contact: ContactInfo
}): { subject: string; html: string } {
  const subject = `Payment issue — ${opts.monthLabel} tutoring invoice`
  const html = wrap(
    `<h2 style="color:#334155">We couldn't process your payment</h2>
     <p>The ${money(opts.total)} charge for ${opts.monthLabel} tutoring didn't go through
     (attempt ${opts.attempt} of ${opts.maxAttempts}).</p>
     ${
       opts.willRetry
         ? `<p>No action needed if this was a temporary card issue — we'll retry automatically in a couple of days.</p>`
         : `<p><strong>We've stopped automatic retries.</strong> You can pay directly, or update your saved payment method:</p>`
     }
     ${
       opts.hostedUrl
         ? `<p style="margin:24px 0"><a href="${opts.hostedUrl}" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Pay now</a></p>`
         : ''
     }
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `${opts.monthLabel} payment needs attention`, footer: footerT() }
  )
  return { subject, html }
}

// ---------------------------------------------------------------------------
// T3 dispatch (§6.5): any mid-month change to a confirmed session confirms
// to the parent and notifies the tutor (their calendar patch rides the gcal
// queue separately). Fire-and-forget from the session routes.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function one7c<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

/** PL-262: the "got your message" ack for a reschedule request — the code
 *  twin for T3_RESCHEDULE_ACK. Confirms a human saw it; the actual change
 *  still arrives as its own email once it's made. */
export function t3RescheduleAckEmail(opts: {
  parentFirst: string
  studentFirst: string
  subject: string
  when: string
  notice: 'ok' | 'late'
  contact: ContactInfo
}): { subject: string; html: string } {
  const subject = `Got it — we're on ${opts.studentFirst}'s reschedule request`
  const html = wrap(
    `<p>Hi ${opts.parentFirst},</p>
     <p>Just confirming your request to move ${opts.studentFirst}'s ${opts.subject} session on
     <strong>${opts.when}</strong> reached a real person — we're looking at the schedule now and
     you'll get a confirmation email as soon as the new time is set.</p>
     ${
       opts.notice === 'late'
         ? `<p style="color:#64748b;font-size:13px">Because the request came inside 24 hours of the
     session, the $40/hour late-reschedule fee from our scheduling policy may apply — we'll confirm
     either way when we reply.</p>`
         : ''
     }
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `Your reschedule request for ${opts.studentFirst} is with us.`, footer: footerT() }
  )
  return { subject, html }
}

/** PL-262: send the ack — dedupe is per request stamp, so a NEW request on
 *  the same session can be acknowledged again, but double-clicking the
 *  button can't double-send. */
export async function sendRescheduleAck(sessionId: string): Promise<'sent' | 'already' | 'no_request'> {
  const { data: s } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, starts_at, ends_at, reschedule_requested_at,
       students ( id, first_name, families ( parent_first_name, parent_email, billing_cc_emails, timezone ) ),
       tutoring_engagements ( subjects ( name ) ),
       instructors ( timezone )`
    )
    .eq('id', sessionId)
    .maybeSingle()
  if (!s || !s.reschedule_requested_at) return 'no_request'
  const student = one7c<any>(s.students)
  const family = one7c<any>(student?.families)
  if (!student || !family?.parent_email) return 'no_request'
  const subject = one7c<any>(one7c<any>(s.tutoring_engagements)?.subjects)?.name ?? 'tutoring'
  const tz = family.timezone ?? one7c<any>(s.instructors)?.timezone ?? 'America/Denver'
  // PL-339: the quoted session speaks its full range.
  const when = `${new Date(s.starts_at).toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })}, ${formatTimeRange(s.starts_at, s.ends_at, tz)}`
  const notice: 'ok' | 'late' =
    new Date(s.starts_at).getTime() - new Date(s.reschedule_requested_at).getTime() >= 24 * 3600_000
      ? 'ok'
      : 'late'
  const contact = await loadContactInfo()
  const email = await renderRegistered(
    'T3_RESCHEDULE_ACK',
    { parentFirstName: family.parent_first_name ?? 'there', parentEmail: family.parent_email, studentFirstName: student.first_name },
    {
      sessionWhenPhrase: when,
      subjectName: subject,
      lateFeeNoteBlock:
        notice === 'late'
          ? `<p style="color:#64748b;font-size:13px">Because the request came inside 24 hours of the session, the $40/hour late-reschedule fee from our scheduling policy may apply — we'll confirm either way when we reply.</p>`
          : '',
      contactBlock: contactBlockHtml(contact),
    },
    () =>
      t3RescheduleAckEmail({
        parentFirst: family.parent_first_name ?? 'there',
        studentFirst: student.first_name,
        subject,
        when,
        notice,
        contact,
      })
  )
  const status = await sendOnce({
    dedupeKey: `t3_resched_ack:${sessionId}:${s.reschedule_requested_at}`,
    emailType: 'T3_RESCHEDULE_ACK',
    templateKey: 'T3_RESCHEDULE_ACK',
    to: [family.parent_email],
    cc: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
    subject: email.subject,
    html: email.html,
  })
  return status === 'sent' ? 'sent' : 'already'
}

export async function sendScheduleChangeNotices(opts: {
  sessionId: string
  kind: 'reschedule' | 'forfeited' | 'no_show'
  notice?: 'ok' | 'late'
  replacementId?: string
}): Promise<void> {
  try {
    const { data: s } = await supabase
      .from('tutoring_sessions')
      .select(
        `id, starts_at, ends_at, status,
         students ( id, first_name, families ( parent_first_name, parent_email, billing_cc_emails, timezone ) ),
         tutoring_engagements ( subjects ( name ) ),
         instructors ( id, name, email, timezone )`
      )
      .eq('id', opts.sessionId)
      .maybeSingle()
    if (!s) return
    const student = one7c<any>(s.students)
    const family = one7c<any>(student?.families)
    const tutor = one7c<any>(s.instructors)
    const subject = one7c<any>(one7c<any>(s.tutoring_engagements)?.subjects)?.name ?? 'tutoring'
    if (!student || !family) return
    const tz = family.timezone ?? tutor?.timezone ?? 'America/Denver'
    // PL-339: every quoted session time is the full range.
    const fmt = (startIso: string, endIso?: string | null) =>
      `${new Date(startIso).toLocaleDateString('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })}, ${formatTimeRange(startIso, endIso, tz)}`

    const changeLines: string[] = []
    let replacementStartsAt: string | null = null
    let replacementEndsAt: string | null = null
    if (opts.kind === 'reschedule' && opts.replacementId) {
      const { data: r } = await supabase
        .from('tutoring_sessions')
        .select('starts_at, ends_at')
        .eq('id', opts.replacementId)
        .maybeSingle()
      replacementStartsAt = r?.starts_at ?? null
      replacementEndsAt = r?.ends_at ?? null
      changeLines.push(
        `${subject} on ${fmt(s.starts_at, s.ends_at)} moved to ${r ? fmt(r.starts_at, r.ends_at) : 'a new time'}.`
      )
      if (opts.notice === 'late') {
        changeLines.push(
          `Because the change came inside 24 hours, the $40/hour reschedule fee from our scheduling policy applies — it will appear on next month's invoice.`
        )
      }
    } else if (opts.kind === 'no_show') {
      changeLines.push(`${subject} on ${fmt(s.starts_at, s.ends_at)} was marked a no-show.`)
      changeLines.push(`Per the prepaid-month policy the session isn't refunded, but do get in touch — emergencies are always our call to make together.`)
    } else {
      changeLines.push(`${subject} on ${fmt(s.starts_at, s.ends_at)} was cancelled without a replacement, so the prepaid session is forfeited.`)
      changeLines.push(`If you'd rather reschedule it after all, just say the word.`)
    }

    const contact = await loadContactInfo()
    // PL-13: registry template when live; code copy otherwise.
    const email = await renderRegistered(
      'T3_SCHEDULE_CHANGE',
      { parentFirstName: family.parent_first_name ?? 'there', parentEmail: family.parent_email, studentFirstName: student.first_name },
      {
        changeListBlock: `<ul style="margin:0;padding-left:20px;color:#334155">${changeLines.map((l) => `<li style="margin:2px 0">${l}</li>`).join('')}</ul>`,
        contactBlock: contactBlockHtml(contact),
      },
      () => t3ScheduleChangeEmail({ studentFirst: student.first_name, changeLines, contact })
    )
    await sendOnce({
      dedupeKey: `t3_change:${opts.sessionId}:${opts.replacementId ?? opts.kind}`,
      emailType: 'T3_SCHEDULE_CHANGE',
      to: [family.parent_email],
      cc: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
      subject: email.subject,
      html: email.html,
    })

    // PL-81: the tutor side no longer sends per change — it folds into the
    // tutor's coalesced pending notice (45-min sliding window, 3-h cap,
    // immediate when a touched session starts within 24 h). The parent T3
    // above and the calendar patch stay instant.
    if (tutor?.id && tutor?.email && student.id) {
      await recordTutorScheduleChange({
        tutorId: tutor.id,
        change: {
          sessionId: opts.sessionId,
          kind: opts.kind,
          notice: opts.notice,
          // PL-85: lets a later change to the replacement session chain onto
          // this one, so the notice collapses to the net effect.
          replacementId: opts.replacementId ?? null,
          studentId: student.id,
          studentFirst: student.first_name,
          subjectName: subject,
          oldStartsAt: s.starts_at,
          newStartsAt: replacementStartsAt,
          // PL-339: ends travel too, so the tutor notice quotes ranges.
          oldEndsAt: s.ends_at ?? null,
          newEndsAt: replacementEndsAt,
          recordedAt: new Date().toISOString(),
        },
      })
    }
  } catch (e) {
    console.error('T3 dispatch failed (schedule change stands):', e)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** PL-387 A: a WHOLESALE weekly-pattern edit (the engagement's recurrence or
 *  tutor changed and future sessions re-projected) is a real schedule change
 *  — the family hears the new plan through the SAME T3_SCHEDULE_CHANGE
 *  vehicle single-session moves use, and the tutor gets a direct note (their
 *  Google Calendar is already updated by the sync). Completed and
 *  already-billed sessions were never touched, and the copy says so. */
export async function sendPatternChangeNotices(
  engagementId: string,
  delta: { added: number; dropped: number; unchanged: number }
): Promise<void> {
  try {
    const { data: e } = await supabase
      .from('tutoring_engagements')
      .select(
        `id, recurrence, start_date,
         students ( first_name, families ( parent_first_name, parent_email, timezone ) ),
         subjects ( name ),
         instructors!tutoring_engagements_tutor_id_fkey ( name, email, timezone )`
      )
      .eq('id', engagementId)
      .maybeSingle()
    if (!e) return
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const student = one7c<any>(e.students)
    const family = one7c<any>(student?.families)
    const tutor = one7c<any>(e.instructors)
    const subjectName = one7c<any>(e.subjects)?.name ?? 'tutoring'
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!student) return
    const summary = scheduleSummaryText({
      recurrence: Array.isArray(e.recurrence) ? e.recurrence : [],
      start_date: e.start_date ?? null,
      tutorTz: tutor?.timezone ?? 'America/Denver',
      familyTz: family?.timezone ?? tutor?.timezone ?? 'America/Denver',
    })
    const changeLines = [
      `The regular weekly plan is now: <strong>${summary}</strong>.`,
      `${delta.added} upcoming session${delta.added === 1 ? '' : 's'} were re-planned onto the new times` +
        (delta.dropped > 0 ? ` (${delta.dropped} old slot${delta.dropped === 1 ? '' : 's'} came off the calendar)` : '') +
        ` — sessions already completed or billed stay exactly as they were.`,
    ]

    if (family?.parent_email) {
      const contact = await loadContactInfo()
      const twin = () => {
        const r = t3ScheduleChangeEmail({ studentFirst: student.first_name, changeLines, contact })
        return { subject: r.subject, html: r.html }
      }
      const email = await renderRegistered(
        'T3_SCHEDULE_CHANGE',
        { parentFirstName: family.parent_first_name ?? 'there', parentEmail: family.parent_email, studentFirstName: student.first_name },
        {
          changeListBlock: `<ul style="margin:0;padding-left:20px;color:#334155">${changeLines
            .map((l) => `<li style="margin:2px 0">${l}</li>`)
            .join('')}</ul>`,
        },
        twin
      )
      await sendOnce({
        dedupeKey: `t3_pattern_change:${engagementId}:${Date.now()}`,
        emailType: 'T3_SCHEDULE_CHANGE',
        templateKey: 'T3_SCHEDULE_CHANGE',
        to: [family.parent_email],
        subject: email.subject,
        html: email.html,
        bodySnapshotId: email.versionId,
      })
    }

    if (tutor?.email) {
      await sendOnce({
        dedupeKey: `t3t_pattern_change:${engagementId}:${Date.now()}`,
        emailType: 'T3_TUTOR_PATTERN',
        to: [tutor.email],
        subject: `Schedule change: ${student.first_name} — ${subjectName}`,
        html: wrap(
          `<h3 style="color:#334155">Schedule change</h3>
           <p>${student.first_name}'s regular weekly plan changed to: <strong>${summary}</strong>.</p>
           <p>${delta.added} upcoming session${delta.added === 1 ? '' : 's'} re-planned${
             delta.dropped > 0 ? `, ${delta.dropped} old slot${delta.dropped === 1 ? '' : 's'} removed` : ''
           } — your Google Calendar is already updated; completed and billed sessions are untouched.</p>`,
          { preheader: `${student.first_name}'s weekly plan changed — calendar already updated.`, footer: footerStaff() }
        ),
      })
    }
  } catch (err) {
    console.error('pattern-change notices failed (the schedule change itself stands):', err)
  }
}
