import { supabaseAdmin as supabase } from './supabase-admin'
import { emailBaseUrl } from './base-url'
import { sendOnce, sendAdminAlert, wrap, footerT, type Rendered } from './email'
import { renderRegistered } from './comms-registered'
import { renderMarkdownBody } from './comms-md'
import { formatTimeRange } from './dates'
import { loadTutoringPackages, studentTutoringTier } from './lifecycle'
import { generateOccurrences, horizonEndIso, addDaysIso } from './tutoring'
import { loadGcalConnection, deleteGcalEvent, freeBusy } from './gcal'
import { enqueueGcalSync, processGcalQueue } from './gcal-sync'

// PL-299 → PL-323: hours-block exhaustion — the FAMILY chooses what happens
// BEFORE the block runs out (her business model: blocks are only sold as
// group-class add-ons; what follows must be opted into, never discovered on
// an invoice).
//
// State machine (tutoring_engagements.block_confirmation):
//   null      — pre-flow. Legacy engagements keep PL-197 behavior exactly.
//   asked     — the threshold email went out. Scheduling past the block
//               refuses, generation never writes overflow lines, and — PL-323A
//               — at exhaustion the remaining future sessions actually DROP
//               off tutor calendars (auto-drop is the default).
//   confirmed — the family CHOSE (PL-323B): 5/10/15 more hours (a
//               continuation at the provenance-correct post-class rate) or
//               "until I cancel" (the standard monthly plan). A finite
//               continuation re-asks when IT nears its end (block_ask_cycle) —
//               continue is a choice, never perpetuity.
//   declined  — sessions stop when the hours do; overflow never bills; the
//               auto-drop clears anything scheduled past the block.
//
// NO tokenized link (explicit): confirmation is the signed-in portal control
// or a reply recorded by the admin mirror action.

/** Threshold by block size: 15h→3h left · 10h→2h · 5h→1h · other sizes →
 *  20% rounded up (e.g. 8h→2h, 20h→4h). */
export function blockThreshold(blockHours: number): number {
  if (blockHours === 15) return 3
  if (blockHours === 10) return 2
  if (blockHours === 5) return 1
  return Math.max(0.5, Math.ceil(blockHours * 0.2))
}

/** The consent gate: scheduling/billing past the block holds in these
 *  states. Null (pre-flow) and confirmed do NOT hold. */
export function blockHoldActive(blockConfirmation: string | null): boolean {
  return blockConfirmation === 'asked' || blockConfirmation === 'declined'
}

/* eslint-disable @typescript-eslint/no-explicit-any */

type BlockEngagement = {
  id: string
  addonId: string
  studentId: string
  tutorId: string
  blockHours: number
  /** PL-323: purchased block + any confirmed continuation hours. */
  effectiveHours: number
  continueHours: number | null
  askCycle: number
  droppedAt: string | null
  usedHours: number
  remainingHours: number
  hourlyRate: number
  blockConfirmation: string | null
  recurrence: { weekday: number; start_time: string; duration_minutes: number }[]
  studentFirstName: string
  parentFirstName: string
  parentEmail: string | null
  familyId: string
  tutorName: string
  tutorEmail: string | null
  tutorCalendarId: string | null
  tutorTimezone: string
}

/** Every ACTIVE block-funded engagement with its drawdown (the PL-197
 *  consuming rule: rescheduled counts only when late). */
