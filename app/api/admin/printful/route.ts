import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { submitPrintfulOrder } from '../../../utils/printful'

// PL-364: the retry button behind a failed notebook order — re-runs the
// same idempotent push (external_id = the row id, so a half-created Printful
// order is adopted, never duplicated).

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (body?.action !== 'retry' || typeof body?.orderId !== 'string') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  const result = await submitPrintfulOrder(body.orderId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'The push failed again — see the order row.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
