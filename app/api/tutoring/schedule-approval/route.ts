import { NextResponse, after } from 'next/server'
import { processGcalQueue } from '../../../utils/gcal-sync'
import {
  activatePendingEngagement,
  declineEngagement,
  verifyScheduleApproveToken,
} from '../../../utils/schedule-approval'

// PL-41: the parent's one-click schedule confirmation (or "different times
// please"). Authenticated by the signed link token — same trust model as the
// proposal/autopay links. Approve → sessions confirm and push to the tutor's
// calendar, welcome email fires; decline → stays pending, Ops Director
// alerted with the note. Never auto-approves anywhere.

export async function POST(req: Request) {
  let body: { token?: string; action?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const engagementId = typeof body.token === 'string' ? verifyScheduleApproveToken(body.token) : null
  if (!engagementId) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  }

  if (body.action === 'approve') {
    const result = await activatePendingEngagement(engagementId, 'parent')
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    after(() => processGcalQueue())
    return NextResponse.json({ ok: true, already: result.already ?? false })
  }

  if (body.action === 'decline') {
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) || null : null
    await declineEngagement(engagementId, note)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
