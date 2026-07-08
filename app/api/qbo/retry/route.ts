import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { processQboQueue } from '../../../utils/qbo-sync'
import { sessionRole } from '../../../utils/staff-gate'

// Manual "Retry sync" (spec §1, §8): reset failed rows to pending and run the
// worker right away. Staff — retrying is an ops action, not configuration.
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
  let query = supabase.from('qbo_sync_log').update(reset).eq('status', 'failed')
  if (body.allFailed) {
    // no further filter
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    query = query.in('id', body.ids)
  } else {
    return NextResponse.json({ error: 'Pass ids or allFailed.' }, { status: 400 })
  }
  const { data, error } = await query.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = await processQboQueue()
  return NextResponse.json({ ok: true, reset: data?.length ?? 0, ...result })
}
