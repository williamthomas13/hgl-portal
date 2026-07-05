import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

// Server-side only. Every send goes through sendOnce(), which claims a row in
// email_log first — Stripe webhook retries and cron re-runs never double-send.
//
// COPY NOTE: everything between "PLACEHOLDER COPY" markers is stand-in text.
// Real copy is being finalized separately and drops in here template by
// template without touching any scheduling logic.

const FROM = process.env.EMAIL_FROM ?? 'Higher Ground Learning <onboarding@resend.dev>'

// Personal sender for the relationship-building emails (review request,
// tutoring offer). Everything else — sequences, reminders, admin alerts —
// uses the default sender above.
const PERSONAL_FROM =
  process.env.EMAIL_FROM_PERSONAL ?? 'Higher Ground Learning <billy@highergroundlearning.com>'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

export type SessionInfo = {
  id: string
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

export type EnrollmentEmailContext = {
  enrollmentId: string
  classId: string
  calendarPageUrl: string
  /** Always first session date − 1 day. Computed, never stored. */
  diagnosticDueDate: string
  marketingOptOut: boolean
  unsubscribeUrl: string
  parentFirstName: string
  parentEmail: string
  studentFirstName: string
  studentEmail: string | null
  className: string // e.g. "Nido — SAT Prep"
  instructorName: string | null
  defaultLocation: string | null
  synapGroup: string | null
  startDate: string
  firstSession: string
  lastSession: string
  price: number
  sessions: SessionInfo[]
}

export function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(t: string | null) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

export function sessionLine(s: SessionInfo, fallbackLocation: string | null) {
  const parts = [formatDate(s.session_date)]
  const start = formatTime(s.start_time)
  const end = formatTime(s.end_time)
  if (start) parts.push(end ? `${start}–${end}` : start)
  const loc = s.location ?? fallbackLocation
  if (loc) parts.push(loc)
  return parts.join(' · ')
}

function scheduleHtml(ctx: EnrollmentEmailContext) {
  if (ctx.sessions.length === 0) return ''
  const items = ctx.sessions
    .map((s) => `<li style="margin-bottom:4px">${sessionLine(s, ctx.defaultLocation)}</li>`)
    .join('')
  return `<h3 style="color:#334155">Class schedule</h3><ul style="padding-left:20px">${items}</ul>`
}

function synapSection(ctx: EnrollmentEmailContext) {
  if (!ctx.synapGroup) return ''
  // PLACEHOLDER COPY
  return `
    <h3 style="color:#334155">Practice test access</h3>
    <p>Your class uses Synap for practice tests. You'll receive an invitation to the
    <strong>${ctx.synapGroup}</strong> group${ctx.studentEmail ? ` at ${ctx.studentEmail}` : ''}
    before the first session.</p>`
}

function faqSection() {
  // PLACEHOLDER COPY
  return `
    <h3 style="color:#334155">Frequently asked questions</h3>
    <p>[FAQ placeholder — real copy coming: what to bring, attendance policy,
    make-up sessions, contact info.]</p>`
}

type WrapOpts = {
  /** Hidden preview-text line shown next to the subject in inbox lists. */
  preheader?: string
  unsubscribeUrl?: string
}

function wrap(body: string, opts: WrapOpts = {}) {
  const unsub = opts.unsubscribeUrl
    ? ` · <a href="${opts.unsubscribeUrl}" style="color:#64748b">Unsubscribe from non-essential updates</a>`
    : ''
  // Hidden preheader + whitespace padding so clients don't pull body text
  // into the preview line instead. Same technique React Email's <Preview>
  // renders to.
  const preheader = opts.preheader
    ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;mso-hide:all">
        ${opts.preheader}${'&#8199;&#65279; '.repeat(30)}
      </div>`
    : ''
  return `
  ${preheader}
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
    <div style="border-top:4px solid #00AEEE;padding:24px 8px">
      ${body}
      <p style="margin-top:32px;font-size:13px;color:#64748b">
        Higher Ground Learning · questions? Just reply to this email.${unsub}
      </p>
    </div>
  </div>`
}

function calendarButton(ctx: EnrollmentEmailContext) {
  return `
    <p style="margin-top:20px">
      <a href="${ctx.calendarPageUrl}" style="display:inline-block;background:#00AEEE;color:#fff;
      font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none">
      Download the course calendar</a>
    </p>`
}

export function recipients(ctx: EnrollmentEmailContext) {
  return ctx.studentEmail ? [ctx.parentEmail, ctx.studentEmail] : [ctx.parentEmail]
}

type Rendered = { subject: string; html: string; from?: string }

// ---------------------------------------------------------------------------
// Payment reminders (Pending enrollments) — PLACEHOLDER COPY
// ---------------------------------------------------------------------------

export function paymentReminderEmail(ctx: EnrollmentEmailContext, n: number): Rendered {
  const urgency = [
    'your spot is being held',
    'your spot is still being held',
    'spots are filling up',
    'this is the final reminder — unpaid registrations expire soon',
  ][n - 1]
  return {
    subject: `Complete ${ctx.studentFirstName}'s registration for ${ctx.className}`,
    html: wrap(
      `
      <h2 style="color:#334155">Payment reminder ${n} of 4</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder] ${ctx.studentFirstName}'s registration for
      <strong>${ctx.className}</strong> ($${ctx.price}) hasn't been paid yet — ${urgency}.
      Use the link from your registration, or register again to get a fresh payment link.</p>
    `,
      { preheader: `[Placeholder preheader] ${ctx.studentFirstName}'s spot isn't confirmed yet` }
    ),
  }
}

