// PL-347: THE reporting-period concept — one source for every reporting
// surface (report page, snapshot card, and anything later). Nothing else may
// re-derive period boundaries. Everything here is month-granular on purpose:
// every reporting row in the system is already keyed by an America/Denver
// YYYY-MM string (classes by class month, 1-on-1 by invoice period, packages
// by purchase month), so a period is just an inclusive month range and
// scoping is a string comparison — zero new revenue math, no timestamp
// boundary bugs. Quarters are CALENDAR quarters (the PL-347 scope fence:
// no fiscal/academic year exists unless Scarlett defines one).
//
// LEAF FILE — no imports. regress:report compiles this standalone with tsc
// next to term-report.ts; keep it dependency-free.

export type PeriodKind =
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'this-year'
  | 'all-time'
  | 'custom'

export type ReportPeriod = {
  kind: PeriodKind
  /** Selector/header label, e.g. "Q3 2026 · July–September". */
  label: string
  /** In-sentence form, e.g. "Q3 2026 (July–September)" or "all time". */
  phrase: string
  /** Inclusive Denver YYYY-MM bounds; both null = unbounded (All time). */
  fromMonth: string | null
  toMonth: string | null
  /** The equal-length period immediately before this one — the deltas twin.
   *  Null for All time (nothing precedes everything). */
  previous: { fromMonth: string; toMonth: string; label: string } | null
}

/** Selector options in display order — the plain-English names every surface
 *  uses (the report page appends "Custom months"; the snapshot card doesn't). */
export const PERIOD_OPTIONS: { kind: PeriodKind; name: string }[] = [
  { kind: 'all-time', name: 'All time' },
  { kind: 'this-month', name: 'This month' },
  { kind: 'last-month', name: 'Last month' },
  { kind: 'this-quarter', name: 'This quarter' },
  { kind: 'this-year', name: 'This year' },
  { kind: 'custom', name: 'Custom months' },
]

export function isPeriodKind(v: unknown): v is PeriodKind {
  return typeof v === 'string' && PERIOD_OPTIONS.some((o) => o.kind === v)
}

const MONTH_RE = /^\d{4}-\d{2}$/

/** Today's month in America/Denver — the house idiom, centralized. */
export function denverMonth(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }).slice(0, 7)
}

/** Pure YYYY-MM arithmetic — no Date, no timezone involved. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month
}

/** "August 2026" */
export function monthLongLabel(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`
}

/** Plain-English label for an inclusive month range: "August 2026",
 *  "March–May 2026", or "November 2025 – February 2026". */
export function monthRangeLabel(fromMonth: string, toMonth: string): string {
  if (fromMonth === toMonth) return monthLongLabel(fromMonth)
  const fy = fromMonth.slice(0, 4)
  const ty = toMonth.slice(0, 4)
  if (fy === ty) return `${monthName(fromMonth)}–${monthName(toMonth)} ${fy}`
  return `${monthLongLabel(fromMonth)} – ${monthLongLabel(toMonth)}`
}

function quarterOf(month: string): { year: number; q: number } {
  return { year: Number(month.slice(0, 4)), q: Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1 }
}

function quarterBounds(year: number, q: number): { fromMonth: string; toMonth: string } {
  const fromM = (q - 1) * 3 + 1
  return {
    fromMonth: `${year}-${String(fromM).padStart(2, '0')}`,
    toMonth: `${year}-${String(fromM + 2).padStart(2, '0')}`,
  }
}

function quarterLabel(year: number, q: number): string {
  const { fromMonth, toMonth } = quarterBounds(year, q)
  return `Q${q} ${year} · ${monthName(fromMonth)}–${monthName(toMonth)}`
}

/**
 * Resolve a period kind (plus, for 'custom', an inclusive month range) into
 * concrete Denver-month bounds, a plain-English label, and the
 * previous-period twin. `now` is injectable so the regression gate can pin
 * the clock.
 */
export function resolvePeriod(
  kind: PeriodKind,
  opts: { now?: Date; fromMonth?: string; toMonth?: string } = {}
): ReportPeriod {
  const cur = denverMonth(opts.now)

  if (kind === 'all-time') {
    return { kind, label: 'All time', phrase: 'all time', fromMonth: null, toMonth: null, previous: null }
  }

  if (kind === 'this-month' || kind === 'last-month') {
    const m = kind === 'this-month' ? cur : addMonths(cur, -1)
    const prev = addMonths(m, -1)
    return {
      kind,
      label: `${kind === 'this-month' ? 'This month' : 'Last month'} · ${monthLongLabel(m)}`,
      phrase: monthLongLabel(m),
      fromMonth: m,
      toMonth: m,
      previous: { fromMonth: prev, toMonth: prev, label: monthLongLabel(prev) },
    }
  }

  if (kind === 'this-quarter') {
    const { year, q } = quarterOf(cur)
    const bounds = quarterBounds(year, q)
    const prevYear = q === 1 ? year - 1 : year
    const prevQ = q === 1 ? 4 : q - 1
    const prevBounds = quarterBounds(prevYear, prevQ)
    return {
      kind,
      label: quarterLabel(year, q),
      phrase: `Q${q} ${year} (${monthName(bounds.fromMonth)}–${monthName(bounds.toMonth)})`,
      ...bounds,
      previous: { ...prevBounds, label: `Q${prevQ} ${prevYear}` },
    }
  }

  if (kind === 'this-year') {
    const year = Number(cur.slice(0, 4))
    return {
      kind,
      label: `${year} · January–December`,
      phrase: `${year}`,
      fromMonth: `${year}-01`,
      toMonth: `${year}-12`,
      previous: { fromMonth: `${year - 1}-01`, toMonth: `${year - 1}-12`, label: `${year - 1}` },
    }
  }

  // custom — normalize a reversed range instead of erroring; fall back to the
  // current month when a bound is missing or malformed.
  let from = MONTH_RE.test(opts.fromMonth ?? '') ? (opts.fromMonth as string) : cur
  let to = MONTH_RE.test(opts.toMonth ?? '') ? (opts.toMonth as string) : cur
  if (from > to) [from, to] = [to, from]
  const span = monthsSpan(from, to)
  const prevTo = addMonths(from, -1)
  const prevFrom = addMonths(from, -span)
  const label = monthRangeLabel(from, to)
  return {
    kind: 'custom',
    label,
    phrase: label,
    fromMonth: from,
    toMonth: to,
    previous: { fromMonth: prevFrom, toMonth: prevTo, label: monthRangeLabel(prevFrom, prevTo) },
  }
}

/** Inclusive month count of a range ("2026-03".."2026-05" → 3). */
export function monthsSpan(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split('-').map(Number)
  const [ty, tm] = toMonth.split('-').map(Number)
  return (ty * 12 + tm) - (fy * 12 + fm) + 1
}

/**
 * Does a row's month key fall inside the period? Unbounded (All time) admits
 * everything — including the honest non-month buckets ('unscheduled',
 * 'unknown'); bounded periods exclude those, because a row that can't state
 * its month can't claim membership in one. This asymmetry is what makes the
 * All-time parity guarantee (PL-347 E) structural.
 */
export function monthInPeriod(
  month: string,
  period: { fromMonth: string | null; toMonth: string | null }
): boolean {
  if (period.fromMonth == null && period.toMonth == null) return true
  if (!MONTH_RE.test(month)) return false
  if (period.fromMonth != null && month < period.fromMonth) return false
  if (period.toMonth != null && month > period.toMonth) return false
  return true
}
