import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { staffNameMap } from '../../../utils/staff-names'

// PL-395: the email→name map admin panels resolve attributions through
// (client components can't reach the service-role builder directly).

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  return NextResponse.json({ names: await staffNameMap() })
}
