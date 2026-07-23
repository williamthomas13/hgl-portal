import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, wrap, footerT, type Rendered } from './email'
import { renderRegistered } from './comms-registered'

// PL-111 session-note reminders. Friendly cadence, hard backstop:
//   1. END-OF-DAY: one email per tutor listing that day's completed sessions
//      still missing their note (only sends when something IS missing).
//   2. ONE NUDGE 3 days later for anything still open.
//   3. Nothing further — the timecard approval gate is the backstop.
//
// "That day" is the Denver payroll calendar (same as timecards). The cron
// runs hourly: from 8pm Denver we remind about TODAY's sessions; before
// that, about YESTERDAY's (so a day is covered either late that evening or
// first thing next morning). sendOnce dedupe keys make both idempotent.

const PAYROLL_TZ = 'America/Denver'

const denverDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: PAYROLL_TZ })
const denverHour = (d: Date) =>
  Number(
    new Intl.DateTimeFormat('en-US', { timeZone: PAYROLL_TZ, hour: '2-digit', hour12: false }).format(d)
  ) % 24

const shiftDays = (dateIso: string, days: number) => {
  const d = new Date(dateIso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

type MissingSession = {
  id: string
  starts_at: string
  studentName: string
}

/** Completed sessions on one Denver date still missing a note, per tutor.
 *  Exported for the regression harness. */
export async function missingByTutor(dateIso: string): Promise<Map<string, MissingSession[]>> {
  // Pad a day each side in UTC, then filter to the exact Denver date.
  const from = new Date(shiftDays(dateIso, -1) + 'T00:00:00Z').toISOString()
  const to = new Date(shiftDays(dateIso, 2) + 'T00:00:00Z').toISOString()
  const { data: sessions } = await supabase
    .from('tutoring_sessions')
    .select('id, tutor_id, starts_at, students ( first_name, last_name )')
    .eq('status', 'completed')
    .gte('starts_at', from)
    .lt('starts_at', to)
  const onDate = (sessions ?? []).filter((s) => denverDate(new Date(s.starts_at)) === dateIso)
  if (onDate.length === 0) return new Map()
  const { data: notes } = await supabase
    .from('session_notes')
    .select('session_id')
    .in('session_id', onDate.map((s) => s.id))
  const noted = new Set((notes ?? []).map((n) => n.session_id))
  const out = new Map<string, MissingSession[]>()
  for (const s of onDate) {
    if (noted.has(s.id)) continue
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const st: any = Array.isArray(s.students) ? s.students[0] : s.students
    const list = out.get(s.tutor_id) ?? []
    list.push({
      id: s.id,
      starts_at: s.starts_at,
      studentName: st ? `${st.first_name} ${st.last_name}` : 'your student',
    })
    out.set(s.tutor_id, list)
  }
  return out
}

async function sendReminder(opts: {
  kind: 'eod' | 'nudge'
  tutorId: string
  dateIso: string
  sessions: MissingSession[]
}): Promise<boolean> {
  const { data: tutor } = await supabase
    .from('instructors')
    .select('email, name, timezone')
    .eq('id', opts.tutorId)
    .maybeSingle()
  if (!tutor?.email) return false
  const tz = tutor.timezone ?? PAYROLL_TZ
  const first = tutor.name?.split(' ')[0] ?? 'there'
  const base = emailBaseUrl()
  const notesLink = `${base}/portal?view=tutor`
  const dateLabel = new Date(opts.dateIso + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const lines = opts.sessions
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map(
      (s) =>
        `${new Date(s.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })} — ${s.studentName}`
    )
  const listHtml = `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`
  const isEod = opts.kind === 'eod'

  const codeTwin = (): Rendered => ({
    subject: isEod
      ? `Quick one — session notes for ${dateLabel}`
      : `Still open — session notes from ${dateLabel}`,
    html: wrap(
      `<h2 style="color:#334155">${isEod ? 'Session notes' : 'Session notes — one more reminder'} — ${dateLabel}</h2>
       <p>Hi ${first},</p>
       <p>${
         isEod
           ? 'These sessions are still missing their short session note — a line or two on what you worked on (and, if useful, what to pick up next time):'
           : `These sessions from ${dateLabel} still don't have a session note:`
       }</p>
       ${listHtml}
       <p><a href="${notesLink}">Add your notes →</a></p>
       <p style="color:#64748b;font-size:13px">Families can read these notes on their family portal,
       so keep them parent-friendly. ${
         isEod
           ? 'If you just added them, you are all set — this is the only reminder today.'
           : 'This is the last automatic reminder — anything still open will show when your timecard is reviewed, and approval waits for it.'
       }</p>`,
      { preheader: `${lines.length} session${lines.length === 1 ? '' : 's'} from ${dateLabel}`, footer: footerT() }
    ),
  })
  const email = await renderRegistered(
    isEod ? 'T6_NOTES_EOD' : 'T6_NOTES_NUDGE',
    { parentFirstName: first, parentEmail: tutor.email },
    {
      tutorFirstName: first,
      sessionDate: dateLabel,
      missingSessionsBlock: lines.join('\n'),
      notesLink,
    },
    codeTwin
  )
  const status = await sendOnce({
    dedupeKey: `t6_notes_${opts.kind}:${opts.tutorId}:${opts.dateIso}`,
    emailType: isEod ? 'T6_NOTES_EOD' : 'T6_NOTES_NUDGE',
    templateKey: isEod ? 'T6_NOTES_EOD' : 'T6_NOTES_NUDGE',
    to: [tutor.email],
    subject: email.subject,
    html: email.html,
  })
  return status === 'sent'
}

export type NoteReminderResult = { eod: number; nudge: number }

export async function sweepSessionNoteReminders(now: Date = new Date()): Promise<NoteReminderResult> {
  const result: NoteReminderResult = { eod: 0, nudge: 0 }
  try {
    const today = denverDate(now)
    const targetDate = denverHour(now) >= 20 ? today : shiftDays(today, -1)

    const eodMissing = await missingByTutor(targetDate)
    for (const [tutorId, sessions] of eodMissing) {
      if (await sendReminder({ kind: 'eod', tutorId, dateIso: targetDate, sessions })) result.eod++
    }

    const nudgeDate = shiftDays(targetDate, -3)
    const nudgeMissing = await missingByTutor(nudgeDate)
    for (const [tutorId, sessions] of nudgeMissing) {
      if (await sendReminder({ kind: 'nudge', tutorId, dateIso: nudgeDate, sessions })) result.nudge++
    }
    return result
  } catch (e) {
    console.error('sweepSessionNoteReminders crashed:', e)
    return result
  }
}
