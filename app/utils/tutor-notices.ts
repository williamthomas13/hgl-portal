import { supabaseAdmin as supabase } from './supabase-admin'
import { renderRegistered } from './comms-registered'
import { sendOnce, wrap, footerT, type Rendered } from './email'

// PL-81: T3-T stays mandatory (Google Calendar never notifies the tutor —
// events live on their own calendar, edited by the delegated service
// account; sendUpdates only applies to attendees, and there are none). The
// failure mode Scarlett identified is FATIGUE: five changes in an afternoon
// = five emails = a tutor who stops reading them. So the tutor email
// coalesces per tutor:
//
//   · a change arms (or slides) ONE pending notice — send_after = now + 45
//     min, capped at first_change_at + 3 h, delivered by the hourly sweep
//     plus an inline due-pass at record time;
//   · URGENCY OVERRIDE: any change touching a session that starts within
//     the next 24 h (original OR new time) sends immediately, folding in
//     whatever else is pending — a noon change to a 2:00 PM session can
//     never sit in a queue;
//   · every notice leads with each affected student's CURRENT upcoming
//     schedule (reading any single notice leaves the tutor with the correct
//     picture), deltas below, subject scaled to the change count.
//
// The parent T3 and the calendar update stay instant and unconditional —
// only the tutor email coalesces.

const WINDOW_MS = 45 * 60_000
const CAP_MS = 3 * 3_600_000
const URGENT_MS = 24 * 3_600_000

export type TutorChange = {
  sessionId: string
  kind: 'reschedule' | 'forfeited' | 'no_show'
  notice?: 'ok' | 'late'
  /** PL-85: a reschedule's replacement session id — chains a later change to
   *  this one so the notice can collapse to the net effect. */
  replacementId?: string | null
  studentId: string
  studentFirst: string
  subjectName: string
  oldStartsAt: string
  newStartsAt: string | null
  recordedAt: string
}

type PendingRow = {
  id: string
  tutor_id: string
  changes: TutorChange[]
  first_change_at: string
  send_after: string
  status: string
}

const startsWithin24h = (iso: string | null | undefined, now: number) => {
  if (!iso) return false
  const delta = new Date(iso).getTime() - now
  return delta >= 0 && delta <= URGENT_MS
}

/** Record a session change for the tutor's coalesced notice. Called from the
 *  T3 dispatch in place of the old immediate send; never throws (the change
 *  itself always stands). */
export async function recordTutorScheduleChange(opts: {
  tutorId: string
  change: TutorChange
}): Promise<'pending' | 'sent_urgent' | 'sent_due' | 'failed'> {
  try {
    const now = Date.now()
    const urgent =
      startsWithin24h(opts.change.oldStartsAt, now) || startsWithin24h(opts.change.newStartsAt, now)

    let row = await foldIntoPending(opts.tutorId, opts.change)
    if (!row) {
      // Lost the unique-index race: the concurrent recorder created the row —
      // fold again (it exists now).
      row = await foldIntoPending(opts.tutorId, opts.change)
    }
    if (!row) return 'failed'

    if (urgent) {
      await deliverPendingTutorNotice(row.id)
      return 'sent_urgent'
    }
    // Inline due-pass (PL-51 pattern): if the cap already expired — a long
    // churn where the hourly sweep hasn't ticked yet — deliver now.
    if (new Date(row.send_after).getTime() <= now) {
      await deliverPendingTutorNotice(row.id)
      return 'sent_due'
    }
    return 'pending'
  } catch (e) {
    console.error('tutor notice record failed (change stands; sweep may miss ONE email):', e)
    return 'failed'
  }
}

/** Append to the tutor's open batch (sliding the timer, capped), or open a
 *  new one. Returns null only on the insert race. */
