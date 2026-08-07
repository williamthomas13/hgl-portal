import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'

// PL-298: dismiss a FAILED sync row with a reason (some failures are correct
// outcomes — a $0 invoice has nothing to post), or reinstate a dismissed one
// back to failed. Staff, like retry — an ops action, not configuration.

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { id?: string; reason?: string; action?: 'dismiss' | 'reinstate' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'Pass the sync row id.' }, { status: 400 })

  if (body.action === 'reinstate') {
    const { data, error } = await supabase
      .from('qbo_sync_log')
      .update({ status: 'failed', dismissed_reason: null, dismissed_by: null, dismissed_at: null })
      .eq('id', body.id)
      .eq('status', 'dismissed')
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'That row is not dismissed.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  const reason = (body.reason ?? '').trim()
  if (!reason) {
    return NextResponse.json(
      { error: 'Say why — the reason shows in the sync log so nobody re-investigates.' },
      { status: 400 }
    )
  }
  const { data, error } = await supabase
    .from('qbo_sync_log')
    .update({
      status: 'dismissed',
      dismissed_reason: reason.slice(0, 500),
      dismissed_by: caller.email,
      dismissed_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .eq('status', 'failed')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Only failed rows can be dismissed.' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
