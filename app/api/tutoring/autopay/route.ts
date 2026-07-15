import { NextResponse } from 'next/server'
import { verifyAutopayToken } from '../../../utils/tutoring-billing'
import { createAutopaySetupSession } from '../../../utils/tutoring-stripe'

// Start the Stripe setup-mode Checkout for autopay (Phase 7c). Signed-link
// authenticated; the webhook (checkout.session.completed, mode=setup) saves
// the payment method and flips families.autopay on.

export async function POST(req: Request) {
  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const familyId = body.token ? verifyAutopayToken(body.token) : null
  if (!familyId) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })

  try {
    const url = await createAutopaySetupSession(familyId)
    return NextResponse.json({ ok: true, url })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('autopay setup session failed:', message)
    return NextResponse.json({ error: 'Could not start the save-a-card flow — please try again.' }, { status: 500 })
  }
}
