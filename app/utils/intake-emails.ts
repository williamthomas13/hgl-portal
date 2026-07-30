import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, wrap, footerT } from './email'
import { loadContactInfo, contactBlockHtml, type ContactInfo } from './tutoring-emails'
import { autopayToken, tutoringIcsToken } from './tutoring-billing'
import { agreementToken } from './intake'
import { renderRegistered } from './comms-registered'

// Phase 7e intake/onboarding emails (docs/PHASE7_SPEC.md §11): T7 asks the
// family to fill out the doctor's-office intake form; T8 is the Ops
// Director's intro/handoff email as a template — tutor, first-month schedule,
// agreements link, autopay link, location, the 24h policy line. Both carry
// the §8 human-help block: replying or calling always works.

const appUrl = () => emailBaseUrl()

const button = (label: string, href: string) =>
  `<p style="margin:24px 0">
    <a href="${href}" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">${label}</a>
  </p>`

// ---------------------------------------------------------------------------
// T7 — Intake request (sent from /admin/leads; re-sendable)
// ---------------------------------------------------------------------------

export function t7IntakeRequestEmail(opts: {
  contactFirst: string | null // lead contact's first name; null → generic greeting
  studentFirst: string | null // student first name if known
  link: string
  contact: ContactInfo
}): { subject: string; html: string } {
  const who = opts.studentFirst ? `${opts.studentFirst}'s` : `your student's`
  const subject = opts.studentFirst
    ? `A few quick questions before ${opts.studentFirst}'s tutoring starts`
    : `A few quick questions before tutoring starts`
  const html = wrap(
    `<p>Hi ${opts.contactFirst ?? 'there'},</p>
     <p>We're excited to get started! To match ${who} tutor well and keep everything running
     smoothly, we just need a few details — the same questions we'd otherwise trade over a
     week of emails, all on one page.</p>
     <p>It takes about five minutes, works on a phone, and there's nothing to print, scan,
     or sign in to:</p>
     ${button('Fill out the intake form', opts.link)}
     <p style="color:#64748b;font-size:13px">We'll ask about scheduling availability,
     what ${opts.studentFirst ?? 'your student'} is working toward, and the practical bits
     (emergency contact, anything we should know). Your answers come straight to us.</p>
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `Five minutes, one page, no login — and you're set.`, footer: footerT() }
  )
  return { subject, html }
}

// ---------------------------------------------------------------------------
// Agreement request / chase (sent standalone from /admin/agreements; the
// same link also rides inside T8)
// ---------------------------------------------------------------------------

export function agreementRequestEmail(opts: {
  parentFirst: string | null
  /** "Roman" or "Roman & Ana" — drives the PL-63 kind-but-firm line. */
  studentNames: string
  link: string
  contact: ContactInfo
}): { subject: string; html: string } {
  const subject = `One quick thing: our scheduling & billing policies`
  const html = wrap(
    `<p>Hi ${opts.parentFirst ?? 'there'},</p>
     <p>Before (or as) tutoring gets underway, we ask every family to read and accept our
     scheduling &amp; billing policies — how monthly billing works, the 24-hour reschedule
     rule, that sort of thing. It's a two-minute read and one click to accept:</p>
     ${button('Read & accept the policies', opts.link)}
     <p>One important note: we can't start ${opts.studentNames}'s sessions until this is
     signed — it takes about two minutes, and it protects your family as much as it
     protects us.</p>
     <p style="color:#64748b;font-size:13px">You'll get a copy of exactly what you accepted,
     and we keep one too — no forms to print or return.</p>
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `Two-minute read, one click — and it's done.`, footer: footerT() }
  )
  return { subject, html }
}

// PL-63b: the automatic chase (+3d / +7d after the first ask, stops on
// acceptance). Kind but firm — same voice as the first send.
export function agreementNudgeEmail(opts: {
  parentFirst: string | null
  studentNames: string
  link: string
  contact: ContactInfo
}): { subject: string; html: string } {
  const subject = `A quick reminder: our policies still need your OK`
  const html = wrap(
    `<p>Hi ${opts.parentFirst ?? 'there'},</p>
     <p>Just a nudge — our scheduling &amp; billing policies are still waiting for your OK,
     and we can't start ${opts.studentNames}'s sessions until they're signed. It takes about
     two minutes, and it protects your family as much as it protects us:</p>
     ${button('Read & accept the policies', opts.link)}
     <p style="color:#64748b;font-size:13px">Already accepted them? Then our systems are just
     catching up — you can ignore this.</p>
     ${contactBlockHtml(opts.contact)}`,
    { preheader: `Two minutes, one click — then sessions can start.`, footer: footerT() }
  )
  return { subject, html }
}

