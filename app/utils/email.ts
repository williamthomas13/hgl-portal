import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

// Server-side only. Every send goes through sendOnce(), which claims a row in
// email_log first — Stripe webhook retries and cron re-runs never double-send.

const FROM = process.env.EMAIL_FROM ?? 'Higher Ground Learning <onboarding@resend.dev>'

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
  parentFirstName: string
  parentEmail: string
  studentFirstName: string
  studentEmail: string | null
  className: string // e.g. "Nido — SAT Prep"
  instructorName: string
  defaultLocation: string | null
  synapGroup: string | null
  startDate: string
  sessions: SessionInfo[]
}

function formatDate(iso: string) {
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

function sessionLine(s: SessionInfo, fallbackLocation: string | null) {
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
  const items = [...ctx.sessions]
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .map((s) => `<li style="margin-bottom:4px">${sessionLine(s, ctx.defaultLocation)}</li>`)
    .join('')
  return `<h3 style="color:#334155">Class schedule</h3><ul style="padding-left:20px">${items}</ul>`
}

function synapHtml(ctx: EnrollmentEmailContext) {
  if (!ctx.synapGroup) return ''
  return `
    <h3 style="color:#334155">Practice test access</h3>
    <p>Your class uses Synap for practice tests. You'll receive an invitation to the
    <strong>${ctx.synapGroup}</strong> group${ctx.studentEmail ? ` at ${ctx.studentEmail}` : ''}
    before the first session.</p>`
}

function wrap(body: string) {
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
    <div style="border-top:4px solid #00AEEE;padding:24px 8px">
      ${body}
      <p style="margin-top:32px;font-size:13px;color:#64748b">
        Higher Ground Learning · questions? Just reply to this email.
      </p>
    </div>
  </div>`
}

function recipients(ctx: EnrollmentEmailContext) {
  return ctx.studentEmail ? [ctx.parentEmail, ctx.studentEmail] : [ctx.parentEmail]
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function confirmationEmail(ctx: EnrollmentEmailContext) {
  return {
    subject: `You're registered: ${ctx.className}`,
    html: wrap(`
      <h2 style="color:#334155">Registration confirmed</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p><strong>${ctx.studentFirstName}</strong> is registered and paid for
      <strong>${ctx.className}</strong> with ${ctx.instructorName},
      starting ${formatDate(ctx.startDate)}.</p>
      ${scheduleHtml(ctx)}
      ${synapHtml(ctx)}
    `),
  }
}

export function classStartingEmail(ctx: EnrollmentEmailContext) {
  return {
    subject: `${ctx.className} starts ${formatDate(ctx.startDate)}`,
    html: wrap(`
      <h2 style="color:#334155">Class starts soon</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>A reminder that <strong>${ctx.className}</strong> for
      ${ctx.studentFirstName} begins on <strong>${formatDate(ctx.startDate)}</strong>.</p>
      ${scheduleHtml(ctx)}
      ${synapHtml(ctx)}
    `),
  }
}

export function sessionReminderEmail(ctx: EnrollmentEmailContext, session: SessionInfo) {
  return {
    subject: `Tomorrow: ${ctx.className}`,
    html: wrap(`
      <h2 style="color:#334155">Session reminder</h2>
      <p>Hi ${ctx.parentFirstName},</p>
      <p>${ctx.studentFirstName} has <strong>${ctx.className}</strong> tomorrow:</p>
      <p style="font-size:16px"><strong>${sessionLine(session, ctx.defaultLocation)}</strong></p>
    `),
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
  enrollmentId: string
  sessionId?: string
  to: string[]
  subject: string
  html: string
}): Promise<'sent' | 'duplicate' | 'failed'> {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set — skipping email ${opts.dedupeKey}`)
    return 'failed'
  }

  const { error: claimError } = await supabase.from('email_log').insert([
    {
      dedupe_key: opts.dedupeKey,
      email_type: opts.emailType,
      enrollment_id: opts.enrollmentId,
      session_id: opts.sessionId ?? null,
      recipients: opts.to,
    },
  ])

  if (claimError) {
    if (claimError.code === '23505') return 'duplicate' // unique violation: already sent
    console.error(`email_log claim failed for ${opts.dedupeKey}:`, claimError.message)
    return 'failed'
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error: sendError } = await resend.emails.send({
    from: FROM,
    to: opts.to,
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

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

/** Load everything the templates need for one enrollment. */
export async function loadEnrollmentContext(
  enrollmentId: string
): Promise<EnrollmentEmailContext | null> {
  const { data, error } = await supabase
    .from('enrollments')
    .select(
      `
      id,
      students (
        first_name,
        student_email,
        families ( parent_first_name, parent_email )
      ),
      classes (
        class_type,
        school_nickname,
        instructor_name,
        default_location,
        synap_group,
        start_date,
        schools ( nickname ),
        sessions ( id, session_date, start_time, end_time, location )
      )
    `
    )
    .eq('id', enrollmentId)
    .single()

  if (error || !data) {
    console.error(`Failed to load enrollment ${enrollmentId}:`, error?.message)
    return null
  }

  // Supabase types nested to-one relations as arrays; normalize.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const student = (Array.isArray(data.students) ? data.students[0] : data.students) as any
  const family = (Array.isArray(student?.families) ? student.families[0] : student?.families) as any
  const cls = (Array.isArray(data.classes) ? data.classes[0] : data.classes) as any
  const school = (Array.isArray(cls?.schools) ? cls.schools[0] : cls?.schools) as any
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (!student || !family || !cls) return null

  return {
    enrollmentId: data.id,
    parentFirstName: family.parent_first_name,
    parentEmail: family.parent_email,
    studentFirstName: student.first_name,
    studentEmail: student.student_email ?? null,
    className: `${school?.nickname ?? cls.school_nickname ?? 'HGL'} — ${cls.class_type}`,
    instructorName: cls.instructor_name,
    defaultLocation: cls.default_location ?? null,
    synapGroup: cls.synap_group ?? null,
    startDate: cls.start_date,
    sessions: cls.sessions ?? [],
  }
}

export { recipients }
