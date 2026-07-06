import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from "../../../utils/supabase-admin"
import { createHmac, timingSafeEqual } from 'crypto'

// Resend delivery-event webhook. Configure in the Resend dashboard →
// Webhooks → endpoint https://hgl-portal.vercel.app/api/webhooks/resend,
// subscribed to email.bounced and email.complained; put the signing secret
// (whsec_…) in RESEND_WEBHOOK_SECRET.
//
// Resend signs webhooks Svix-style: HMAC-SHA256 over "{id}.{timestamp}.{body}"
// with the base64-decoded secret, carried in svix-id / svix-timestamp /
// svix-signature headers. Verified manually here — no extra dependency.

export const runtime = 'nodejs'

const TOLERANCE_SECONDS = 5 * 60

function verifySvixSignature(headers: Headers, body: string, secret: string): boolean {
  const id = headers.get('svix-id')
  const timestamp = headers.get('svix-timestamp')
  const signatures = headers.get('svix-signature')
  if (!id || !timestamp || !signatures) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  const expectedBuf = Buffer.from(expected)

  // Header may carry several space-delimited "v1,<sig>" entries.
  return signatures.split(' ').some((part) => {
    const sig = part.startsWith('v1,') ? part.slice(3) : part
    const given = Buffer.from(sig)
    return given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf)
  })
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Refuse rather than accept unauthenticated events.
    return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET not configured' }, { status: 503 })
  }

  const body = await req.text()
  if (!verifySvixSignature(req.headers, body, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: {
    type?: string
    data?: {
      email_id?: string
      to?: string[] | string
      subject?: string
      bounce?: { type?: string; subType?: string; message?: string }
    }
  }
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (event.type === 'email.bounced' || event.type === 'email.complained') {
    const to = Array.isArray(event.data?.to) ? event.data?.to : [event.data?.to]
    for (const address of to ?? []) {
      if (!address) continue
      const { error } = await supabase.from('email_events').insert([
        {
          event_type: event.type,
          email_address: String(address).toLowerCase(),
          subject: event.data?.subject ?? null,
          resend_email_id: event.data?.email_id ?? null,
          bounce_type: event.data?.bounce?.type ?? null,
          payload: event.data ?? null,
        },
      ])
      if (error) console.error('Failed to store email event:', error.message)
    }
  }

  return NextResponse.json({ received: true })
}
