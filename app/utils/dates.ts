// Formatting for plain calendar dates (Postgres `date` → "YYYY-MM-DD").
//
// Class/session dates are calendar dates, not instants: "2026-09-12" means
// September 12 wherever it's read. `new Date("2026-09-12")` parses as UTC
// midnight, so any local-time formatting west of UTC rolls it back to the 11th
// — that's the admin's off-by-one-day bug. Every formatter here anchors the
// string at UTC noon AND formats in UTC, so the output is the calendar date
// written in the string regardless of server or browser timezone.

/** Anchor a YYYY-MM-DD string at UTC noon (immune to DST edge cases).
 *  PL-400: refuses non-ISO input LOUDLY — throws in dev, console.errors in
 *  prod — instead of silently rendering "Invalid Date" to staff. The
 *  dashboard shipped exactly that: a formatter wrapped an already-formatted
 *  "October 13" and every browser showed garbage. Silent garbage is how it
 *  got past review; noise is the guard. */
function utcAnchor(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const msg = `date formatter got non-ISO input ${JSON.stringify(iso)} — pass the raw YYYY-MM-DD value, not display text (PL-400)`
    if (process.env.NODE_ENV !== 'production') throw new Error(msg)
    console.error(msg)
  }
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

/** "September 12, 2026" — long form without the weekday (PL-380). */
export function formatDateLong(iso: string): string {
  return formatDateOnly(iso, { month: 'long', day: 'numeric', year: 'numeric' })
}

/** PL-380: a plain-English calendar-date range — "August 1 – 15, 2026",
 *  "August 25 – September 8, 2026", "December 20, 2026 – January 3, 2027".
 *  THE one range formatter for pay periods and report spans. */
