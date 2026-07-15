import { NextResponse } from 'next/server'
import { disconnectGcal } from '../../../utils/gcal'
import { sessionRole } from '../../../utils/staff-gate'

// Mark the Google Calendar connection disconnected (admin-only, §4). Pending
// queue rows stay put and drain on reconnect — pushes pause, scheduling
// doesn't.
export async function POST() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  await disconnectGcal()
  return NextResponse.json({ ok: true })
}