export async function loadBlockEngagements(): Promise<BlockEngagement[]> {
  const { data: engs } = await supabase
    .from('tutoring_engagements')
    .select(
      `id, addon_id, student_id, tutor_id, hourly_rate, status, recurrence,
       block_confirmation, block_continue_hours, block_ask_cycle, block_dropped_at,
       students!inner ( first_name, family_id, families!inner ( id, parent_first_name, parent_email ) ),
       instructors!tutoring_engagements_tutor_id_fkey ( name, email, google_calendar_id, timezone ),
       enrollment_addons!tutoring_engagements_addon_id_fkey ( id, hours )`
    )
    .eq('status', 'active')
    .not('addon_id', 'is', null)
  const out: BlockEngagement[] = []
  for (const e of ((engs as any[]) ?? [])) {
    const addon = Array.isArray(e.enrollment_addons) ? e.enrollment_addons[0] : e.enrollment_addons
    const student = Array.isArray(e.students) ? e.students[0] : e.students
    const family = Array.isArray(student?.families) ? student.families[0] : student?.families
    const tutor = Array.isArray(e.instructors) ? e.instructors[0] : e.instructors
    const blockHours = Number(addon?.hours ?? 0)
    if (!(blockHours > 0) || !student || !family) continue
    const { data: consuming } = await supabase
      .from('tutoring_sessions')
      .select('duration_minutes, status, reschedule_notice')
      .eq('engagement_id', e.id)
      .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
    const used = ((consuming as any[]) ?? [])
      .filter((s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late')
      .reduce((sum, s) => sum + s.duration_minutes / 60, 0)
    const continueHours = e.block_continue_hours != null ? Number(e.block_continue_hours) : null
    const effectiveHours = blockHours + (continueHours ?? 0)
    out.push({
      id: e.id,
      addonId: e.addon_id,
      studentId: e.student_id,
      tutorId: e.tutor_id,
      blockHours,
      effectiveHours,
      continueHours,
      askCycle: Number(e.block_ask_cycle ?? 0),
      droppedAt: e.block_dropped_at ?? null,
      usedHours: Number(used.toFixed(1)),
      remainingHours: Number(Math.max(0, effectiveHours - used).toFixed(1)),
      hourlyRate: Number(e.hourly_rate),
      blockConfirmation: e.block_confirmation ?? null,
      recurrence: Array.isArray(e.recurrence) ? e.recurrence : [],
      studentFirstName: student.first_name,
      parentFirstName: family.parent_first_name,
      parentEmail: family.parent_email ?? null,
      familyId: family.id,
      tutorName: tutor?.name ?? 'their tutor',
      tutorEmail: tutor?.email ?? null,
      tutorCalendarId: tutor?.google_calendar_id ?? null,
      tutorTimezone: tutor?.timezone ?? 'America/Denver',
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// PL-322/PL-323D: the CONTINUING rates follow the student's provenance —
// one source with the price list (post-class sheet for their tier).
// ---------------------------------------------------------------------------

export type ContinueRates = { rate1to9: number; rate10plus: number }

export async function continueRatesForStudent(studentId: string): Promise<ContinueRates> {
  const tier = await studentTutoringTier(studentId)
  const { post } = await loadTutoringPackages(tier)
  const small = post.find((p) => p.hours < 10)
  const large = post.find((p) => p.hours >= 10)
  // The sheets always carry both rows; a missing row falls back sanely.
  return {
    rate1to9: small?.hourlyRate ?? large?.hourlyRate ?? 0,
    rate10plus: large?.hourlyRate ?? small?.hourlyRate ?? 0,
  }
}

export type ContinueChoice = '5' | '10' | '15' | 'monthly'

export function rateForChoice(choice: ContinueChoice, rates: ContinueRates): number {
  return choice === '10' || choice === '15' ? rates.rate10plus : rates.rate1to9
}

// ---------------------------------------------------------------------------
// The BL_BLOCK_CONFIRM code twin — Scarlett's PL-323E copy, rendered through
// the same comms-md pipeline the DB template uses (one copy shape).
// ---------------------------------------------------------------------------

function blockConfirmMarkdown(v: {
  parentFirstName: string
  studentFirstName: string
  blockHoursLeft: string
  blockHours: string
  tutoringHourlyRate: string
  studentTutorName: string
  portalLink: string
}): string {
  return `Hi ${v.parentFirstName},

A quick heads-up: ${v.studentFirstName} has **${v.blockHoursLeft} left of the ${v.blockHours} tutoring hours** you purchased.

When those hours are used up, tutoring can continue on our standard 1-on-1 plan — same tutor, same schedule — billed monthly at **${v.tutoringHourlyRate}/hr**.

**Please confirm if you'd like to continue**: open your family portal (no password needed) and use the "Continue tutoring" button (or just reply to this email) and we'll keep the times reserved for ${v.studentFirstName}. If you're not sure what makes the most sense, please respond to this message; we'll get all the info from ${v.studentTutorName} and make an action plan.

[button:Open your family portal](${v.portalLink})

If we don't hear from you, nothing bills past the hours you purchased — the sessions simply stop when your prepaid hours are gone.

Thanks!

Higher Ground Learning`
}

function blockConfirmEmail(e: BlockEngagement, continuingRate: number): Rendered {
  const base = emailBaseUrl()
  return {
    subject: `${e.studentFirstName}'s tutoring hours are almost used up — one quick confirmation`,
    html: wrap(
      renderMarkdownBody(
        blockConfirmMarkdown({
          parentFirstName: e.parentFirstName,
          studentFirstName: e.studentFirstName,
          blockHoursLeft: String(e.remainingHours),
          blockHours: String(e.effectiveHours),
          tutoringHourlyRate: `$${continuingRate}`,
          studentTutorName: e.tutorName,
          portalLink: `${base}/portal`,
        }),
        {}
      ),
      {
        preheader: `${e.remainingHours} of ${e.effectiveHours} hours left — confirm to continue`,
        footer: footerT(),
      }
    ),
  }
}

export type BlockSweepResult = { asked: number; reasked: number; dropped: number }

/** The hourly-sweep leg. Three jobs:
 *  1. ask — at/below the threshold with no decision on record, ask once.
 *  2. re-ask (PL-323B) — a confirmed FINITE continuation nearing its own end
 *     asks again (cycle counter rides the dedupe key). "Until I cancel"
 *     (continueHours null) never re-asks.
 *  3. auto-drop (PL-323A) — an exhausted block with no confirmation releases
 *     the remaining future sessions off tutor calendars. */
export async function sweepBlockConfirmations(): Promise<BlockSweepResult> {
  const result: BlockSweepResult = { asked: 0, reasked: 0, dropped: 0 }
  const engagements = await loadBlockEngagements()
  for (const e of engagements) {
    // --- 3. auto-drop: asked/declined + exhausted → release future sessions.
    if (blockHoldActive(e.blockConfirmation) && !e.droppedAt && e.usedHours >= e.effectiveHours - 0.05) {
      const dropped = await dropSessionsPastBlock(e)
      if (dropped >= 0) result.dropped += dropped
      continue
    }

    // --- 2. re-ask: a finite continuation nearing its own end.
    if (
      e.blockConfirmation === 'confirmed' &&
      e.continueHours != null &&
      e.remainingHours <= blockThreshold(e.continueHours) &&
      e.usedHours <= e.effectiveHours + 0.05
    ) {
      const nextCycle = e.askCycle + 1
      const sent = await sendAsk(e, `block_confirm_ask:${e.id}:c${nextCycle}`)
      if (sent) {
        await supabase
          .from('tutoring_engagements')
          .update({
            block_confirmation: 'asked',
            block_confirmation_asked_at: new Date().toISOString(),
            block_ask_cycle: nextCycle,
          })
          .eq('id', e.id)
          .eq('block_confirmation', 'confirmed')
        result.reasked++
      }
      continue
    }

    // --- 1. first ask.
    if (e.blockConfirmation !== null) continue
    if (e.remainingHours > blockThreshold(e.blockHours)) continue
    // Already past the block when this shipped = the LEGACY case (PL-197
    // ack flow + Case-A billing keep working; Roman's 24/15 carry must not
    // freeze behind a hold). The ask is only meaningful BEFORE exhaustion.
    if (e.usedHours > e.effectiveHours + 0.05) continue
    if (!e.parentEmail) continue
    const sent = await sendAsk(e, `block_confirm_ask:${e.id}`)
    if (sent) {
      await supabase
        .from('tutoring_engagements')
        .update({ block_confirmation: 'asked', block_confirmation_asked_at: new Date().toISOString() })
        .eq('id', e.id)
        .is('block_confirmation', null)
      result.asked++
    }
  }
  return result
}

/** Render + send one ask (registry template with the code twin as fallback).
 *  Returns true when the send claimed (sent) — 'duplicate' flips state but
 *  doesn't count. */
async function sendAsk(e: BlockEngagement, dedupeKey: string): Promise<boolean> {
  if (!e.parentEmail) return false
  // PL-323D: the quoted continuing rate follows provenance (the monthly /
  // 1–9h post-class rate — volume discounts are what the 5/10/15 buttons buy).
  const rates = await continueRatesForStudent(e.studentId)
  const continuingRate = rates.rate1to9
  const email = await renderRegistered(
    'BL_BLOCK_CONFIRM',
    { parentFirstName: e.parentFirstName, parentEmail: e.parentEmail, studentFirstName: e.studentFirstName },
    {
      blockHoursLeft: String(e.remainingHours),
      blockHours: String(e.effectiveHours),
      tutoringHourlyRate: `$${continuingRate}`,
      studentTutorName: e.tutorName,
    },
    () => blockConfirmEmail(e, continuingRate)
  )
  const status = await sendOnce({
    dedupeKey,
    emailType: 'BL_BLOCK_CONFIRM',
    templateKey: 'BL_BLOCK_CONFIRM',
    to: [e.parentEmail],
    subject: email.subject,
    html: email.html,
    bodySnapshotId: email.versionId,
  })
  return status === 'sent'
}

// ---------------------------------------------------------------------------
// PL-323A: auto-drop. Walk the engagement's consuming history the same way
// billing does (chronological, hours walk down from the effective block);
// future sessions the block does NOT cover get released — Google event
// deleted, row deleted (unbilled rows only; a billed row never vanishes).
// ---------------------------------------------------------------------------

async function dropSessionsPastBlock(e: BlockEngagement): Promise<number> {
  const { data: rows } = await supabase
    .from('tutoring_sessions')
    .select('id, starts_at, duration_minutes, status, reschedule_notice, gcal_event_id, invoice_id')
    .eq('engagement_id', e.id)
    .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
    .order('starts_at')
  const sessions = ((rows as any[]) ?? []).filter(
    (s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late'
  )
  let running = e.effectiveHours
  const nowMs = Date.now()
  const toDrop: { id: string; gcal_event_id: string | null }[] = []
  for (const s of sessions) {
    const h = s.duration_minutes / 60
    if (running >= h - 1e-9) {
      running -= h
      continue
    }
    // Not covered. Only FUTURE, unbilled, still-scheduled rows drop — the
    // billing holds already keep past uncovered ones from ever billing.
    if (
      new Date(s.starts_at).getTime() > nowMs &&
      !s.invoice_id &&
      (s.status === 'confirmed' || s.status === 'proposed')
    ) {
      toDrop.push({ id: s.id, gcal_event_id: s.gcal_event_id })
    }
  }

  // Stamp FIRST (idempotence: a crash mid-drop must not re-run forever).
  await supabase
    .from('tutoring_engagements')
    .update({ block_dropped_at: new Date().toISOString() })
    .eq('id', e.id)
    .is('block_dropped_at', null)

  if (toDrop.length === 0) return 0

  // Google events go first — deleting the row would orphan them.
  try {
    const conn = await loadGcalConnection()
    if (conn?.status === 'connected' && conn.key && e.tutorEmail) {
      for (const s of toDrop) {
        if (!s.gcal_event_id) continue
        try {
          await deleteGcalEvent(conn.key, e.tutorEmail, e.tutorCalendarId, s.gcal_event_id)
        } catch (err) {
          console.error(`block-drop gcal delete failed for session ${s.id} (row still drops):`, err)
        }
      }
    }
  } catch (err) {
    console.error('block-drop gcal connection failed (rows still drop):', err)
  }

  await supabase
    .from('tutoring_sessions')
    .delete()
    .in('id', toDrop.map((s) => s.id))

  return toDrop.length
}

// ---------------------------------------------------------------------------
// PL-323B/C: the family's decision — now a CHOICE — plus the reservation.
// ---------------------------------------------------------------------------

export type DecisionResult =
  | { ok: true; outcome: 'declined' }
  | { ok: true; outcome: 'reserved'; sessions: string[] }
  | { ok: true; outcome: 'staff' }
  | { ok: false; error: string }

/** Record the family's decision — from the signed-in portal ('portal') or
 *  the admin mirror action ('admin', for phone/email confirmations).
 *  choice is required with 'confirmed' (5/10/15 hours or 'monthly'). */
export async function recordBlockDecision(
  engagementId: string,
  decision: 'confirmed' | 'declined',
  via: 'portal' | 'admin',
  choice?: ContinueChoice
): Promise<DecisionResult> {
  const engs = await loadBlockEngagements()
  const e = engs.find((x) => x.id === engagementId)
  if (!e || !['asked', 'confirmed', 'declined'].includes(e.blockConfirmation ?? '')) {
    return { ok: false, error: "This engagement hasn't been asked yet — the low-hours email goes out first." }
  }

  if (decision === 'declined') {
    const { error } = await supabase
      .from('tutoring_engagements')
      .update({
        block_confirmation: 'declined',
        block_confirmation_at: new Date().toISOString(),
        block_confirmation_via: via,
      })
      .eq('id', engagementId)
    if (error) return { ok: false, error: error.message }
    return { ok: true, outcome: 'declined' }
  }

  if (!choice || !['5', '10', '15', 'monthly'].includes(choice)) {
    return { ok: false, error: 'Pick how to continue: 5, 10, or 15 more hours — or monthly until you cancel.' }
  }

  // PL-323D: the continuing rate follows provenance, one source with the
  // price list — recorded at choice time so a later price edit never
  // rewrites what the family agreed to.
  const rates = await continueRatesForStudent(e.studentId)
  const rate = rateForChoice(choice, rates)
  const addHours = choice === 'monthly' ? null : Number(choice)

  const { error } = await supabase
    .from('tutoring_engagements')
    .update({
      block_confirmation: 'confirmed',
      block_confirmation_at: new Date().toISOString(),
      block_confirmation_via: via,
      // A finite choice ACCUMULATES onto any earlier continuation (re-ask
      // cycles); monthly clears the cap — perpetual by explicit choice.
      block_continue_hours: addHours == null ? null : (e.continueHours ?? 0) + addHours,
      block_continue_rate: rate,
      block_dropped_at: null, // a fresh yes re-arms the drop for the NEW end
      // The engagement bills forward at the continuing rate (PL-197 Case-A
      // overflow lines and new session snapshots both read hourly_rate).
      hourly_rate: rate,
    })
    .eq('id', engagementId)
  if (error) return { ok: false, error: error.message }

  // PL-323C: try to reserve the continuing sessions (same tutor only).
  const reservation = await reserveContinuation(e, choice, rate)
  if (reservation.outcome === 'staff') {
    await routeContinuationToStaff(e, choice)
    await sendContinueOutcome(e, choice, rate, null)
    return { ok: true, outcome: 'staff' }
  }
  await sendContinueOutcome(e, choice, rate, reservation.times)
  return { ok: true, outcome: 'reserved', sessions: reservation.times }
}

/** PL-323C: the parent hears the outcome either way — reserved times, or
 *  "our team will sort it out with you". Registry template (draft sends the
 *  twin) with the composed guts riding {blockContinueOutcomeBlock}. */
async function sendContinueOutcome(
  e: BlockEngagement,
  choice: ContinueChoice,
  rate: number,
  reservedTimes: string[] | null
) {
  if (!e.parentEmail) return
  const what =
    choice === 'monthly'
      ? `on the monthly plan at $${rate}/hr, until you cancel`
      : `with ${choice} more hours at $${rate}/hr`
  const block = reservedTimes
    ? `<p>You're all set — ${e.studentFirstName} continues ${what}. These times are reserved with ${e.tutorName}:</p>
       <ul>${reservedTimes.map((t) => `<li>${t}</li>`).join('')}</ul>
       <p>They're on the calendar now; nothing else to do.</p>`
    : `<p>You're all set — ${e.studentFirstName} continues ${what}.</p>
       <p>We couldn't auto-reserve the continuing times (a calendar conflict), so our team is on
       it and will sort the schedule out with you — nothing needed from you right now.</p>`
  const twin = (): Rendered => ({
    subject: `${e.studentFirstName}'s tutoring continues — here's what happens next`,
    html: wrap(`<p>Hi ${e.parentFirstName},</p>${block}<p>Thanks!</p><p>Higher Ground Learning</p>`, {
      preheader: reservedTimes ? 'Times reserved — you are all set.' : "We're sorting the schedule out for you.",
      footer: footerT(),
    }),
  })
  const email = await renderRegistered(
    'BL_CONTINUE_OUTCOME',
    { parentFirstName: e.parentFirstName, parentEmail: e.parentEmail, studentFirstName: e.studentFirstName },
    { blockContinueOutcomeBlock: block },
    twin
  )
  await sendOnce({
    dedupeKey: `block_continue_outcome:${e.id}:${e.askCycle}:${Date.now()}`,
    emailType: 'BL_CONTINUE_OUTCOME',
    templateKey: 'BL_CONTINUE_OUTCOME',
    to: [e.parentEmail],
    subject: email.subject,
    html: email.html,
    bodySnapshotId: email.versionId,
  }).catch((err) => console.error('continue-outcome email failed (portal already told them):', err))
}

/** Reserve the continuation on the SAME tutor, following the engagement's
 *  own recurrence — the same veto logic the reschedule picker uses (portal
 *  sessions overlap + Google free/busy when connected). ANY conflict routes
 *  the whole thing to staff — no silent sliding of times. */
async function reserveContinuation(
  e: BlockEngagement,
  choice: ContinueChoice,
  rate: number
): Promise<{ outcome: 'reserved'; times: string[] } | { outcome: 'staff' }> {
  if (e.recurrence.length === 0) return { outcome: 'staff' } // one-off — a human plans it

  const perSession = e.recurrence[0].duration_minutes / 60
  // 'monthly' reserves through the normal horizon (next month's end) — the
  // monthly cycle keeps materializing from there; a finite choice reserves
  // exactly the chosen hours.
  const targetCount =
    choice === 'monthly' ? null : Math.max(1, Math.ceil(Number(choice) / perSession))

  // Continue AFTER the engagement's last scheduled moment (or now).
  const { data: last } = await supabase
    .from('tutoring_sessions')
    .select('starts_at')
    .eq('engagement_id', e.id)
    .in('status', ['confirmed', 'proposed'])
    .order('starts_at', { ascending: false })
    .limit(1)
  const lastMs = last?.[0] ? new Date(last[0].starts_at).getTime() : 0
  const fromMs = Math.max(lastMs, Date.now())
  const fromIso = new Date(fromMs + 12 * 3_600_000).toISOString().slice(0, 10)

  // Look far enough ahead to cover the chosen amount (≈6 months max).
  const farEnd = choice === 'monthly' ? horizonEndIso(e.tutorTimezone) : addDaysIso(fromIso, 185)
  const occurrences = generateOccurrences(e.recurrence, fromIso, farEnd, e.tutorTimezone)
    .filter((o) => o.startsAt.getTime() > fromMs)
  const candidates = targetCount == null ? occurrences : occurrences.slice(0, targetCount)
  if (candidates.length === 0 || (targetCount != null && candidates.length < targetCount)) {
    return { outcome: 'staff' }
  }

  const windowStart = candidates[0].startsAt
  const windowEnd = candidates[candidates.length - 1].endsAt

  // Veto 1: portal sessions — the tutor's (or student's) other bookings.
  const { data: busyRows } = await supabase
    .from('tutoring_sessions')
    .select('starts_at, ends_at, engagement_id')
    .or(`tutor_id.eq.${e.tutorId},student_id.eq.${e.studentId}`)
    .in('status', ['proposed', 'confirmed'])
    .gte('ends_at', windowStart.toISOString())
    .lte('starts_at', windowEnd.toISOString())
  const busy = ((busyRows as any[]) ?? [])
    .filter((b) => b.engagement_id !== e.id)
    .map((b) => ({ start: new Date(b.starts_at).getTime(), end: new Date(b.ends_at).getTime() }))

  // Veto 2: Google free/busy (the tutor's personal calendar), when connected.
  try {
    const conn = await loadGcalConnection()
    if (conn?.status === 'connected' && conn.key && e.tutorEmail) {
      const fb = await freeBusy(conn.key, e.tutorEmail, e.tutorCalendarId, windowStart.toISOString(), windowEnd.toISOString())
      for (const b of fb) busy.push({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() })
    }
  } catch (err) {
    console.error('continuation freebusy failed (portal overlap check still applied):', err)
  }

  const clash = candidates.some((c) => {
    const s = c.startsAt.getTime()
    const en = c.endsAt.getTime()
    return busy.some((b) => s < b.end && en > b.start)
  })
  if (clash) return { outcome: 'staff' }

  const { data: inserted, error } = await supabase
    .from('tutoring_sessions')
    .insert(
      candidates.map((c) => ({
        engagement_id: e.id,
        student_id: e.studentId,
        tutor_id: e.tutorId,
        starts_at: c.startsAt.toISOString(),
        ends_at: c.endsAt.toISOString(),
        status: 'confirmed',
        rate_snapshot: rate,
      }))
    )
    .select('id, starts_at, ends_at')
  if (error || !inserted) {
    console.error('continuation reserve insert failed — routing to staff:', error?.message)
    return { outcome: 'staff' }
  }
  for (const s of inserted) await enqueueGcalSync(s.id, 'block continuation reserved')
  processGcalQueue().catch((err) => console.error('gcal queue drain failed (retry sweep covers):', err))
  return {
    outcome: 'reserved',
    // PL-339: reserved times speak the full range.
    times: [...inserted]
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
      .map(
        (s) =>
          `${new Date(s.starts_at).toLocaleDateString('en-US', {
            timeZone: e.tutorTimezone,
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}, ${formatTimeRange(s.starts_at, s.ends_at, e.tutorTimezone)}`
      ),
  }
}

/** Conflict / no-recurrence / anything unclear: staff take over, exactly
 *  like a reschedule request — alert + dashboard row; the parent is told
 *  "we'll figure it out for you" by the caller. */
async function routeContinuationToStaff(e: BlockEngagement, choice: ContinueChoice) {
  await supabase
    .from('tutoring_engagements')
    .update({ block_continue_staff_at: new Date().toISOString() })
    .eq('id', e.id)
  const what =
    choice === 'monthly' ? 'monthly, until they cancel' : `${choice} more hours`
  await sendAdminAlert({
    dedupeKey: `block_continue_staff:${e.id}:${Date.now()}`,
    adminEmail: process.env.ADMIN_EMAIL ?? 'williamraymondthomas@gmail.com',
    subject: `Continue-tutoring choice needs scheduling — ${e.studentFirstName}`,
    body: `
      <p><strong>${e.parentFirstName}</strong> confirmed continuing ${e.studentFirstName}'s
      tutoring (<strong>${what}</strong>), but the portal couldn't reserve the continuing
      sessions with ${e.tutorName} — a conflict or no workable recurring time.</p>
      <p>The family was told you'll figure it out with them. Schedule the continuation from
      the engagement:</p>
      <p><a href="${emailBaseUrl()}/admin/tutoring?family=${e.familyId}">Open the engagement →</a></p>`,
  }).catch((err) => console.error('continue-staff alert failed (dashboard row stands):', err))
}
/* eslint-enable @typescript-eslint/no-explicit-any */