// ---------------------------------------------------------------------------
// T8 — Welcome / handoff (spec §11): sent when the family's first engagement
// is created. NOT wired into the engagement route here — the integrating
// session connects the call site; this function is complete and ready.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export async function sendWelcomeHandoff(
  engagementId: string
): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed' | 'skipped'> {
  const { data: eng } = await supabase
    .from('tutoring_engagements')
    .select(
      `id, location,
       students ( first_name,
         families ( id, parent_first_name, parent_email, billing_cc_emails, timezone ) ),
       subjects ( name ),
       instructors ( name, email, timezone, default_meeting_link )`
    )
    .eq('id', engagementId)
    .maybeSingle()
  if (!eng) return 'skipped'
  const student = one<any>(eng.students)
  const family = one<any>(student?.families)
  const tutor = one<any>(eng.instructors)
  const subjectName = one<any>(eng.subjects)?.name ?? 'tutoring'
  if (!student || !family?.parent_email || !tutor) return 'skipped'

  // PL-185: ONE welcome per FAMILY, owned here so every caller (create on
  // the already-agreed path, the confirm transition, staff override) can
  // invoke it safely — sibling and repeat engagements skip. The per-
  // engagement sendOnce dedupe below still guards double-submits.
  const { data: prior } = await supabase
    .from('email_sends')
    .select('id')
    .eq('template_key', 'T8_WELCOME_HANDOFF')
    .eq('recipient_email', family.parent_email)
    .eq('is_test', false)
    .in('status', ['scheduled', 'sending', 'sent', 'delivered'])
    .limit(1)
  if (prior?.length) return 'duplicate'

  // First-month schedule summary: the engagement's upcoming sessions.
  const { data: sessions } = await supabase
    .from('tutoring_sessions')
    .select('starts_at, ends_at')
    .eq('engagement_id', engagementId)
    .in('status', ['proposed', 'confirmed'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(12)

  const tz = family.timezone ?? tutor.timezone ?? 'America/Denver'
  const scheduleLines = ((sessions as any[]) ?? []).map((s) => {
    const d = new Date(s.starts_at)
    const e = new Date(s.ends_at)
    const day = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
    const t1 = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    const t2 = e.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    return `${day} · ${t1}–${t2}`
  })

  const tutorFirst = (tutor.name ?? 'your tutor').split(' ')[0]
  const location = eng.location ?? tutor.default_meeting_link ?? null
  const isLink = location ? /^https?:\/\//i.test(location) : false
  // PL-234: the "tutor sends the meeting link" line renders ONLY when nothing
  // anywhere names a location (engagement empty AND tutor default empty — the
  // same test as PL-211's no-location walk-past). Any known link or place
  // renders as itself.
  const locationHtml = location
    ? isLink
      ? `<p><strong>Where:</strong> sessions are online — join here each time:
         <a href="${location}" style="color:#00AEEE">${location}</a></p>`
      : `<p><strong>Where:</strong> ${location}</p>`
    : `<p><strong>Where:</strong> sessions happen online — ${tutorFirst} sends the meeting
       link before each session.</p>`
  const contact = await loadContactInfo()
  const agreementsLink = `${appUrl()}/agreements/${agreementToken(family.id)}`
  const autopayLink = `${appUrl()}/tutoring/autopay/${autopayToken(family.id)}`
  // PL-222: T8 absorbed the all-set's unique payload (calendar subscribe,
  // schedule PDF, the reschedule-it-yourself line) — on a first-time family's
  // activation only the extended T8 goes out; T_SCHEDULE_SET stays for
  // repeat/sibling engagements (the callers fold on this function's return).
  const icsToken = tutoringIcsToken(family.id)
  const calendarLink = `webcal://${appUrl().replace(/^https?:\/\//, '')}/api/tutoring/calendar/${icsToken}`
  const schedulePdfLink = `${appUrl()}/api/tutoring/schedule.pdf/${icsToken}`
  const portalLink = `${appUrl()}/portal`

  const codeSubject = `Welcome! ${student.first_name}'s ${subjectName} tutoring with ${tutorFirst}`
  const html = wrap(
    `<h2 style="color:#334155">Welcome aboard!</h2>
     <p>Hi ${family.parent_first_name ?? 'there'},</p>
     <p>${student.first_name} is all set for 1-on-1 ${subjectName} tutoring with
     <strong>${tutor.name ?? tutorFirst}</strong>. Here's everything in one place.</p>
     <p><strong>Your tutor:</strong> ${tutor.name ?? tutorFirst}
     ${tutor.email ? `— <a href="mailto:${tutor.email}" style="color:#00AEEE">${tutor.email}</a>` : ''}</p>
     ${locationHtml}
     ${
       scheduleLines.length > 0
         ? `<p><strong>The first sessions:</strong></p>
            <ul style="margin:0;padding-left:20px;color:#334155">
              ${scheduleLines.map((l) => `<li style="margin:2px 0">${l}</li>`).join('')}
            </ul>
            <p style="color:#64748b;font-size:13px">Each month you'll get the next month's
            schedule by email to confirm or adjust — no action needed if it looks right.</p>`
         : `<p>We'll send the session schedule shortly — each month you'll get the next
            month's plan by email to confirm or adjust.</p>`
     }
     <p>A couple of things to make life easier:</p>
     ${button('Add to your calendar', calendarLink)}
     <p style="color:#64748b;font-size:13px;margin-top:-12px">Subscribe once and every session
     (and any future change) shows up automatically.</p>
     ${button('Download the schedule (PDF)', schedulePdfLink)}
     <p>You can reschedule any single session yourself from your parent portal — no need to
     email us for the small stuff.</p>
     <p><strong>One thing we need:</strong> please read and accept our scheduling &amp;
     billing policies — sessions can't start until they're signed, and they protect your
     family as much as they protect us (two minutes, one click):</p>
     ${button('Read & accept the policies', agreementsLink)}
     <p style="color:#64748b;font-size:13px"><strong>The one rule worth remembering:</strong>
     with 24+ hours' notice, rescheduling a session is always free — inside 24 hours the
     prepaid session is forfeited or carries a $40/hour reschedule fee, because
     ${tutorFirst} is still paid for the reserved time.</p>
     <p style="color:#64748b;font-size:13px">Prefer not to think about invoices?
     <a href="${autopayLink}" style="color:#00AEEE">Set up autopay</a> and each month's
     confirmed invoice charges your saved card or bank account automatically.</p>
     <p><strong>One more thing worth knowing: you have a family portal.</strong>
     <a href="${portalLink}" style="color:#00AEEE">Open it any time</a> — it's yours for the
     whole tutoring journey. Inside you'll find ${student.first_name}'s schedule, your receipts
     and invoices, session notes on what ${student.first_name} worked on, one-click rescheduling
     for any single session, and a calendar feed you can subscribe to. Signing in never needs a
     password — just this email address.</p>
     ${contactBlockHtml(contact)}`,
    {
      preheader: `${student.first_name} + ${tutorFirst}: schedule, policies, and everything else.`,
      footer: footerT(),
    }
  )

  // PL-13: registry template when live; the code render above is the fallback.
  const email = await renderRegistered(
    'T8_WELCOME_HANDOFF',
    {
      parentFirstName: family.parent_first_name ?? 'there',
      parentEmail: family.parent_email,
      studentFirstName: student.first_name,
      // PL-222: {calendarLink} resolves from the stub's calendarPageUrl —
      // here that's the family's live-updating tutoring calendar feed.
      calendarPageUrl: calendarLink,
    },
    {
      tutoringSubject: subjectName,
      tutorName: tutor.name ?? tutorFirst,
      tutorFirstName: tutorFirst,
      tutorContactLine: `<p><strong>Your tutor:</strong> ${tutor.name ?? tutorFirst}
        ${tutor.email ? `— <a href="mailto:${tutor.email}" style="color:#00AEEE">${tutor.email}</a>` : ''}</p>`,
      locationBlock: locationHtml,
      scheduleBlock:
        scheduleLines.length > 0
          ? `<p><strong>The first sessions:</strong></p>
             <ul style="margin:0;padding-left:20px;color:#334155">
               ${scheduleLines.map((l) => `<li style="margin:2px 0">${l}</li>`).join('')}
             </ul>
             <p style="color:#64748b;font-size:13px">Each month you'll get the next month's
             schedule by email to confirm or adjust — no action needed if it looks right.</p>`
          : `<p>We'll send the session schedule shortly — each month you'll get the next
             month's plan by email to confirm or adjust.</p>`,
      agreementsLink,
      autopayLink,
      schedulePdfLink,
      contactBlock: contactBlockHtml(contact),
    },
    () => ({ subject: codeSubject, html })
  )

  return sendOnce({
    dedupeKey: `t8_welcome:${engagementId}`,
    emailType: 'T8_WELCOME_HANDOFF',
    to: [family.parent_email],
    cc: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
    subject: email.subject,
    html: email.html,
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
