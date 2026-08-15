import { loadTermReport, type ReportSnapshot, type SnapshotPeriodFigures } from './term-report'
import { loadTutorHoursReport } from './tutor-hours-report'
import { loadCycleSettings, previewMonthlyCycle } from './tutoring-billing'
import { denverMonth, monthInPeriod, resolvePeriod, type PeriodKind } from './report-period'

// PL-345: compose the dashboard snapshot from the EXISTING machinery — the
// PL-204 term report (paid columns = what QBO sync reads), the PL-218
// tutor-hours report (payable rules), and the PL-333 generation preview.
// Zero new revenue math. Lives apart from term-report.ts on purpose: the
// regress:report harness compiles that file standalone, and this one pulls
// the heavier billing graph.
//
// PL-347: the snapshot can now be computed through a period lens. 'all-time'
// (the default) produces byte-for-byte the classic PL-345 card figures; any
// other kind ADDITIONALLY sums the report's own month-keyed rows into
// periodFigures + previousFigures — reusing the exact same payload fields
// the report page renders, never recomputing dollars.

/** The card's lens choices — the report page's 'custom' range never reaches
 *  here (the mini selector doesn't offer it). */
export type SnapshotPeriodKind = Exclude<PeriodKind, 'custom'>

export async function buildReportSnapshot(
  now: Date = new Date(),
  periodKind: SnapshotPeriodKind = 'all-time'
): Promise<ReportSnapshot> {
  const thisMonth = denverMonth(now)
  const period = resolvePeriod(periodKind, { now })
  // For a period lens, one tutor-hours call spans previous-twin start →
  // period end; totalsByMonth then serves both windows (and the this-month
  // figure when the span covers it). All period kinds span ≤ 24 months,
  // safely under the report's 36-month cap.
  const spanFrom = period.previous?.fromMonth ?? thisMonth
  const spanTo = period.toMonth ?? thisMonth
  const needsSeparateThisMonth =
    periodKind === 'all-time' || thisMonth < spanFrom || thisMonth > spanTo

  const [report, spanHours, thisMonthHours, preview, settings] = await Promise.all([
    loadTermReport(),
    periodKind === 'all-time'
      ? null
      : loadTutorHoursReport({ tutorId: 'all', fromMonth: spanFrom, toMonth: spanTo }),
    needsSeparateThisMonth
      ? loadTutorHoursReport({ tutorId: 'all', fromMonth: thisMonth, toMonth: thisMonth })
      : null,
    previewMonthlyCycle(now),
    loadCycleSettings(),
  ])

  const hoursThisMonth = thisMonthHours
    ? thisMonthHours.grandTotalHours
    : Number((spanHours?.totalsByMonth[thisMonth] ?? 0).toFixed(2))

  // Sum the report's own month-keyed rows over a bounds pair — the same
  // fields the report page renders, nothing recomputed.
  const figuresFor = (bounds: { fromMonth: string | null; toMonth: string | null }): SnapshotPeriodFigures => {
    const inP = (m: string) => monthInPeriod(m, bounds)
    const enrolled = Object.entries(report.enrolledByMonth)
      .filter(([m]) => inP(m))
      .reduce((s, [, n]) => s + n, 0)
    const hours = spanHours
      ? Number(
          Object.entries(spanHours.totalsByMonth)
            .filter(([m]) => inP(m))
            .reduce((s, [, h]) => s + h, 0)
            .toFixed(2)
        )
      : 0
    const revenue =
      report.classes.filter((c) => inP(c.month)).reduce((s, c) => s + (c.revenue ?? 0), 0) +
      report.tutoringByMonth.filter((t) => inP(t.month)).reduce((s, t) => s + (t.revenue ?? 0), 0) +
      report.packages.filter((p) => inP(p.month)).reduce((s, p) => s + (p.revenue ?? 0), 0)
    return { enrolled, hours, revenue: Number(revenue.toFixed(2)) }
  }

  return {
    role: 'admin',
    enrolledAllTime: report.classes.reduce((s, c) => s + c.enrolled, 0),
    enrolledThisMonth: report.enrolledThisMonth,
    activeEngagements: report.activeEngagements,
    hoursThisMonth,
    monthLabel: new Date(`${thisMonth}-01T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      timeZone: 'UTC',
    }),
    period: {
      kind: period.kind,
      label: period.label,
      previousLabel: period.previous?.label ?? null,
    },
    ...(periodKind === 'all-time'
      ? {}
      : {
          periodFigures: figuresFor(period),
          previousFigures: period.previous ? figuresFor(period.previous) : undefined,
        }),
    revenue: report.totals
      ? {
          classes: report.totals.classRevenue,
          tutoring: report.totals.tutoringRevenue,
          packages: report.totals.packageRevenue,
          grand: report.totals.grand,
        }
      : undefined,
    projection: {
      total: Number(preview.rows.reduce((s, r) => s + r.projectedTotal, 0).toFixed(2)),
      monthLabel: preview.monthLabel,
      generateDay: settings.generateDay,
    },
  }
}
