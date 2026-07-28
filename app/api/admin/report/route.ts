import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { loadTermReport, stripRevenue } from '../../../utils/term-report'

// PL-204: revenue & enrollment report. Role split enforced HERE: the manager
// response never carries a dollar field (stripRevenue removes them from the
// payload — the standing role-gating rule: absent, not hidden in the UI).
// Counselor/tutor/parent roles get nothing (sessionRole returns null).

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const report = await loadTermReport()
  return NextResponse.json(caller.role === 'admin' ? report : stripRevenue(report))
}
