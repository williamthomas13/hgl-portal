import { NextResponse } from 'next/server'
import { verifyStandardWebhook, normalizeQuoEvent, processCallEvent, quoEnabled } from '../../../utils/quo'

// PL-202: the Quo webhook receiver. Standard-Webhooks signature verified
// FAIL-CLOSED (no secret configured → nothing is accepted, per the standing
// secrets rule); the payload is normalized to the internal call-event shape
// at the door so nothing downstream knows Quo exists. While the enable
// switch is off (configuration ≠ activation), deliveries are acknowledged
// and dropped — Quo shouldn't retry-storm a deliberately-dark integration.

export async function POST(req: Request) {
  const secret = process.env.QUO_WEBHOOK_SECRET
  if (!secret) {
    console.error('quo webhook hit but QUO_WEBHOOK_SECRET is unset — refusing (fail closed)')
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }
  const payload = await req.text()
  const ok = verifyStandardWebhook({
    id: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signatureHeader: req.headers.get('webhook-signature'),
    payload,
    secret,
  })
  if (!ok) return NextResponse.json({ error: 'Bad signature.' }, { status: 401 })

  if (!(await quoEnabled())) return NextResponse.json({ ok: true, ignored: 'integration not enabled yet' })

  let body: unknown
  try {
    body = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const ev = normalizeQuoEvent(body)
  if (!ev) return NextResponse.json({ ok: true, ignored: 'event type not handled in v1' })

  try {
    const result = await processCallEvent(ev)
    return NextResponse.json(result)
  } catch (e) {
    console.error('quo event processing failed:', e)
    // 500 → Quo redelivers; provider_event_id dedupe makes that safe.
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 })
  }
}
