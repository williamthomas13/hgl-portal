// PL-424: the availability old→new diff — LEAF MODULE (no imports beyond
// leaves; client- and server-safe). ONE composer: the update alert email,
// the admin review card, and any future surface all speak the same lines
// ("Monday 4:00–6:00 PM unchanged · Tuesday ADDED 4:00–6:00 PM · Sunday
// REMOVED 2:00–4:00 PM"), so the story can never drift between them.

import { zonedToUtc } from './tutoring'

export type AvailRange = { weekday: number; start_time: string; end_time: string; timezone?: string | null }

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function fmtHHMM(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function rangeLabel(r: AvailRange): string {
  return `${WEEKDAYS[r.weekday - 1] ?? `Day ${r.weekday}`} ${fmtHHMM(r.start_time)}–${fmtHHMM(r.end_time)}`
}

const key = (r: AvailRange) => `${r.weekday}|${String(r.start_time).slice(0, 5)}|${String(r.end_time).slice(0, 5)}`

export type AvailabilityDiff = {
  added: AvailRange[]
  removed: AvailRange[]
  unchanged: AvailRange[]
  /** Composed plain-English lines, weekday order, one per changed/kept range. */
  lines: string[]
}

export function availabilityDiff(before: AvailRange[], after: AvailRange[]): AvailabilityDiff {
  const beforeKeys = new Set(before.map(key))
  const afterKeys = new Set(after.map(key))
  const byDay = (a: AvailRange, b: AvailRange) =>
    a.weekday - b.weekday || String(a.start_time).localeCompare(String(b.start_time))
  const added = after.filter((r) => !beforeKeys.has(key(r))).sort(byDay)
  const removed = before.filter((r) => !afterKeys.has(key(r))).sort(byDay)
  const unchanged = after.filter((r) => beforeKeys.has(key(r))).sort(byDay)
  const lines = [
    ...unchanged.map((r) => `${rangeLabel(r)} unchanged`),
    ...added.map((r) => `${rangeLabel(r)} ADDED`),
    ...removed.map((r) => `${rangeLabel(r)} REMOVED`),
  ]
  return { added, removed, unchanged, lines }
}

/** PL-424D: is a concrete session instant OUTSIDE every shared window?
 *  Judged on each range's OWN zone (rows carry the family's timezone at
 *  share time). Empty availability returns false — unknown is never
 *  "unavailable" (the availability.ts rule). */
export function sessionOutsideWindows(
  startsAtIso: string,
  endsAtIso: string | null,
  ranges: AvailRange[]
): boolean {
  if (ranges.length === 0) return false
  const start = new Date(startsAtIso)
  const end = endsAtIso ? new Date(endsAtIso) : start
  for (const r of ranges) {
    const tz = r.timezone || 'America/Denver'
    // The session's local calendar date + wall time in the range's zone.
    const dateIso = start.toLocaleDateString('en-CA', { timeZone: tz })
    const weekdayName = start.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' })
    if (WEEKDAYS.indexOf(weekdayName) + 1 !== r.weekday) continue
    const windowStart = zonedToUtc(dateIso, String(r.start_time).slice(0, 5), tz).getTime()
    const windowEnd = zonedToUtc(dateIso, String(r.end_time).slice(0, 5), tz).getTime()
    if (start.getTime() >= windowStart && end.getTime() <= windowEnd) return false
  }
  return true
}