// ---------------------------------------------------------------------------
// Email #0: student-facing confirmation — TRANSACTIONAL (always sends, no
// unsubscribe). Distinct copy from the parent thank-you; final copy ships in
// the content pack.
// ---------------------------------------------------------------------------

export function studentConfirmationEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `You're in: ${ctx.className}`,
    html: wrap(
      `
      <h2 style="color:#334155">You're enrolled</h2>
      <p>Hi ${ctx.studentFirstName},</p>
      <p>[Placeholder student confirmation — distinct copy in content pack]
      You're all set for <strong>${ctx.className}</strong>, starting
      ${formatDate(ctx.firstSession)}.</p>
      ${scheduleHtml(ctx)}
      ${calendarButton(ctx)}
    `,
      { preheader: `[Placeholder preheader] Your ${ctx.className} details inside` }
    ),
  }
}

// ---------------------------------------------------------------------------
// Post-payment sequence — PLACEHOLDER COPY
// ---------------------------------------------------------------------------

export function thankYouEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    from: PERSONAL_FROM,
    subject: `You're registered: ${ctx.className}`,
    html: wrap(
      `
      <h2 style="color:#334155">Thank you — registration confirmed</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder thank-you] <strong>${ctx.studentFirstName}</strong> is registered and paid for
      <strong>${ctx.className}</strong>, starting ${formatDate(ctx.firstSession)}.</p>
      ${scheduleHtml(ctx)}
      ${calendarButton(ctx)}
    `,
      {
        preheader: `[Placeholder preheader] ${ctx.studentFirstName} is confirmed for ${ctx.className}`,
        unsubscribeUrl: ctx.unsubscribeUrl,
      }
    ),
  }
}

export function synapAccessEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `Diagnostic test access for ${ctx.className}`,
    html: wrap(
      `
      <h2 style="color:#334155">Your diagnostic test</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder] ${ctx.studentFirstName}'s class starts ${formatDate(ctx.firstSession)} —
      the diagnostic is due by <strong>${formatDate(ctx.diagnosticDueDate)}</strong>.</p>
      ${synapSection(ctx)}
    `,
      { preheader: `[Placeholder preheader] Diagnostic due ${formatDate(ctx.diagnosticDueDate)}` }
    ),
  }
}

export function faqEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `${ctx.className} — what to know before we start`,
    html: wrap(
      `
      <h2 style="color:#334155">Before class starts</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      ${faqSection()}
      ${scheduleHtml(ctx)}
      ${calendarButton(ctx)}
    `,
      { preheader: `[Placeholder preheader] Everything to know before ${ctx.className} begins` }
    ),
  }
}

