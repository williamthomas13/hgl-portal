import { supabaseAdmin as supabase } from './supabase-admin'

// PL-204: the "how's this term going" report. QBO stays the accounting
// truth — every dollar here is COMPUTED FROM THE SAME PAID COLUMNS the QBO
// sync reads (class_price_paid ?? classes.price for the class component,
// enrollment_addons.price_paid for packages, paid tutoring_invoices.total),
// so portal-report vs QBO can't structurally disagree. Role split (Scarlett,
// Jul 29): AGGREGATE revenue is admin-only; managers get the enrollment
// view — and the manager payload NEVER CARRIES dollar fields (stripped
// server-side by stripRevenue, not hidden in the UI). Per-family money
// elsewhere (invoices, profiles, billing panel) is untouched for managers.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export type ReportClassRow = {
  id: string
  school: string
  classType: string
  month: string // YYYY-MM of start_date
  startDate: string | null
  status: string
  enrolled: number
  capacity: number | null
  minEnrollment: number | null
  revenue?: number
}

export type TermReport = {
  role: 'admin' | 'manager'
  classes: ReportClassRow[]
  tutoringByMonth: { month: string; invoicesPaid: number; revenue?: number }[]
  packages: { month: string; sold: number; hours: number; exhausted: number; revenue?: number }[]
  activeEngagements: number
  /** PL-345: paid, non-refunded enrollments whose enrolled_at falls in the
   *  current Denver month — the snapshot card's "+N this month" delta. A
   *  COUNT (manager-safe), computed in the same pass as everything else. */
  enrolledThisMonth: number
  /** PL-347: the same paid/refund-filtered enrollments COUNTED per Denver
   *  month of enrolled_at — what lets any reporting period sum enrollments
   *  without new queries. Counts only (manager-safe). */
  enrolledByMonth: Record<string, number>
  totals?: { classRevenue: number; tutoringRevenue: number; packageRevenue: number; grand: number }
}

const PAID_STATUSES = ['Paid', 'Completed']

