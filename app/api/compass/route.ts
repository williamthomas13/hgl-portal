import { NextResponse } from 'next/server'
import { subscribeCompass } from '../../utils/compass'
import { FORM_CORS_HEADERS } from '../../utils/embed-forms'
import { EMAIL_RE, ipThrottled, str } from '../../utils/public-forms'

// PL-477: College Prep Compass signup → marketing_subscribers. Consent is
// the form's own text (recorded as consented_at); the address is LINKED to
// an existing family/lead by email, never duplicated; an explicit re-signup
// by a previously-unsubscribed address lifts that person's OWN suppression
// (their action, recorded as source 'compass-resubscribed'). No welcome
// email is sent here — the Compass delivery/welcome content is Scarlett's
// (STOPPED in the ship note); nothing sends until a campaign targets
// subscribers.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: FORM_CORS_HEADERS })
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: FORM_CORS_HEADERS })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (str(body.company)) return json({ ok: true })
  if (ipThrottled(req)) return json({ error: 'Too many requests — please try again in a few minutes.' }, 429)
  const email = str(body.email, 200)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400)
  const firstName = str(body.firstName, 100)
  const roleRaw = str(body.role, 20)?.toLowerCase()
  const role = roleRaw === 'parent' || roleRaw === 'student' ? roleRaw : null
  const gradYear = str(body.gradYear, 10)
  const src = str(body.source, 100) ?? 'compass'

  // ONE path (PL-484 reuses it from the interest-list opt-in).
  const res = await subscribeCompass({ email, firstName, role, gradYear, source: src })
  if (!res.ok) {
    console.error('compass upsert failed:', res.error)
    return json({ error: 'That did not save — try again?' }, 500)
  }
  return json({ ok: true })
}
