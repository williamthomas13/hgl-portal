// Phase 7a tutoring domain logic (docs/PHASE7_SPEC.md §3/§5): recurrence →
// concrete session instants, the scheduling horizon, and the 24-hour
// reschedule classification. Pure functions — safe to import from routes and
// (except for types) unit-test in isolation.

/** One weekly slot. weekday is ISO: 1 = Monday … 7 = Sunday. Times are the
 *  tutor's local wall clock (the tutor's timezone is the engagement's
 *  operative timezone; families in other zones see renders in their own). */
export type RecurrenceSlot = {
  weekday: number
  start_time: string // 'HH:MM'
  duration_minutes: number
}

export function validRecurrence(value: unknown): value is RecurrenceSlot[] {
  if (!Array.isArray(value)) return false
  return value.every(
    (s) =>
      s &&
      typeof s === 'object' &&
      Number.isInteger(s.weekday) &&
      s.weekday >= 1 &&
      s.weekday <= 7 &&
      typeof s.start_time === 'string' &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(s.start_time) &&
      Number.isInteger(s.duration_minutes) &&
      s.duration_minutes >= 15 &&
      s.duration_minutes <= 480
  )
}

/** One weekly OFFER WINDOW (spec v1.4 §8, pick-from-offered-slots): a span of
 *  the tutor's local wall clock the Ops Director has pre-approved for parent
 *  self-serve reschedules. Same weekday convention as RecurrenceSlot. */
export type OfferWindow = {
  weekday: number // 1 = Monday … 7 = Sunday
  start_time: string // 'HH:MM'
  end_time: string // 'HH:MM', exclusive; must be after start_time
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function validOfferWindows(value: unknown): value is OfferWindow[] {
  if (!Array.isArray(value)) return false
  return value.every(
    (w) =>
      w &&
      typeof w === 'object' &&
      Number.isInteger(w.weekday) &&
      w.weekday >= 1 &&
      w.weekday <= 7 &&
      typeof w.start_time === 'string' &&
      HHMM.test(w.start_time) &&
      typeof w.end_time === 'string' &&
      HHMM.test(w.end_time) &&
      w.end_time > w.start_time // HH:MM sorts lexicographically
  )
}

// ---------------------------------------------------------------------------
// Wall-clock-in-timezone → UTC instant (no library; two-pass offset
// resolution handles DST boundaries).
// ---------------------------------------------------------------------------

function tzOffsetMs(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  )
  return asUtc - at.getTime()
}

/** The instant at which `dateIso` (YYYY-MM-DD) `timeHHMM` happens in `tz`. */
export function zonedToUtc(dateIso: string, timeHHMM: string, tz: string): Date {
  const [h, m] = timeHHMM.split(':').map(Number)
  const naive = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
    h,
    m
  )
  let ts = naive - tzOffsetMs(tz, new Date(naive))
  ts = naive - tzOffsetMs(tz, new Date(ts)) // second pass fixes DST edges
  return new Date(ts)
}

// ---------------------------------------------------------------------------
// Occurrence generation
// ---------------------------------------------------------------------------

/** ISO weekday (1=Mon…7=Sun) of a YYYY-MM-DD calendar date. */
export function isoWeekday(dateIso: string): number {
  const dow = new Date(dateIso + 'T12:00:00Z').getUTCDay() // 0=Sun
  return dow === 0 ? 7 : dow
}

export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(dateIso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export type Occurrence = { startsAt: Date; endsAt: Date }

/**
 * Materialize every slot occurrence with fromIso ≤ date ≤ toIso (calendar
 * dates in the tutor's timezone). Caller filters out past instants and
 * anything colliding with existing rows.
 */
export function generateOccurrences(
  recurrence: RecurrenceSlot[],
  fromIso: string,
  toIso: string,
  tz: string
): Occurrence[] {
  const out: Occurrence[] = []
  if (recurrence.length === 0) return out
  const byWeekday = new Map<number, RecurrenceSlot[]>()
  for (const slot of recurrence) {
    byWeekday.set(slot.weekday, [...(byWeekday.get(slot.weekday) ?? []), slot])
  }
  for (let d = fromIso; d <= toIso; d = addDaysIso(d, 1)) {
    for (const slot of byWeekday.get(isoWeekday(d)) ?? []) {
      const startsAt = zonedToUtc(d, slot.start_time, tz)
      out.push({ startsAt, endsAt: new Date(startsAt.getTime() + slot.duration_minutes * 60_000) })
    }
  }
  out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  return out
}

/**
 * Scheduling horizon (§5): sessions exist through the END OF NEXT MONTH
 * relative to today in the given timezone. 7c's monthly cycle takes over
 * extension from there (generate on the 20th for the coming month).
 */
export function horizonEndIso(tz: string, now: Date = new Date()): string {
  const today = now.toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7)) // 1-12
  // Day 0 of month+2 = last day of month+1.
  const end = new Date(Date.UTC(y, m + 1, 0, 12))
  return end.toISOString().slice(0, 10)
}

/** The signed policy's 24-hour line: ≥24h notice = free reschedule ('ok'),
 *  under it = 'late' ($40/hour fee territory, Ops-Director-overridable). */
export function classifyNotice(startsAt: Date, now: Date = new Date()): 'ok' | 'late' {
  return startsAt.getTime() - now.getTime() >= 24 * 3600_000 ? 'ok' : 'late'
}