/** Everything, dollars included — call stripRevenue before handing to a manager. */
export async function loadTermReport(): Promise<TermReport> {
  const [classesRes, enrRes, invRes, addonRes, engRes] = await Promise.all([
    supabase
      .from('classes')
      .select('id, class_type, start_date, status, capacity, min_enrollment, price, schools ( nickname, name )'),
    supabase
      .from('enrollments')
      .select('id, class_id, payment_status, class_price_paid, cancellation_outcome, enrolled_at, classes ( price )'),
    supabase.from('tutoring_invoices').select('id, period, status, total, paid_at').eq('status', 'paid'),
    supabase
      .from('enrollment_addons')
      .select('id, hours, price_paid, purchased_at, tutoring_engagements ( id )'),
    supabase.from('tutoring_engagements').select('id').eq('status', 'active'),
  ])

  // Package exhaustion needs the drawdown — same consuming rule as billing.
  const addons = (addonRes.data as any[]) ?? []
  const addonEngIds = addons
    .flatMap((a) => (Array.isArray(a.tutoring_engagements) ? a.tutoring_engagements : [a.tutoring_engagements]))
    .filter(Boolean)
    .map((e: any) => e.id)
  const usedByEng = new Map<string, number>()
  if (addonEngIds.length > 0) {
    const { data: consuming } = await supabase
      .from('tutoring_sessions')
      .select('engagement_id, duration_minutes, status, reschedule_notice')
      .in('engagement_id', addonEngIds)
      .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
    for (const s of (consuming as any[]) ?? []) {
      if (s.status === 'rescheduled' && s.reschedule_notice !== 'late') continue
      usedByEng.set(s.engagement_id, (usedByEng.get(s.engagement_id) ?? 0) + s.duration_minutes / 60)
    }
  }

  // Paid, non-refunded enrollments per class + class-component revenue
  // (PL-142 rule: snapshot first, class list price as legacy fallback).
  const byClass = new Map<string, { enrolled: number; revenue: number }>()
  const thisDenverMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }).slice(0, 7)
  let enrolledThisMonth = 0
  const enrolledByMonth: Record<string, number> = {}
  for (const e of ((enrRes.data as any[]) ?? [])) {
    if (!PAID_STATUSES.includes(e.payment_status)) continue
    if (e.cancellation_outcome === 'refunded' || e.cancellation_outcome === 'refund_requested') continue
    const entry = byClass.get(e.class_id) ?? { enrolled: 0, revenue: 0 }
    entry.enrolled++
    entry.revenue += Number(e.class_price_paid ?? one<any>(e.classes)?.price ?? 0)
    byClass.set(e.class_id, entry)
    // PL-345/347: the same paid/refund rules drive the per-month counts.
    if (e.enrolled_at) {
      const m = new Date(e.enrolled_at).toLocaleDateString('en-CA', { timeZone: 'America/Denver' }).slice(0, 7)
      enrolledByMonth[m] = (enrolledByMonth[m] ?? 0) + 1
      if (m === thisDenverMonth) enrolledThisMonth++
    }
  }

  const classes: ReportClassRow[] = (((classesRes.data as any[]) ?? []) as any[]).map((c) => {
    const school = one<any>(c.schools)
    const agg = byClass.get(c.id) ?? { enrolled: 0, revenue: 0 }
    return {
      id: c.id,
      school: school?.nickname ?? school?.name ?? '—',
      classType: c.class_type,
      month: String(c.start_date ?? '').slice(0, 7) || 'unscheduled',
      startDate: c.start_date,
      status: c.status,
      enrolled: agg.enrolled,
      capacity: c.capacity != null ? Number(c.capacity) : null,
      minEnrollment: c.min_enrollment != null ? Number(c.min_enrollment) : null,
      revenue: Number(agg.revenue.toFixed(2)),
    }
  })

  const tutoringMap = new Map<string, { invoicesPaid: number; revenue: number }>()
  for (const inv of ((invRes.data as any[]) ?? [])) {
    const month = String(inv.period).slice(0, 7)
    const entry = tutoringMap.get(month) ?? { invoicesPaid: 0, revenue: 0 }
    entry.invoicesPaid++
    entry.revenue += Number(inv.total)
    tutoringMap.set(month, entry)
  }
  const tutoringByMonth = [...tutoringMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, v]) => ({ month, invoicesPaid: v.invoicesPaid, revenue: Number(v.revenue.toFixed(2)) }))

  const pkgMap = new Map<string, { sold: number; hours: number; exhausted: number; revenue: number }>()
  for (const a of addons) {
    const month = String(a.purchased_at ?? '').slice(0, 7) || 'unknown'
    const entry = pkgMap.get(month) ?? { sold: 0, hours: 0, exhausted: 0, revenue: 0 }
    entry.sold++
    entry.hours += Number(a.hours)
    entry.revenue += Number(a.price_paid)
    const engs = (Array.isArray(a.tutoring_engagements) ? a.tutoring_engagements : [a.tutoring_engagements]).filter(Boolean)
    const used = engs.reduce((s: number, e: any) => s + (usedByEng.get(e.id) ?? 0), 0)
    if (used >= Number(a.hours)) entry.exhausted++
    pkgMap.set(month, entry)
  }
  const packages = [...pkgMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, v]) => ({ ...v, month, revenue: Number(v.revenue.toFixed(2)) }))

  const classRevenue = classes.reduce((s, c) => s + (c.revenue ?? 0), 0)
  const tutoringRevenue = tutoringByMonth.reduce((s, t) => s + (t.revenue ?? 0), 0)
  const packageRevenue = packages.reduce((s, p) => s + (p.revenue ?? 0), 0)

  return {
    role: 'admin',
    classes,
    tutoringByMonth,
    packages,
    activeEngagements: ((engRes.data as any[]) ?? []).length,
    enrolledThisMonth,
    enrolledByMonth,
    totals: {
      classRevenue: Number(classRevenue.toFixed(2)),
      tutoringRevenue: Number(tutoringRevenue.toFixed(2)),
      packageRevenue: Number(packageRevenue.toFixed(2)),
      grand: Number((classRevenue + tutoringRevenue + packageRevenue).toFixed(2)),
    },
  }
}

