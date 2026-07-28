import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { pushContactsToQuo, quoEnabled } from '../../../utils/quo'
import { emailBaseUrl } from '../../../utils/base-url'

// PL-202: the calls admin surface — setup status for the panel, the enable
// switch (configuration ≠ activation), the one-way contact push, and the
// missed-call dismiss (the needs-attention row's manual clear).

type Body =
  | { action: 'dismiss_missed'; id: string }
  | { action: 'set_enabled'; enabled: boolean }
  | { action: 'push_contacts' }

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const [{ count: total }, { count: last7 }, enabled] = await Promise.all([
    supabase.from('call_events').select('id', { count: 'exact', head: true }),
    supabase
      .from('call_events')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    quoEnabled(),
  ])
  return NextResponse.json({
    enabled,
    secretConfigured: !!process.env.QUO_WEBHOOK_SECRET,
    apiKeyConfigured: !!process.env.QUO_API_KEY,
    endpointUrl: `${emailBaseUrl()}/api/webhooks/quo`,
    events: { total: total ?? 0, last7: last7 ?? 0 },
  })
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (body.action === 'dismiss_missed') {
    // The dashboard row id is `missed-call-{event id}` — accept either form.
    const id = body.id.replace(/^missed-call-/, '')
    await supabase
      .from('call_events')
      .update({ dismissed_at: new Date().toISOString(), dismissed_by: caller.email })
      .eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_enabled') {
    // Admin-only: flipping an integration live is an owner-level act.
    if (caller.role !== 'admin') return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
    await supabase.from('app_settings').upsert({ key: 'quo_calls_enabled', value: body.enabled ? 'true' : 'false' })
    return NextResponse.json({ ok: true, enabled: body.enabled })
  }

  if (body.action === 'push_contacts') {
    const result = await pushContactsToQuo()
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
