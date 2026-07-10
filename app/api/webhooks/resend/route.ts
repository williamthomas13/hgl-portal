import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from "../../../utils/supabase-admin"
import { createHmac, timingSafeEqual } from 'crypto'

// Resend delivery-event webhook. Configure in the Resend dashboard →
// Webhooks → endpoint https://hgl-portal.vercel.app/api/webhooks/resend,
// subscribed to email.sent, email.delivered, email.opened, email.clicked,
// email.bounced, email.complained; put the signing secret (whsec_…) in
// RESEND_WEBHOOK_SECRET. Open/click tracking must also be enabled on the
// sending domain (Resend dashboard → Domains) for those events to fire.
//
// Feature A2 (docs/COMMS_ATTENDANCE_PARENT_SPEC.md): every event updates the
// matching email_sends row by resend_email_id — delivered/opened/clicked
// upgrade engagement fields; bounced/complained flip the status. The
// email_events table keeps its bounce/complaint feed (the Monday roster
// report reads it).
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

  // Engagement tracking onto the canonical send log (spec §A2).
  const emailId = event.data?.email_id
  if (emailId && event.type?.startsWith('email.')) {
    const nowIso = new Date().toISOString()
    const { data: row } = await supabase
      .from('email_sends')
      .select('id, status, open_count, click_count, first_opened_at, first_clicked_at')
      .eq('resend_email_id', emailId)
      .maybeSingle()
    if (row) {
      // 'sent' may be upgraded; bounce/complaint always win; opens/clicks
      // never downgrade a bounce (events can arrive out of order).
      const patch: Record<string, unknown> = { updated_at: nowIso }
      switch (event.type) {
        case 'email.delivered':
          patch.delivered_at = nowIso
          if (row.status === 'sent') patch.status = 'delivered'
          break
        case 'email.opened':
          patch.open_count = (row.open_count ?? 0) + 1
          if (!row.first_opened_at) patch.first_opened_at = nowIso
          break
        case 'email.clicked':
          patch.click_count = (row.click_count ?? 0) + 1
          if (!row.first_clicked_at) patch.first_clicked_at = nowIso
          break
        case 'email.bounced':
          patch.status = 'bounced'
          patch.bounced_at = nowIso
          break
        case 'email.complained':
          patch.status = 'complained'
          break
      }
      if (Object.keys(patch).length > 1) {
        const { error } = await supabase.from('email_sends').update(patch).eq('id', row.id)
        if (error) console.error('email_sends engagement update failed:', error.message)
      }
    }
  }

  return NextResponse.json({ received: true })
}
