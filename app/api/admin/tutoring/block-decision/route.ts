import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { recordBlockDecision } from '../../../../utils/block-confirm'

// PL-299/PL-323: the admin mirror action — the family answered by phone or
// email reply, and their CHOICE (5/10/15 more hours or monthly) rides along
// so the same reservation machinery runs. Staff, like the rest of the
// tutoring ops surface; recorded as via 'admin'.

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: {
    engagementId?: string
    decision?: 'confirmed' | 'declined'
    choice?: '5' | '10' | '15' | 'monthly'
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.engagementId || (body.decision !== 'confirmed' && body.decision !== 'declined')) {
    return NextResponse.json({ error: 'Pass the engagement and a decision.' }, { status: 400 })
  }
  const result = await recordBlockDecision(body.engagementId, body.decision, 'admin', body.choice)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    ...(result.outcome === 'reserved' ? { sessions: result.sessions } : {}),
  })
}
