import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'

const KEYS = new Set(['group_class', 'tutoring_addon', 'deposit_account'])

// Save one item-map entry (spec §3). Admin-only — this decides which income
// accounts revenue posts to (via the QBO Items' own account assignment).
export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { key?: string; qboId?: string; qboName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const key = (body.key ?? '').trim()
  const qboId = (body.qboId ?? '').trim()
  if (!KEYS.has(key) || !qboId) {
    return NextResponse.json({ error: 'Missing or unknown mapping key/id.' }, { status: 400 })
  }

  const { error } = await supabase.from('qbo_item_map').upsert([
    { key, qbo_id: qboId, qbo_name: (body.qboName ?? '').trim() || null, updated_at: new Date().toISOString() },
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