async function foldIntoPending(tutorId: string, change: TutorChange): Promise<PendingRow | null> {
  const now = Date.now()
  const { data: existing } = await supabase
    .from('tutor_pending_notices')
    .select('id, tutor_id, changes, first_change_at, send_after, status')
    .eq('tutor_id', tutorId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    const cap = new Date(existing.first_change_at).getTime() + CAP_MS
    const sendAfter = new Date(Math.min(now + WINDOW_MS, cap)).toISOString()
    const changes = [...(existing.changes as TutorChange[]), change]
    const { data: updated } = await supabase
      .from('tutor_pending_notices')
      .update({ changes, send_after: sendAfter, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('status', 'pending')
      .select('id, tutor_id, changes, first_change_at, send_after, status')
      .maybeSingle()
    // If the sweep claimed it mid-fold, open a fresh batch for this change.
    return (updated as PendingRow | null) ?? (await openPending(tutorId, change))
  }
  return openPending(tutorId, change)
}

async function openPending(tutorId: string, change: TutorChange): Promise<PendingRow | null> {
  const { data, error } = await supabase
    .from('tutor_pending_notices')
    .insert({
      tutor_id: tutorId,
      changes: [change],
      first_change_at: new Date().toISOString(),
      send_after: new Date(Date.now() + WINDOW_MS).toISOString(),
    })
    .select('id, tutor_id, changes, first_change_at, send_after, status')
    .maybeSingle()
  if (error) return null // 23505 unique race — caller refetches and folds
  return data as PendingRow | null
}

/** Hourly cron pass: deliver every due pending notice. */
export async function sweepPendingTutorNotices(): Promise<number> {
  const { data: due } = await supabase
    .from('tutor_pending_notices')
    .select('id')
    .eq('status', 'pending')
    .lte('send_after', new Date().toISOString())
  let sent = 0
  for (const row of due ?? []) {
    try {
      if (await deliverPendingTutorNotice(row.id)) sent++
    } catch (e) {
      console.error(`tutor notice delivery failed for ${row.id} (next sweep retries):`, e)
    }
  }
  return sent
}

/** Claim + compose + send one pending notice. Safe against the cron/inline
 *  race: the guarded claim makes the loser a no-op, and the dedupe key
 *  (row id + change count) backstops a claim that reverted after a send. */
export async function deliverPendingTutorNotice(rowId: string): Promise<boolean> {
  const { data: claimed } = await supabase
    .from('tutor_pending_notices')
    .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', rowId)
    .eq('status', 'pending')
    .select('id, tutor_id, changes, first_change_at, send_after, status')
    .maybeSingle()
  if (!claimed) return false
  const row = claimed as PendingRow

  try {
    const { data: tutor } = await supabase
      .from('instructors')
      .select('id, name, email, timezone')
      .eq('id', row.tutor_id)
      .maybeSingle()
    if (!tutor?.email) return false // no address — nothing to deliver

    const changes = row.changes as TutorChange[]
    const email = await composeTutorNotice(tutor, changes)
    if (!email) {
      // PL-85: the batch netted to nothing (round trips only) — no email.
      // The row is marked cancelled so the audit trail says why nothing sent.
      await supabase
        .from('tutor_pending_notices')
        .update({ status: 'cancelled', sent_at: null, updated_at: new Date().toISOString() })
        .eq('id', rowId)
        .eq('status', 'sent')
      return false
    }
    const status = await sendOnce({
      dedupeKey: `t3_tutor_batch:${row.id}:${changes.length}`,
      emailType: 'tutor_schedule_notice',
      templateKey: 'T3_TUTOR_NOTICE',
      to: [tutor.email],
      subject: email.subject,
      html: email.html,
    })
    if (status === 'sent' || status === 'duplicate') return status === 'sent'
    // PL-120: sendOnce reports failure by RETURN VALUE ('failed' /
    // 'suppressed'), not by throwing — without this branch the claimed row
    // stayed 'sent' forever and the notice was lost, not "one sweep late".
    // Un-claim exactly like the catch path so the next sweep retries.
    await supabase
      .from('tutor_pending_notices')
      .update({ status: 'pending', sent_at: null, updated_at: new Date().toISOString() })
      .eq('id', rowId)
      .eq('status', 'sent')
    return false
  } catch (e) {
    // Un-claim so the next sweep retries; sendOnce's dedupe absorbs the case
    // where the send actually landed before the failure.
    await supabase
      .from('tutor_pending_notices')
      .update({ status: 'pending', sent_at: null, updated_at: new Date().toISOString() })
      .eq('id', rowId)
      .eq('status', 'sent')
    throw e
  }
}

// ---------------------------------------------------------------------------
// Compose — (b) current truth first, deltas below · (c) subject scales ·
// (d) the "worth a quick glance" line.
// ---------------------------------------------------------------------------

const uniq = <T,>(xs: T[]) => [...new Set(xs)]

function tzFormats(tz: string) {
  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  const date = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
  const time = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  return { dateTime, date, time }
}

// PL-85: the "What changed" list shows each SESSION once — original state
// (as of the window's first change, what the tutor last knew) → final state.
// A move chain (Mon→Tue→Thu) is one "moved to Thu" line; moved-then-
// cancelled is one cancelled line; a round trip (moved away and back)
// produces NO line, and a batch that nets to nothing sends no email.
// No-show marks are terminal states of their own session's chain and never
// merge with time changes on other sessions.
export type CollapsedDelta = {
  kind: 'reschedule' | 'forfeited' | 'no_show'
  studentId: string
  studentFirst: string
  subjectName: string
  /** State as of the window's first change touching this chain. */
  originalStartsAt: string
  /** Final time for surviving reschedules; null for terminal states. */
  finalStartsAt: string | null
}

export function collapseChanges(changes: TutorChange[]): CollapsedDelta[] {
  type Chain = CollapsedDelta & { currentId: string; terminal: boolean }
  const ordered = [...changes].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  const byCurrentId = new Map<string, Chain>()
  const chains: Chain[] = []
  for (const c of ordered) {
    let chain = byCurrentId.get(c.sessionId)
    if (!chain) {
      chain = {
        kind: c.kind,
        studentId: c.studentId,
        studentFirst: c.studentFirst,
        subjectName: c.subjectName,
        originalStartsAt: c.oldStartsAt,
        finalStartsAt: null,
        currentId: c.sessionId,
        terminal: false,
      }
      chains.push(chain)
    }
    if (chain.terminal) continue // late duplicate after a terminal mark — ignore
    byCurrentId.delete(chain.currentId)
    chain.kind = c.kind
    if (c.kind === 'reschedule') {
      chain.finalStartsAt = c.newStartsAt
      chain.currentId = c.replacementId ?? c.sessionId
    } else {
      chain.finalStartsAt = null
      chain.terminal = true
    }
    byCurrentId.set(chain.currentId, chain)
  }
  return chains
    .filter((ch) => {
      // Round trip: a surviving reschedule whose final time equals the
      // original disappears entirely.
      if (ch.kind === 'reschedule' && ch.finalStartsAt) {
        return new Date(ch.finalStartsAt).getTime() !== new Date(ch.originalStartsAt).getTime()
      }
      return true
    })
    .map(({ currentId: _c, terminal: _t, ...delta }) => delta)
}

export function changeDeltaLine(c: CollapsedDelta, fmt: (iso: string) => string): string {
  const who = `${c.studentFirst}'s ${c.subjectName} session`
  if (c.kind === 'reschedule') {
    return `${who} on <strong>${fmt(c.originalStartsAt)}</strong> moved to <strong>${c.finalStartsAt ? fmt(c.finalStartsAt) : 'a new time'}</strong>.`
  }
  if (c.kind === 'no_show') {
    return `${who} on <strong>${fmt(c.originalStartsAt)}</strong> was a no-show.`
  }
  return `${who} on <strong>${fmt(c.originalStartsAt)}</strong> was cancelled — you're still paid for the reserved slot (it stays on your calendar, XCL-marked).`
}

/** Exported for the regression/E2E scripts — production callers go through
 *  deliverPendingTutorNotice. PL-85: returns null when the batch collapses
 *  to nothing (round trips only). */
export async function composeTutorNotice(
  tutor: { id: string; name: string | null; email: string; timezone: string | null },
  changes: TutorChange[]
): Promise<Rendered | null> {
  const tz = tutor.timezone ?? 'America/Denver'
  const { dateTime, date, time } = tzFormats(tz)
  const nowIso = new Date().toISOString()

  // PL-85: one line per session — original → net effect; round trips vanish.
  const deltas = collapseChanges(changes)
  if (deltas.length === 0) return null

  // (b) lead with the CURRENT upcoming schedule for each affected student —
  // queried at send time, so even a notice read after ignoring three others
  // carries the correct picture.
  const students = uniq(deltas.map((c) => c.studentId))
  const nameFor = new Map(deltas.map((c) => [c.studentId, c.studentFirst]))
  const subjectFor = new Map(deltas.map((c) => [c.studentId, c.subjectName]))
  const scheduleSections: string[] = []
  for (const studentId of students) {
    const { data: upcoming } = await supabase
      .from('tutoring_sessions')
      .select('starts_at, ends_at')
      .eq('tutor_id', tutor.id)
      .eq('student_id', studentId)
      .eq('status', 'confirmed')
      .gte('starts_at', nowIso)
      .order('starts_at')
      .limit(12)
    const lines = (upcoming ?? []).map(
      (s) =>
        `<li style="margin:2px 0">${date(s.starts_at)} · ${time(s.starts_at)}${s.ends_at ? `–${time(s.ends_at)}` : ''}</li>`
    )
    scheduleSections.push(
      `<h3 style="color:#334155;margin:18px 0 6px">${nameFor.get(studentId)} — ${subjectFor.get(studentId)} · upcoming sessions</h3>` +
        (lines.length > 0
          ? `<ul style="margin:0;padding-left:20px;color:#334155">${lines.join('')}</ul>`
          : `<p style="margin:0;color:#64748b">No upcoming sessions on the books.</p>`)
    )
  }
  const tutorScheduleBlock = scheduleSections.join('')

  const deltaLines = deltas.map((c) => `<li style="margin:2px 0">${changeDeltaLine(c, dateTime)}</li>`)
  const tutorChangeBlock =
    `<p style="margin:16px 0 6px"><strong>What changed:</strong></p>` +
    `<ul style="margin:0;padding-left:20px;color:#334155">${deltaLines.join('')}</ul>`

  // (c) subject scales with severity — counted AFTER collapsing (PL-85).
  const countPhrase = deltas.length === 1 ? 'Schedule change' : `${deltas.length} schedule changes`
  const studentNames = uniq(deltas.map((c) => c.studentFirst)).join(' & ')
  const subjectNames = uniq(deltas.map((c) => c.subjectName)).join(' & ')

  const glanceLine =
    'Worth a quick glance even if you live in your calendar — your Google Calendar is already updated, but this email is the recap of what moved.'

  return renderRegistered(
    'T3_TUTOR_NOTICE',
    {
      parentFirstName: tutor.name?.split(' ')[0] ?? 'there',
      parentEmail: tutor.email,
      studentFirstName: changes[0].studentFirst,
    },
    {
      tutoringSubject: subjectNames,
      studentNames,
      scheduleChangeCountPhrase: countPhrase,
      tutorScheduleBlock,
      tutorChangeBlock,
    },
    // Code twin — mirrors the registry render (## → h3, paragraphs plain).
    () => ({
      subject: `${countPhrase}: ${studentNames} — ${subjectNames}`,
      html: wrap(
        `<h3 style="color:#334155">${countPhrase}</h3>
${tutorScheduleBlock}
${tutorChangeBlock}
<p>${glanceLine}</p>`,
        { preheader: 'Your Google Calendar is already updated — this is the recap of what moved.', footer: footerT() }
      ),
    })
  )
}
