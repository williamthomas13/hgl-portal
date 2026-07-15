import { NextResponse, after } from 'next/server'
import {
  confirmInvoice,
  requestChanges,
  verifyProposalToken,
  after7cConfirm,
} from '../../../utils/tutoring-billing'
import { issueOrCharge } from '../../../utils/tutoring-stripe'

// Public proposal actions (Phase 7c §6.2), authenticated by the signed link
// token — same trust model as waitlist-claim links. Confirm flips the
// month's sessions live (Google push) and hands the invoice to the payment
// leg; request-changes pauses the auto-confirm clock and pings the Ops
// Director.

export async function POST(req: Request) {
  let body: { token?: string; action?: 'confirm' | 'request_changes'; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const invoiceId = body.token ? verifyProposalToken(body.token) : null
  if (!invoiceId) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })

  if (body.action === 'confirm') {
    const res = await confirmInvoice(invoiceId, 'parent')
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    // Return the promise: after() only keeps the lambda alive for work it
    // can see. after7cConfirm covers the gcal drain AND issueOrCharge (the
    // registered follow-up) — importing tutoring-stripe here registers it.
    void issueOrCharge
    after(() => after7cConfirm(invoiceId))
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'request_changes') {
    if (!body.note?.trim()) return NextResponse.json({ error: 'Tell us what to change.' }, { status: 400 })
    const res = await requestChanges(invoiceId, body.note.slice(0, 2000))
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
