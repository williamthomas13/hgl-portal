import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { recordBlockDecision } from '../../../../utils/block-confirm'

// PL-299: the admin mirror action — "family confirmed — convert to monthly"
// (or declined) for answers that arrive by phone or email reply. Staff, like
// the rest of the tutoring ops surface; recorded as via 'admin'.

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { engagementId?: string; decision?: 'confirmed' | 'declined' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.engagementId || (body.decision !== 'confirmed' && body.decision !== 'declined')) {
    return NextResponse.json({ error: 'Pass the engagement and a decision.' }, { status: 400 })
  }
  const result = await recordBlockDecision(body.engagementId, body.decision, 'admin')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
