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