export function classDetailsEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `${ctx.className} starts ${formatDate(ctx.firstSession)} — details inside`,
    html: wrap(
      `
      <h2 style="color:#334155">Class details</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder] Everything ${ctx.studentFirstName} needs for day one:</p>
      <ul style="padding-left:20px">
        <li><strong>Instructor:</strong> ${ctx.instructorName}</li>
        <li><strong>Location:</strong> ${ctx.defaultLocation}</li>
        <li><strong>First session:</strong> ${formatDate(ctx.firstSession)}</li>
      </ul>
      ${scheduleHtml(ctx)}
      ${calendarButton(ctx)}
    `,
      { preheader: `[Placeholder preheader] Instructor, location, and start info for ${ctx.className}` }
    ),
  }
}

export function locationReminderEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `Tomorrow: ${ctx.className}`,
    html: wrap(
      `
      <h2 style="color:#334155">See you tomorrow</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder] ${ctx.studentFirstName}'s first session of <strong>${ctx.className}</strong>
      is tomorrow${ctx.defaultLocation ? ` at <strong>${ctx.defaultLocation}</strong>` : ''}.</p>
      ${ctx.sessions[0] ? `<p><strong>${sessionLine(ctx.sessions[0], ctx.defaultLocation)}</strong></p>` : ''}
    `,
      { preheader: `[Placeholder preheader] ${ctx.className} starts tomorrow` }
    ),
  }
}

export function secondDiagnosticEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `${ctx.className} — second diagnostic reminder`,
    html: wrap(
      `
      <h2 style="color:#334155">Second diagnostic</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder] One week into <strong>${ctx.className}</strong> — time for
      ${ctx.studentFirstName}'s second diagnostic test.</p>
      ${synapSection(ctx)}
    `,
      {
        preheader: `[Placeholder preheader] Time for the second diagnostic`,
        unsubscribeUrl: ctx.unsubscribeUrl,
      }
    ),
  }
}

export function reviewRequestEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    from: PERSONAL_FROM,
    subject: `How was ${ctx.className}?`,
    html: wrap(
      `
      <h2 style="color:#334155">We'd love your feedback</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder review request] ${ctx.studentFirstName} just finished
      <strong>${ctx.className}</strong> — would you leave us a quick review?</p>
    `,
      {
        preheader: `[Placeholder preheader] How was ${ctx.className}? Two minutes, big help`,
        unsubscribeUrl: ctx.unsubscribeUrl,
      }
    ),
  }
}

export function tutoringOfferEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    from: PERSONAL_FROM,
    subject: `A tutoring offer for ${ctx.studentFirstName}`,
    html: wrap(
      `
      <h2 style="color:#334155">Keep the momentum going</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder discounted tutoring offer] As a ${ctx.className} family,
      you qualify for a discount on 1-on-1 tutoring.</p>
    `,
      {
        preheader: `[Placeholder preheader] A tutoring discount for ${ctx.className} families`,
        unsubscribeUrl: ctx.unsubscribeUrl,
      }
    ),
  }
}

/**
 * Late registration: thank-you + Synap + FAQ merged into one welcome.
 * Sends from the personal address (it carries the thank-you), but always
 * sends regardless of opt-out — the Synap/FAQ content is transactional.
 */
export function combinedWelcomeEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    from: PERSONAL_FROM,
    subject: `Welcome to ${ctx.className} — everything you need`,
    html: wrap(
      `
      <h2 style="color:#334155">Thank you — registration confirmed</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder combined welcome] <strong>${ctx.studentFirstName}</strong> is registered and
      paid for <strong>${ctx.className}</strong>, starting ${formatDate(ctx.firstSession)}.
      Since class is coming up soon, here's everything in one email:</p>
      ${scheduleHtml(ctx)}
      ${synapSection(ctx)}
      ${faqSection()}
      ${calendarButton(ctx)}
    `,
      {
        preheader: `[Placeholder preheader] Schedule, diagnostic, and FAQs for ${ctx.className}`,
        unsubscribeUrl: ctx.unsubscribeUrl,
      }
    ),
  }
}

export function scheduleUpdateEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `Schedule update: ${ctx.className}`,
    html: wrap(`
      <h2 style="color:#334155">Class details have changed</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder] The details for <strong>${ctx.className}</strong> have been updated.
      Current details:</p>
      <ul style="padding-left:20px">
        <li><strong>Instructor:</strong> ${ctx.instructorName ?? 'TBD'}</li>
        <li><strong>Location:</strong> ${ctx.defaultLocation ?? 'TBD'}</li>
        <li><strong>First session:</strong> ${formatDate(ctx.firstSession)}</li>
      </ul>
      ${scheduleHtml(ctx)}
      ${calendarButton(ctx)}
    `,
      { preheader: `[Placeholder preheader] Updated details for ${ctx.className}` }
    ),
  }
}

