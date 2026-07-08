import { NextResponse } from 'next/server'
import { disconnect } from '../../../utils/qbo'
import { sessionRole } from '../../../utils/staff-gate'

// Phase 6 §6: revoke the QBO connection (best-effort revoke at Intuit, local
// status flips to disconnected). Pending sync rows stay queued and drain on
// the next connect. Admin-only.
export async function POST() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  await disconnect()
  return NextResponse.json({ ok: true })
}
