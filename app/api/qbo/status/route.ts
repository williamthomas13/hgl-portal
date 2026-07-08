import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { loadConnection, loadItemMap, qboEnvironment } from '../../../utils/qbo'
import { sessionRole } from '../../../utils/staff-gate'

// Connection health + mapping summary for the admin QuickBooks panel and the
// roster badges (Phase 6 §8). Staff-readable; tokens never leave the server.
export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const conn = await loadConnection()
  const itemMap = await loadItemMap()

  const { count: pending } = await supabase
    .from('qbo_sync_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  const { count: failed } = await supabase
    .from('qbo_sync_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')

  const environment = qboEnvironment()
  return NextResponse.json({
    configured: Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET),
    environment,
    // Doc deep links for the ✓ badges (…/app/salesreceipt?txnId={qbo_doc_id}).
    appHost:
      environment === 'production' ? 'https://app.qbo.intuit.com' : 'https://app.sandbox.qbo.intuit.com',
    status: conn?.status ?? 'disconnected',
    realmName: conn?.realm_name ?? null,
    connectedBy: conn?.connected_by ?? null,
    connectedAt: conn?.connected_at ?? null,
    itemMap,
    pendingCount: pending ?? 0,
    failedCount: failed ?? 0,
    callerRole: caller.role,
  })
}
