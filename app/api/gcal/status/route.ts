import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { loadGcalConnection } from '../../../utils/gcal'
import { sessionRole } from '../../../utils/staff-gate'

// Connection health + queue counts for the Google Calendar panel on
// /admin/tutoring (Phase 7a §4). Staff-readable; the key never leaves the
// server — this endpoint is the only window onto gcal_connection.
export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const conn = await loadGcalConnection()

  const { count: pending } = await supabase
    .from('gcal_sync_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  const { count: failed } = await supabase
    .from('gcal_sync_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')

  return NextResponse.json({
    status: conn?.status ?? 'disconnected',
    clientEmail: conn?.clientEmail ?? null,
    connectedBy: conn?.connectedBy ?? null,
    connectedAt: conn?.connectedAt ?? null,
    pendingCount: pending ?? 0,
    failedCount: failed ?? 0,
    callerRole: caller.role,
  })
}
