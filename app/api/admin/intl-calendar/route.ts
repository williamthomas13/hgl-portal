import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import {
  auditInternationalCalendar,
  intlCalendarConfig,
  reconcileInternationalCalendar,
  syncInternationalCalendar,
} from '../../../utils/intl-calendar'

// PL-161: the International Classes calendar controls — configure which
// shared calendar the portal manages, run the one-time reconciliation of
// hand-made events (report, never delete), force a sync, or run the drift
// audit on demand. The daily cron runs sync + audit automatically.

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const config = await intlCalendarConfig()
  return NextResponse.json({ config })
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  let body: { action?: string; calendarId?: string; owner?: string; classId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (body.action === 'configure') {
    const calendarId = (body.calendarId ?? '').trim()
    if (!calendarId) return NextResponse.json({ error: 'Pass the shared calendar id.' }, { status: 400 })
    const rows = [
      { key: 'intl_classes_calendar_id', value: calendarId, updated_at: new Date().toISOString() },
      ...(body.owner?.trim()
        ? [{ key: 'intl_classes_calendar_owner', value: body.owner.trim(), updated_at: new Date().toISOString() }]
        : []),
    ]
    const { error } = await supabase.from('app_settings').upsert(rows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'sync') {
    return NextResponse.json({ ok: true, result: await syncInternationalCalendar(body.classId) })
  }
  if (body.action === 'reconcile') {
    return NextResponse.json({ ok: true, result: await reconcileInternationalCalendar() })
  }
  if (body.action === 'audit') {
    return NextResponse.json({ ok: true, result: await auditInternationalCalendar() })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
