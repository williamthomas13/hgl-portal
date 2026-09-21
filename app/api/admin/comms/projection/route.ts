import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { projectSends } from '../../../../utils/send-projection'

// PL-471 D: the every-audience send projection behind the Scheduled view —
// "what will the next N hours' sweeps send?" for instructors, school
// contacts, staff alerts, timecards and calendar writes (families are the
// Feature-A rows already on the tab). Read-only; nothing here sends.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(req.url)
  const hours = Math.min(24 * 14, Math.max(1, Number(url.searchParams.get('hours') ?? 24) || 24))
  const classId = url.searchParams.get('class') ?? undefined
  try {
    const report = await projectSends({ hours, classId })
    return NextResponse.json(report)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