export function formatDateRange(startIso: string, endIso: string): string {
  const a = utcAnchor(startIso)
  const b = utcAnchor(endIso)
  if (startIso.slice(0, 10) === endIso.slice(0, 10)) return formatDateLong(startIso)
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth()
  if (sameMonth) {
    return `${formatDateOnly(startIso, { month: 'long', day: 'numeric' })} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`
  }
  if (sameYear) {
    return `${formatDateOnly(startIso, { month: 'long', day: 'numeric' })} – ${formatDateOnly(endIso, { month: 'long', day: 'numeric' })}, ${b.getUTCFullYear()}`
  }
  return `${formatDateLong(startIso)} – ${formatDateLong(endIso)}`
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
export function zonedDeadline(
  iso: string | Date,
  timezone: string,
  location?: string | null,
  cityLabel?: string | null
): string {
  const when = new Date(iso).toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  // PL-382: callers that know the class's public city (via
  // publicTimeCityLabel / contextTimeCityLabel) pass it — the PL-305
  // location heuristic is only the fallback.
  return `${when} (${cityLabel ?? friendlyZoneCity(timezone, location)} time)`
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

/** PL-398: the city label STAFF surfaces put on times. Staff read city names
 *  too (Scarlett's verdict retiring PL-353's admin carve-out): the org zone
 *  America/Denver reads "Salt Lake City" (HGL's home, HGL_HOME_CITY — the
 *  zone city "Denver" is exactly the confusion PL-305 fixed for parents),
 *  any other zone reads its own city ("Rome" for Europe/Rome). Per-class
 *  contexts keep using publicTimeCityLabel with the class's own facts. */
export function staffTimeCityLabel(timezone: string): string {
  return timezone === 'America/Denver' ? HGL_HOME_CITY : timezoneCityLabel(timezone)
}

/** PL-353 (amended PL-398): the city label pages put on times — the
 *  class/school's OWN city, never the IANA zone city leaking into copy
 *  ("Düsseldorf", not "Berlin"). Resolution: the school's city field → the
 *  class's display_cities list (online classes; joined plainly when several)
 *  → a city read from the location string (PL-305) → the generic zone city
 *  as the last resort. ONE source for every public "… time" label.
 *  PL-398 rule: public AND staff displays speak city names; IANA ids live in
 *  timezone pickers, settings readouts, and debug output only. */
/** PL-382: HGL's home base — what a no-school in-person class "carries" as
 *  its city. HGL HQ is in Salt Lake City; the IANA zone would say "Denver". */
export const HGL_HOME_CITY = 'Salt Lake City'

export function publicTimeCityLabel(opts: {
  schoolCity?: string | null
  displayCities?: string | null
  location?: string | null
  timezone: string
  /** PL-382: true for an open-enrollment (no-school) IN-PERSON class — with
   *  no school city, no display cities, and a location that names no city
   *  ("Room 204"), the class is at HGL's home, so the label says
   *  "Salt Lake City", never the zone city "Denver". */
  hglInPerson?: boolean
}): string {
  const school = (opts.schoolCity ?? '').trim()
  if (school) return school
  const cities = (opts.displayCities ?? '')
    .split(/[\n,]/)
    .map((c) => c.trim())
    .filter(Boolean)
  if (cities.length === 1) return cities[0]
  if (cities.length === 2) return `${cities[0]} and ${cities[1]}`
  if (cities.length > 2) return `${cities.slice(0, -1).join(', ')}, and ${cities[cities.length - 1]}`
  const fromLocation = cityFromLocation(opts.location)
  if (fromLocation) return fromLocation
  if (opts.hglInPerson) return HGL_HOME_CITY
  return timezoneCityLabel(opts.timezone)
}

/** PL-382: the city label EMAILS put on times — the SAME resolution as the
 *  public /c pages, computed from the enrollment context's own facts. ONE
 *  source: every email "(times shown in …)" line and zoned deadline resolves
 *  through here. */
export function contextTimeCityLabel(c: {
  schoolCity?: string | null
  displayCities?: string | null
  defaultLocation?: string | null
  timezone: string
  isOpenEnrollment?: boolean
  deliveryMode?: string | null
}): string {
  return publicTimeCityLabel({
    schoolCity: c.schoolCity,
    displayCities: c.displayCities,
    location: c.defaultLocation,
    timezone: c.timezone,
    hglInPerson: Boolean(c.isOpenEnrollment) && c.deliveryMode !== 'online',
  })
}

/** PL-419: a deadline quoted to a FAMILY — their own stored zone when it's
 *  known (never guessed), today's labeled class-zone render otherwise. The
 *  stated instant always matches the enforced one; only the clock it's read
 *  on changes. ONE rule for every deadline/expiry composer. */
export function contextZonedDeadline(
  iso: string | Date,
  c: {
    schoolCity?: string | null
    displayCities?: string | null
    defaultLocation?: string | null
    timezone: string
    isOpenEnrollment?: boolean
    deliveryMode?: string | null
    familyTimezone?: string | null
  }
): string {
  if (c.familyTimezone && c.familyTimezone !== c.timezone) {
    return zonedDeadline(iso, c.familyTimezone, null, staffTimeCityLabel(c.familyTimezone))
  }
  return zonedDeadline(iso, c.timezone, c.defaultLocation, contextTimeCityLabel(c))
}

/** PL-419: a session instant quoted to a FAMILY — "Wed, Sep 2, 4:00–5:30 PM"
 *  in the base (tutor/class) zone when the family's zone is unknown or the
 *  same (today's behavior exactly); when the family's stored zone differs,
 *  their own clock leads and the base-city time rides secondary so a
 *  schedule change can never be misread:
 *  "Wed, Sep 2, 8:00–9:30 PM in Rome (12:00–1:30 PM in Salt Lake City)". */
export function familyWhenPhrase(opts: {
  startIso: string | Date
  endIso?: string | Date | null
  familyTimezone?: string | null
  baseTimezone: string
  baseCityLabel?: string | null
}): string {
  const day = (tz: string) =>
    new Date(opts.startIso).toLocaleDateString('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  const famTz = opts.familyTimezone
  if (!famTz || famTz === opts.baseTimezone) {
    return `${day(opts.baseTimezone)}, ${formatTimeRange(opts.startIso, opts.endIso, opts.baseTimezone)}`
  }
  const baseDay = day(opts.baseTimezone)
  const famDay = day(famTz)
  const secondary = `${famDay === baseDay ? '' : `${baseDay}, `}${formatTimeRange(
    opts.startIso,
    opts.endIso,
    opts.baseTimezone
  )} in ${opts.baseCityLabel ?? staffTimeCityLabel(opts.baseTimezone)}`
  return `${famDay}, ${formatTimeRange(opts.startIso, opts.endIso, famTz)} in ${staffTimeCityLabel(famTz)} (${secondary})`
}

// ---------------------------------------------------------------------------
// PL-339: time RANGES everywhere — "4:00–5:30 PM", never a bare start time.
// Tight en dash; the leading meridiem drops when both ends share it
// ("4:00–5:30 PM") and stays when they differ ("11:00 AM–12:30 PM").
// Leaf-safe on purpose: calendar blocks, wizard chips, and email composers
// all format through these three, so the treatment can't drift.
// ---------------------------------------------------------------------------

/** Collapse two already-formatted "h:mm AM/PM" labels into one range. */
export function timeRangeLabel(startLabel: string, endLabel: string): string {
  const meridiem = (s: string) => s.match(/\s*(AM|PM)\s*$/i)?.[1]?.toUpperCase() ?? ''
  const m = meridiem(startLabel)
  if (m && m === meridiem(endLabel)) {
    return `${startLabel.replace(/\s*(AM|PM)\s*$/i, '')}–${endLabel}`
  }
  return `${startLabel}–${endLabel}`
}

/** Range between two instants, rendered in a zone: "4:00–5:30 PM". */
export function formatTimeRange(
  start: string | Date,
  end: string | Date | null | undefined,
  timeZone: string
): string {
  const fmt = (v: string | Date) =>
    new Date(v).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
  if (!end) return fmt(start) // an end we don't know stays a start time
  return timeRangeLabel(fmt(start), fmt(end))
}

/** Range from a wall-clock 'HH:MM' start + duration — recurrence rows and
 *  proposed blocks, where no instant (and no zone) exists yet. */
export function hhmmRange(startHHMM: string, durationMinutes: number): string {
  const [h, m] = startHHMM.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return startHHMM
  const label = (mins: number) => {
    const hh = Math.floor(mins / 60) % 24
    const hr = hh % 12 === 0 ? 12 : hh % 12
    return `${hr}:${String(mins % 60).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`
  }
  const startMins = h * 60 + m
  return timeRangeLabel(label(startMins), label(startMins + Math.max(0, durationMinutes)))
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