/**
 * The manager payload: every dollar field REMOVED (absent, not hidden).
 * Anything money-shaped that gets added to the report later must be added to
 * this strip list — the regression gate deep-scans the output for stragglers.
 */
export function stripRevenue(report: TermReport): TermReport {
  return {
    role: 'manager',
    classes: report.classes.map(({ revenue: _r, ...rest }) => rest),
    tutoringByMonth: report.tutoringByMonth.map(({ revenue: _r, ...rest }) => rest),
    packages: report.packages.map(({ revenue: _r, ...rest }) => rest),
    activeEngagements: report.activeEngagements,
    enrolledThisMonth: report.enrolledThisMonth, // a count — manager-safe
    enrolledByMonth: report.enrolledByMonth, // counts — manager-safe
    // no totals key at all
  }
}

// ---------------------------------------------------------------------------
// PL-345: the dashboard's "This term at a glance" snapshot — composed FROM
// the machinery above (plus the tutor-hours report and the PL-333 preview),
// never recomputed. PREMISE NOTE: no term boundary exists anywhere in the
// system — the report is all-time and its own card says "All-time totals" —
// so the snapshot's enrollment/revenue figures mirror that truthfully; when
// a term concept lands, both surfaces move together.
// ---------------------------------------------------------------------------

/** PL-347: the numbers a period lens speaks about. `revenue` is ADMIN-ONLY
 *  and stripped server-side for managers, same rule as everything else. */
export type SnapshotPeriodFigures = {
  enrolled: number
  hours: number
  revenue?: number
}

export type ReportSnapshot = {
  role: 'admin' | 'manager'
  /** Paid, non-refunded enrollments (the report's own counting rules). */
  enrolledAllTime: number
  enrolledThisMonth: number
  activeEngagements: number
  hoursThisMonth: number
  /** "August" — the month the delta and hours speak about. */
  monthLabel: string
  /** PL-347: the lens this snapshot was computed through. 'all-time' renders
   *  the classic PL-345 card; any other kind renders periodFigures with
   *  deltas vs previousFigures ("↑ 3 vs Q2 2026"). */
  period?: { kind: string; label: string; previousLabel: string | null }
  periodFigures?: SnapshotPeriodFigures
  previousFigures?: SnapshotPeriodFigures
  /** ADMIN-ONLY — stripped server-side for managers. */
  revenue?: { classes: number; tutoring: number; packages: number; grand: number }
  projection?: { total: number; monthLabel: string; generateDay: number }
}

/** The manager snapshot: dollar fields ABSENT, not hidden (the PL-204 rule —
 *  the regression gate deep-scans this shape too). Period figures survive as
 *  counts and hours only. */
export function stripSnapshotRevenue(s: ReportSnapshot): ReportSnapshot {
  const stripFigures = (f: SnapshotPeriodFigures | undefined) =>
    f ? { enrolled: f.enrolled, hours: f.hours } : undefined
  return {
    role: 'manager',
    enrolledAllTime: s.enrolledAllTime,
    enrolledThisMonth: s.enrolledThisMonth,
    activeEngagements: s.activeEngagements,
    hoursThisMonth: s.hoursThisMonth,
    monthLabel: s.monthLabel,
    ...(s.period ? { period: s.period } : {}),
    ...(s.periodFigures ? { periodFigures: stripFigures(s.periodFigures) } : {}),
    ...(s.previousFigures ? { previousFigures: stripFigures(s.previousFigures) } : {}),
    // no revenue, no projection
  }
}
