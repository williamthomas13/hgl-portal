import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { buildReportSnapshot } from '../../../../utils/report-snapshot'
import { stripSnapshotRevenue } from '../../../../utils/term-report'

// PL-345: the dashboard's "This term at a glance" card. Composed from the
// PL-204 report + PL-218 hours + PL-333 preview (no recomputation); the
// manager payload never carries dollar fields — stripped HERE, server-side,
// same rule as /api/admin/report.
export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const snapshot = await buildReportSnapshot()
  return NextResponse.json(caller.role === 'admin' ? snapshot : stripSnapshotRevenue(snapshot))
}
