import { loadTermReport, type ReportSnapshot } from './term-report'
import { loadTutorHoursReport } from './tutor-hours-report'
import { loadCycleSettings, previewMonthlyCycle } from './tutoring-billing'

// PL-345: compose the dashboard snapshot from the EXISTING machinery — the
// PL-204 term report (paid columns = what QBO sync reads), the PL-218
// tutor-hours report (payable rules), and the PL-333 generation preview.
// Zero new revenue math. Lives apart from term-report.ts on purpose: the
// regress:report harness compiles that file standalone, and this one pulls
// the heavier billing graph.

export async function buildReportSnapshot(now: Date = new Date()): Promise<ReportSnapshot> {
  const thisMonth = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }).slice(0, 7)
  const [report, hours, preview, settings] = await Promise.all([
    loadTermReport(),
    loadTutorHoursReport({ tutorId: 'all', fromMonth: thisMonth, toMonth: thisMonth }),
    previewMonthlyCycle(now),
    loadCycleSettings(),
  ])
  return {
    role: 'admin',
    enrolledAllTime: report.classes.reduce((s, c) => s + c.enrolled, 0),
    enrolledThisMonth: report.enrolledThisMonth,
    activeEngagements: report.activeEngagements,
    hoursThisMonth: hours.grandTotalHours,
    monthLabel: new Date(`${thisMonth}-01T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      timeZone: 'UTC',
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
