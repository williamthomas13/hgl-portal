import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { processGcalQueue } from '../../../utils/gcal-sync'
import { sessionRole } from '../../../utils/staff-gate'

// Manual "Retry push" for failed calendar syncs (§4: admin alert points
// here). Staff — ops action, same rule as QBO retry.
// Body: { ids: [...] } for specific rows, or { allFailed: true } for bulk.
export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { ids?: string[]; allFailed?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const reset = {
    status: 'pending',
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
    last_error: null,
  }
  let query = supabase.from('gcal_sync_log').update(reset).eq('status', 'failed')
  if (body.allFailed) {
    // no further filter
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    query = query.in('id', body.ids)
  } else {
    return NextResponse.json({ error: 'Pass ids or allFailed.' }, { status: 400 })
  }
  const { data, error } = await query.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = await processGcalQueue()
  return NextResponse.json({ ok: true, reset: data?.length ?? 0, ...result })
}
