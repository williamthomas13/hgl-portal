import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { computeSystemHealth } from '../../../utils/system-health'

// PL-331: the Settings → System health section's data — the same three
// numbers the admin dashboard card shows, from the same computation
// (utils/system-health.ts), so the two surfaces can never disagree.
export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const { health } = await computeSystemHealth(new Date())
  return NextResponse.json({ health })
}