// ---------------------------------------------------------------------------
// Waitlist — PLACEHOLDER COPY
// ---------------------------------------------------------------------------

export function waitlistConfirmationEmail(ctx: EnrollmentEmailContext, position: number): Rendered {
  return {
    subject: `You're #${position} on the waitlist for ${ctx.className}`,
    html: wrap(
      `
      <h2 style="color:#334155">You're on the waitlist</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder] ${ctx.studentFirstName} is <strong>#${position}</strong> in line for
      <strong>${ctx.className}</strong>. If a spot opens, we'll email you a payment link —
      you'll have 48 hours to claim it.</p>
    `,
      { preheader: `[Placeholder preheader] You're #${position} in line for ${ctx.className}` }
    ),
  }
}

export function waitlistOfferEmail(
  ctx: EnrollmentEmailContext,
  claimUrl: string,
  expiresAt: string
): Rendered {
  const deadline = new Date(expiresAt).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  return {
    subject: `A spot opened in ${ctx.className} — 48 hours to claim it`,
    html: wrap(
      `
      <h2 style="color:#334155">Your spot is ready</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>[Placeholder] A spot just opened for ${ctx.studentFirstName} in
      <strong>${ctx.className}</strong> ($${ctx.price}).</p>
      <p><a href="${claimUrl}" style="display:inline-block;background:#00AEEE;color:#fff;
      font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">
      Claim the spot &amp; pay</a></p>
      <p>This offer expires <strong>${deadline}</strong>, after which it passes to the
      next family in line.</p>
    `,
      { preheader: `[Placeholder preheader] Claim ${ctx.studentFirstName}'s spot within 48 hours` }
    ),
  }
}

// ---------------------------------------------------------------------------
// Idempotent send
// ---------------------------------------------------------------------------

/**
 * Send an email exactly once per dedupe key.
 * Claims the email_log row first; if the claim conflicts, someone already
 * sent it. If the actual send fails, the claim is released so a retry
 * (webhook redelivery / next cron run) can try again.
 */
export async function sendOnce(opts: {
  dedupeKey: string
  emailType: string
  enrollmentId?: string
  sessionId?: string
  to: string[]
  cc?: string[]
  from?: string
  subject: string
  html: string
  payload?: Record<string, unknown>
}): Promise<'sent' | 'duplicate' | 'failed'> {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set — skipping email ${opts.dedupeKey}`)
    return 'failed'
  }

  const { error: claimError } = await supabase.from('email_log').insert([
    {
      dedupe_key: opts.dedupeKey,
      email_type: opts.emailType,
      enrollment_id: opts.enrollmentId ?? null,
      session_id: opts.sessionId ?? null,
      recipients: opts.to,
      payload: opts.payload ?? null,
    },
  ])

  if (claimError) {
    if (claimError.code === '23505') return 'duplicate' // unique violation: already sent
    console.error(`email_log claim failed for ${opts.dedupeKey}:`, claimError.message)
    return 'failed'
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error: sendError } = await resend.emails.send({
    from: opts.from ?? FROM,
    to: opts.to,
    cc: opts.cc,
    subject: opts.subject,
    html: opts.html,
  })

  if (sendError) {
    console.error(`Resend send failed for ${opts.dedupeKey}:`, sendError.message)
    await supabase.from('email_log').delete().eq('dedupe_key', opts.dedupeKey)
    return 'failed'
  }

  return 'sent'
}

/** Admin notification. Dedupe key still applies (e.g. one alert per class per day). */
export async function sendAdminAlert(opts: {
  dedupeKey: string
  adminEmail: string
  subject: string
  body: string
  enrollmentId?: string
}) {
  return sendOnce({
    dedupeKey: opts.dedupeKey,
    emailType: 'admin_alert',
    enrollmentId: opts.enrollmentId,
    to: [opts.adminEmail],
    subject: `[HGL Admin] ${opts.subject}`,
    html: wrap(`<h2 style="color:#334155">${opts.subject}</h2>${opts.body}`),
  })
}
