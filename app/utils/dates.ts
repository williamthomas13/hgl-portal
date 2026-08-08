// Formatting for plain calendar dates (Postgres `date` → "YYYY-MM-DD").
//
// Class/session dates are calendar dates, not instants: "2026-09-12" means
// September 12 wherever it's read. `new Date("2026-09-12")` parses as UTC
// midnight, so any local-time formatting west of UTC rolls it back to the 11th
// — that's the admin's off-by-one-day bug. Every formatter here anchors the
// string at UTC noon AND formats in UTC, so the output is the calendar date
// written in the string regardless of server or browser timezone.

/** Anchor a YYYY-MM-DD string at UTC noon (immune to DST edge cases). */
function utcAnchor(iso: string): Date {
  return new Date(iso.slice(0, 10) + 'T12:00:00Z')
}

export function formatDateOnly(
  iso: string,
  options: Intl.DateTimeFormatOptions,
  locale = 'en-US'
): string {
  return utcAnchor(iso).toLocaleDateString(locale, { ...options, timeZone: 'UTC' })
}

/** "Saturday, September 12, 2026" — portal/registration long form. */
export function formatDateFull(iso: string): string {
  return formatDateOnly(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** "Sep 12, 2026" */
export function formatDateShort(iso: string): string {
  return formatDateOnly(iso, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "02 September 2026" — the admin-wide date format. */
export function formatDateAdmin(iso: string): string {
  return formatDateOnly(iso, { day: '2-digit', month: 'long', year: 'numeric' }, 'en-GB')
}

/** Calendar-date parts for chip-style displays (SessionCalendar). */
export function dateParts(iso: string): {
  monthShort: string
  dayOfMonth: number
  weekdayLong: string
} {
  const d = utcAnchor(iso)
  return {
    monthShort: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    dayOfMonth: d.getUTCDate(),
    weekdayLong: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
  }
}

/** PL-1: the class's real first day. Stored `start_date` can drift when
 * sessions are added/moved after creation, so every "Starts …" render uses
 * the earliest session date and falls back to `start_date` only when no
 * sessions exist yet. */
export function effectiveStartDate(
  startDate: string,
  sessions: { session_date: string }[] | null | undefined
): string {
  const first = (sessions ?? []).reduce<string | null>(
    (min, s) => (min === null || s.session_date < min ? s.session_date : min),
    null
  )
  return first ?? startDate
}

/** PL-49: sessions order by calendar date, then start time — same-date
 * sessions (e.g. ISD's split 10:00/14:00 day) must list morning-first, and
 * "Session N" labels derive from render order, so every sort site uses this. */
export function bySessionStart(
  a: { session_date: string; start_time?: string | null },
  b: { session_date: string; start_time?: string | null }
): number {
  return (
    a.session_date.localeCompare(b.session_date) ||
    (a.start_time ?? '').localeCompare(b.start_time ?? '')
  )
}

/** Month (1–12) and year of a calendar date, timezone-independent. */
export function monthYear(iso: string): { month: number; year: number } {
  const d = utcAnchor(iso)
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }
}

/** Calendar-date arithmetic on YYYY-MM-DD strings (client-safe twin of
 * lifecycle's addDaysISO, which lives in a server-only module). */
export function addDays(iso: string, days: number): string {
  const d = utcAnchor(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "02 September 2026" for a timestamptz — an instant, so rendered in the
 * viewer's local timezone (unlike plain calendar dates above). */
export function formatTimestampAdmin(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

/** PL-118: a deadline a recipient reads must equal the instant we enforce —
 *  rendered in the given IANA zone WITH a plain-English zone label:
 *  "Thursday, July 30, 3:00 PM (Mexico City time)". Leaf-safe on purpose:
 *  registry variables (client-reachable) and email composers share it. */
export function zonedDeadline(iso: string | Date, timezone: string, location?: string | null): string {
  const when = new Date(iso).toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  return `${when} (${friendlyZoneCity(timezone, location)} time)`
}

/** "America/Mexico_City" → "Mexico City" — the plain-English city half of an
 *  IANA zone, shared by deadline copy and the PL-126 calendar label. */
export function timezoneCityLabel(timezone: string): string {
  return (timezone.split('/').pop() ?? timezone).replace(/_/g, ' ')
}

/** PL-305: the city inside a postal-address location string, or null.
 *  Only strings that END like a US postal address are trusted ("380 W.
 *  Pierpont Ave, Salt Lake City, UT" / "…, Salt Lake City, UT 84101") — the
 *  city is the segment before the state. Room strings, buildings, and
 *  meeting links never match, so they can't masquerade as a city. */
export function cityFromLocation(location: string | null | undefined): string | null {
  if (!location) return null
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const last = parts[parts.length - 1]
  const stateLike = /^[A-Z]{2}(\s+\d{3,10})?$/.test(last) || /^\d{5}(-\d{4})?$/.test(last)
  if (!stateLike) return null
  const candidate = parts[parts.length - 2]
  if (!candidate || /[\d@/]/.test(candidate) || candidate.length < 3 || candidate.length > 40) return null
  return candidate
}

/** PL-305: the zone label families read should speak the CLASS's city when
 *  the location tells us one — "Salt Lake City time", not "Denver time", for
 *  the at-HGL classes (same America/Denver zone, but not every parent knows
 *  that). Falls back to the IANA zone's city for online classes or when no
 *  city can be read from the location. ONE source: every "(times shown in …)"
 *  render and zoned deadline goes through here. */
export function friendlyZoneCity(timezone: string, location?: string | null): string {
  return cityFromLocation(location) ?? timezoneCityLabel(timezone)
}

// PL-127: ONE clock for the availability promise — the family-facing "we'll
// propose times within N business days" line and the ops-side "propose times
// by {date}" countdown both derive from this constant, so they can never
// disagree. Change the N here and both surfaces move together.
export const AVAILABILITY_PROPOSAL_BUSINESS_DAYS = 3

/** N business days (Mon–Fri) after a YYYY-MM-DD date, as YYYY-MM-DD. */
export function addBusinessDays(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z')
  let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) left--
  }
  return d.toISOString().slice(0, 10)
}
