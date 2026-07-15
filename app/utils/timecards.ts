import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, wrap, footerT } from './email'

// Phase 7b timecards (docs/PHASE7_SPEC.md §7). Semi-monthly pay periods:
// 1st–15th (payday the 20th) and 16th–end of month (payday the 5th),
// anchored to America/Denver — payroll is run from SLC regardless of where
// a tutor or family sits. Hours only: pay rates live in QBO Payroll and
// never enter the portal.
//
// Payable = the tutor was paid for reserved time (resolved July 10):
//   completed · forfeited · no_show · late-rescheduled ORIGINAL slots
// Free (≥24h) reschedules move the session — the tutor is paid when it
// actually happens, in whichever period that falls.

const PAYROLL_TZ = 'America/Denver'

export type PayPeriod = { start: string; end: string } // YYYY-MM-DD inclusive

function denverToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: PAYROLL_TZ })
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0, 12)).getUTCDate() // m is 1-12
}

/** The pay period containing a Denver calendar date. */
export function periodContaining(dateIso: string): PayPeriod {
  const y = Number(dateIso.slice(0, 4))
  const m = Number(dateIso.slice(5, 7))
  const d = Number(dateIso.slice(8, 10))
  const mm = String(m).padStart(2, '0')
  if (d <= 15) return { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` }
  return { start: `${y}-${mm}-16`, end: `${y}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}` }
}

/** The most recently CLOSED pay period as of now (Denver). */
export function lastClosedPeriod(now: Date = new Date()): PayPeriod {
  const today = denverToday(now)
  const current = periodContaining(today)
  // Step one day before the current period's start and take its period.
  const anchor = new Date(current.start + 'T12:00:00Z')
  anchor.setUTCDate(anchor.getUTCDate() - 1)
  return periodContaining(anchor.toISOString().slice(0, 10))
}

/** UTC instant bounds of a Denver-date period (half-open [start, end)). */
function periodBounds(p: PayPeriod): { fromIso: string; toIso: string } {
  // Denver is UTC-6/-7; a fixed 12h pad on either side of the calendar dates
  // would misfile sessions near midnight. Resolve the true wall-clock bounds.
  const from = wallClockUtc(p.start, '00:00')
  const dayAfterEnd = new Date(p.end + 'T12:00:00Z')
  dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1)
  const to = wallClockUtc(dayAfterEnd.toISOString().slice(0, 10), '00:00')
  return { fromIso: from.toISOString(), toIso: to.toISOString() }
}

function wallClockUtc(dateIso: string, timeHHMM: string): Date {
  const [h, min] = timeHHMM.split(':').map(Number)
  const naive = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
    h,
    min
  )
  const off = (at: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: PAYROLL_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .formatToParts(new Date(at))
        .map((pp) => [pp.type, pp.value])
    )
    return (
      Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute)
      ) - at
    )
  }
  let ts = naive - off(naive)
  ts = naive - off(ts)
  return new Date(ts)
}

/**
 * Payable sessions for one tutor in a period. `rescheduled` rows count only
 * with `late` notice (the reserved original slot); `ok` reschedules moved.
 */
async function payableSessions(tutorId: string, p: PayPeriod) {
  const { fromIso, toIso } = periodBounds(p)
  const { data, error } = await supabase
    .from('tutoring_sessions')
    .select('id, starts_at, ends_at, duration_minutes, status, reschedule_notice, timecard_id')
    .eq('tutor_id', tutorId)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .in('status', ['completed', 'forfeited', 'no_show', 'rescheduled'])
  if (error) throw new Error(`payable sessions query failed: ${error.message}`)
  return (data ?? []).filter((s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late')
}

/**
 * Auto-flip past sessions to completed (spec §7.2): terminal statuses are
 * exempt; the tutor's only required action is correcting exceptions.
 */
export async function autoCompleteSessions(): Promise<number> {
  const { data, error } = await supabase
    .from('tutoring_sessions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .in('status', ['proposed', 'confirmed'])
    .lt('ends_at', new Date().toISOString())
    .select('id')
  if (error) {
    console.error('autoCompleteSessions failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

/** Restamp + retotal one timecard from live session rows. No-op once the
 *  timecard has been approved/exported — the reviewed number must not drift. */
export async function recomputeTimecard(timecardId: string): Promise<number | null> {
  const { data: tc } = await supabase
    .from('timecards')
    .select('id, tutor_id, period_start, period_end, status')
    .eq('id', timecardId)
    .maybeSingle()
  if (!tc) return null
  if (tc.status === 'approved' || tc.status === 'exported') return Number((tc as { total_hours?: number }).total_hours ?? 0)
  const sessions = await payableSessions(tc.tutor_id, { start: tc.period_start, end: tc.period_end })
  const ids = sessions.map((s) => s.id)
  if (ids.length > 0) {
    await supabase.from('tutoring_sessions').update({ timecard_id: tc.id }).in('id', ids)
  }
  // Un-stamp sessions that stopped being payable (e.g. corrected to a free
  // reschedule) so they don't linger on the card.
  await supabase
    .from('tutoring_sessions')
    .update({ timecard_id: null })
    .eq('timecard_id', tc.id)
    .not('id', 'in', `(${ids.length ? ids.join(',') : '00000000-0000-0000-0000-000000000000'})`)
  const total = Number(sessions.reduce((sum, s) => sum + s.duration_minutes / 60, 0).toFixed(2))
  await supabase
    .from('timecards')
    .update({ total_hours: total, updated_at: new Date().toISOString() })
    .eq('id', tc.id)
  return total
}

export type TimecardSweepResult = { created: number; recomputed: number; t5Sent: number }

/**
 * Daily sweep: ensure a timecard exists for every tutor with payable
 * sessions in the last closed period, keep open ones in step with late
 * corrections, and send T5 once per new card. Idempotent — the unique
 * (tutor_id, period_start) and sendOnce dedupe carry re-runs.
 */
export async function sweepTimecards(now: Date = new Date()): Promise<TimecardSweepResult> {
  const result: TimecardSweepResult = { created: 0, recomputed: 0, t5Sent: 0 }
  try {
    const p = lastClosedPeriod(now)
    const { fromIso, toIso } = periodBounds(p)

    // Tutors with payable activity in the period.
    const { data: activity } = await supabase
      .from('tutoring_sessions')
      .select('tutor_id, status, reschedule_notice')
      .gte('starts_at', fromIso)
      .lt('starts_at', toIso)
      .in('status', ['completed', 'forfeited', 'no_show', 'rescheduled'])
    const tutorIds = [
      ...new Set(
        (activity ?? [])
          .filter((s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late')
          .map((s) => s.tutor_id)
      ),
    ]

    for (const tutorId of tutorIds) {
      const { data: existing } = await supabase
        .from('timecards')
        .select('id, status')
        .eq('tutor_id', tutorId)
        .eq('period_start', p.start)
        .maybeSingle()

      let timecardId = existing?.id
      if (!existing) {
        const { data: inserted, error } = await supabase
          .from('timecards')
          .insert({ tutor_id: tutorId, period_start: p.start, period_end: p.end })
          .select('id')
          .single()
        if (error) {
          // Unique-violation race with a concurrent run: fetch and continue.
          if (error.code !== '23505') {
            console.error(`timecard insert failed for tutor ${tutorId}:`, error.message)
            continue
          }
          const { data: raced } = await supabase
            .from('timecards')
            .select('id')
            .eq('tutor_id', tutorId)
            .eq('period_start', p.start)
            .single()
          timecardId = raced?.id
        } else {
          timecardId = inserted?.id
          result.created++
        }
      }
      if (!timecardId) continue

      const total = await recomputeTimecard(timecardId)
      if (total !== null) result.recomputed++

      // T5_TIMECARD_READY (spec §6 templates / §7.2) — once per card.
      const { data: tutor } = await supabase
        .from('instructors')
        .select('email, name')
        .eq('id', tutorId)
        .maybeSingle()
      if (tutor?.email) {
        const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
        const status = await sendOnce({
          dedupeKey: `t5_timecard:${tutorId}:${p.start}`,
          emailType: 'T5_TIMECARD_READY',
          to: [tutor.email],
          subject: `Your timecard for ${p.start} – ${p.end} is ready to confirm`,
          html: wrap(
            `<h2 style="color:#334155">Timecard ready — ${p.start} to ${p.end}</h2>
             <p>Hi ${tutor.name?.split(' ')[0] ?? 'there'},</p>
             <p>Your sessions for the pay period are in: <strong>${total ?? 0} hours</strong>.
             The portal built this from the schedule, so usually there is nothing to fill out —
             just glance over it, correct any exception (a no-show, a session that ran a
             different length), and hit <strong>Confirm timecard</strong>.</p>
             <p><a href="${base}/portal?view=tutor">Review and confirm your timecard →</a></p>
             <p style="color:#64748b;font-size:13px">Sessions cancelled inside 24 hours and
             no-shows are on the card on purpose — you're paid for reserved time.</p>`,
            { preheader: `${total ?? 0} hours for ${p.start} – ${p.end}`, footer: footerT() }
          ),
        })
        if (status === 'sent') result.t5Sent++
      }
    }
    return result
  } catch (e) {
    console.error('sweepTimecards crashed:', e)
    return result
  }
}
