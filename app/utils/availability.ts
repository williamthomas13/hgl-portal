// PL-19 availability & matching (docs/AVAILABILITY_MATCHING_SPEC.md): student
// weekly availability ranges and the slot-suggestion engine the New Student
// Schedule wizard runs. Pure functions, client-safe — no supabase imports.
//
// Suggestions = student availability ∩ tutor Google free time ∩ tutor offer
// windows, ranked over the whole generated-session horizon. They only ever
// pre-fill the slot builder — the Ops Director can ignore them entirely.

import {
  addDaysIso,
  generateOccurrences,
  isoWeekday,
  zonedToUtc,
  type OfferWindow,
  type RecurrenceSlot,
} from './tutoring'

/** One weekly availability range on the FAMILY's local wall clock.
 *  weekday is ISO: 1 = Monday … 7 = Sunday (house convention). */
export type AvailabilityRange = {
  weekday: number
  start_time: string // 'HH:MM'
  end_time: string // 'HH:MM', exclusive
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function validAvailabilityRanges(value: unknown): value is AvailabilityRange[] {
  if (!Array.isArray(value) || value.length > 40) return false
  return value.every(
    (r) =>
      r &&
      typeof r === 'object' &&
      Number.isInteger(r.weekday) &&
      r.weekday >= 1 &&
      r.weekday <= 7 &&
      typeof r.start_time === 'string' &&
      HHMM.test(r.start_time) &&
      typeof r.end_time === 'string' &&
      HHMM.test(r.end_time) &&
      r.end_time > r.start_time // 'HH:MM' sorts lexicographically
  )
}

// ---------------------------------------------------------------------------
// Suggestion engine
// ---------------------------------------------------------------------------

type Interval = { start: number; end: number } // epoch ms

export type SuggestedCombo = {
  slots: RecurrenceSlot[] // tutor wall clock — drops straight into the slot builder
  conflicts: number // busy-block collisions across the whole horizon
}

function wallClockIn(tz: string, at: Date): { weekday: number; hhmm: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1
  return {
    weekday,
    hhmm: `${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}`,
  }
}

function addMinutesHHMM(hhmm: string, minutes: number): string | null {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  if (total > 24 * 60) return null // crosses midnight — not a schedulable weekly slot
  const hh = Math.floor(total / 60) % 24
  return `${String(hh).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start
}

/** Circular min-gap between the combo's weekdays — bigger = better spread
 *  (2×/week prefers Mon+Thu over Mon+Tue). */
function spreadScore(weekdays: number[]): number {
  if (weekdays.length < 2) return 7
  const sorted = [...weekdays].sort((a, b) => a - b)
  let min = 7
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length]
    const gap = i === sorted.length - 1 ? next + 7 - sorted[i] : next - sorted[i]
    min = Math.min(min, gap)
  }
  return min
}

/**
 * Rank weekly slot combinations for the wizard. Candidates start on tutor
 * wall-clock half-hour boundaries inside the student's availability (and the
 * tutor's offer windows when set), then each candidate is scored by how many
 * of its materialized occurrences across [fromIso, toIso] collide with the
 * tutor's busy blocks. Empty availability returns [] — the UI renders a
 * "no availability on file" hint, never an error.
 */
export function suggestWeeklySlots(opts: {
  availability: AvailabilityRange[]
  familyTimezone: string
  busy: { start: string; end: string }[]
  offerWindows: OfferWindow[] // [] = no working-hours constraint
  tutorTimezone: string
  sessionsPerWeek: number
  durationMinutes: number
  fromIso: string // YYYY-MM-DD, first candidate date
  toIso: string // YYYY-MM-DD, horizon end (inclusive)
  maxCombos?: number
}): SuggestedCombo[] {
  const {
    availability,
    familyTimezone,
    busy,
    offerWindows,
    tutorTimezone,
    sessionsPerWeek,
    durationMinutes,
    fromIso,
    toIso,
    maxCombos = 3,
  } = opts
  if (availability.length === 0 || sessionsPerWeek < 1 || durationMinutes < 15) return []

  const busyIntervals: Interval[] = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)

  // 1. Candidate weekly slots from the first seven days: concrete availability
  // intervals on the family's clock, stepped on the tutor's half-hours.
  const byWeekday = new Map<number, AvailabilityRange[]>()
  for (const r of availability) byWeekday.set(r.weekday, [...(byWeekday.get(r.weekday) ?? []), r])

  const candidates = new Map<string, RecurrenceSlot>()
  const durationMs = durationMinutes * 60_000
  const STEP_MS = 30 * 60_000
  for (let i = 0, d = fromIso; i < 7; i++, d = addDaysIso(d, 1)) {
    for (const range of byWeekday.get(isoWeekday(d)) ?? []) {
      const windowStart = zonedToUtc(d, range.start_time, familyTimezone).getTime()
      const windowEnd = zonedToUtc(d, range.end_time, familyTimezone).getTime()
      // Align the first candidate to the tutor's next half-hour boundary.
      const tutorClock = wallClockIn(tutorTimezone, new Date(windowStart))
      const [, mm] = tutorClock.hhmm.split(':').map(Number)
      const align = (30 - (mm % 30)) % 30
      for (let t = windowStart + align * 60_000; t + durationMs <= windowEnd; t += STEP_MS) {
        const wc = wallClockIn(tutorTimezone, new Date(t))
        const end = addMinutesHHMM(wc.hhmm, durationMinutes)
        if (!end) continue
        if (offerWindows.length > 0) {
          const inWindow = offerWindows.some(
            (w) => w.weekday === wc.weekday && w.start_time <= wc.hhmm && end <= w.end_time
          )
          if (!inWindow) continue
        }
        const key = `${wc.weekday}:${wc.hhmm}`
        if (!candidates.has(key)) {
          candidates.set(key, { weekday: wc.weekday, start_time: wc.hhmm, duration_minutes: durationMinutes })
        }
      }
    }
  }
  if (candidates.size === 0) return []

  // 2. Score each candidate across the whole horizon.
  const scored = [...candidates.values()].map((slot) => {
    const occurrences = generateOccurrences([slot], fromIso, toIso, tutorTimezone)
    let conflicts = 0
    for (const occ of occurrences) {
      const iv = { start: occ.startsAt.getTime(), end: occ.endsAt.getTime() }
      if (busyIntervals.some((b) => overlaps(iv, b))) conflicts++
    }
    return { slot, conflicts }
  })
  // Fewest conflicts, then earliest-in-window.
  scored.sort((a, b) => a.conflicts - b.conflicts || (a.slot.start_time < b.slot.start_time ? -1 : 1))

  // 3. Best slot per weekday, then distinct-weekday combinations ranked by
  // total conflicts → spread → earliest times.
  const bestPerDay = new Map<number, { slot: RecurrenceSlot; conflicts: number }>()
  for (const s of scored) if (!bestPerDay.has(s.slot.weekday)) bestPerDay.set(s.slot.weekday, s)
  const days = [...bestPerDay.keys()]
  const k = Math.min(sessionsPerWeek, days.length)

  const combos: SuggestedCombo[] = []
  const choose = (startIdx: number, picked: number[]) => {
    if (picked.length === k) {
      const slots = picked.map((d) => bestPerDay.get(d)!)
      combos.push({
        slots: slots.map((s) => s.slot).sort((a, b) => a.weekday - b.weekday),
        conflicts: slots.reduce((n, s) => n + s.conflicts, 0),
      })
      return
    }
    for (let i = startIdx; i < days.length; i++) choose(i + 1, [...picked, days[i]])
  }
  choose(0, [])

  combos.sort(
    (a, b) =>
      a.conflicts - b.conflicts ||
      spreadScore(b.slots.map((s) => s.weekday)) - spreadScore(a.slots.map((s) => s.weekday)) ||
      a.slots[0].start_time.localeCompare(b.slots[0].start_time)
  )
  return combos.slice(0, maxCombos)
}
