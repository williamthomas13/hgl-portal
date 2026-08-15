import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { buildReportSnapshot, type SnapshotPeriodKind } from '../../../../utils/report-snapshot'
import { stripSnapshotRevenue } from '../../../../utils/term-report'
import { isPeriodKind } from '../../../../utils/report-period'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'

// PL-345: the dashboard's "This term at a glance" card. Composed from the
// PL-204 report + PL-218 hours + PL-333 preview (no recomputation); the
// manager payload never carries dollar fields — stripped HERE, server-side,
// same rule as /api/admin/report.
//
// PL-347: ?period=<kind> computes the snapshot through that lens; with no
// param the caller's persisted preference (staff_prefs key
// 'report_snapshot_period') decides, defaulting to all-time — the classic
// PL-345 card. POST persists the preference. Both pref touches tolerate the
// staff_prefs table not existing yet (the migration can land later).

const PREF_KEY = 'report_snapshot_period'

function asSnapshotKind(v: unknown): SnapshotPeriodKind | null {
  return isPeriodKind(v) && v !== 'custom' ? v : null
}

export async function GET(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let period = asSnapshotKind(new URL(request.url).searchParams.get('period'))
  if (!period) {
    try {
      const { data } = await supabase
        .from('staff_prefs')
        .select('value')
        .eq('email', caller.email.toLowerCase())
        .eq('key', PREF_KEY)
        .maybeSingle()
      period = asSnapshotKind(data?.value)
    } catch {
      // table not there yet — the default lens is the honest fallback
    }
  }

  const snapshot = await buildReportSnapshot(new Date(), period ?? 'all-time')
  return NextResponse.json(caller.role === 'admin' ? snapshot : stripSnapshotRevenue(snapshot))
}

/** Persist the caller's period lens: { period: 'this-quarter' }. */
export async function POST(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const period = asSnapshotKind(body?.period)
  if (!period) return NextResponse.json({ error: 'Unknown period.' }, { status: 400 })
  try {
    const { error } = await supabase.from('staff_prefs').upsert({
      email: caller.email.toLowerCase(),
      key: PREF_KEY,
      value: period,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
  } catch {
    // staff_prefs not migrated yet — the lens still applies for this visit,
    // it just won't stick. Say so honestly.
    return NextResponse.json({ ok: false, note: 'Preference storage is not set up yet — this choice applies now but won’t persist.' })
  }
  return NextResponse.json({ ok: true, period })
}
