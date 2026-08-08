import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { clearAlertSubscriberCache } from '../../../utils/email'
import {
  ALERT_CATEGORIES,
  MANAGER_DEFAULT_CATEGORIES,
  type AlertCategory,
} from '../../../utils/alert-categories'

// PL-309: the Settings → Notifications panel's API.
// Permissions: the admin grants/revokes categories for anyone and can
// toggle anything; a manager can toggle her OWN `enabled` inside categories
// an admin granted her — never self-grant. First load self-heals defaults:
// an admin profile with no rows gets everything ON (today's behavior); a
// manager profile with no rows gets the tutoring subset + close-match.

type Row = { email: string; category: string; granted: boolean; enabled: boolean }

async function seedDefaults(email: string, role: 'admin' | 'manager') {
  const { count } = await supabase
    .from('staff_alert_subscriptions')
    .select('email', { count: 'exact', head: true })
    .eq('email', email)
  if ((count ?? 0) > 0) return
  const cats =
    role === 'admin' ? ALERT_CATEGORIES.map((c) => c.key) : MANAGER_DEFAULT_CATEGORIES
  await supabase
    .from('staff_alert_subscriptions')
    .upsert(cats.map((category) => ({ email, category, granted: true, enabled: true })))
}

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const { data: profiles } = await supabase
    .from('profiles')
    .select('email, role')
    .in('role', ['admin', 'manager'])
  const staff = ((profiles as { email: string; role: 'admin' | 'manager' }[]) ?? []).map((p) => ({
    email: p.email.toLowerCase(),
    role: p.role,
  }))
  for (const s of staff) await seedDefaults(s.email, s.role)

  const { data: rows } = await supabase
    .from('staff_alert_subscriptions')
    .select('email, category, granted, enabled')
  const all = ((rows as Row[]) ?? []).map((r) => ({ ...r, email: r.email.toLowerCase() }))
  const mine = caller.email.toLowerCase()

  return NextResponse.json({
    role: caller.role,
    self: mine,
    categories: ALERT_CATEGORIES,
    staff: caller.role === 'admin' ? staff : staff.filter((s) => s.email === mine),
    rows: caller.role === 'admin' ? all : all.filter((r) => r.email === mine),
  })
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { email?: string; category?: string; granted?: boolean; enabled?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const category = body.category as AlertCategory | undefined
  if (!email || !category || !ALERT_CATEGORIES.some((c) => c.key === category)) {
    return NextResponse.json({ error: 'Pass an email and a known category.' }, { status: 400 })
  }

  if (caller.role !== 'admin') {
    // A manager: own row, enabled only, and only where granted.
    if (email !== caller.email.toLowerCase() || body.granted !== undefined) {
      return NextResponse.json(
        { error: 'You can switch your own granted categories on and off — granting is the admin’s.' },
        { status: 403 }
      )
    }
    const { data: row } = await supabase
      .from('staff_alert_subscriptions')
      .select('granted')
      .eq('email', email)
      .eq('category', category)
      .maybeSingle()
    if (!row?.granted) {
      return NextResponse.json(
        { error: 'That category isn’t granted to you — ask the admin to add it.' },
        { status: 403 }
      )
    }
    await supabase
      .from('staff_alert_subscriptions')
      .update({ enabled: body.enabled === true, updated_at: new Date().toISOString() })
      .eq('email', email)
      .eq('category', category)
    clearAlertSubscriberCache()
    return NextResponse.json({ ok: true })
  }

  // Admin: upsert anything. Revoking a grant also disables; granting fresh
  // enables (they can immediately turn it off themselves).
  const patch: Partial<Row> = {}
  if (body.granted !== undefined) {
    patch.granted = body.granted
    if (!body.granted) patch.enabled = false
    else if (body.enabled === undefined) patch.enabled = true
  }
  if (body.enabled !== undefined) patch.enabled = body.enabled
  const { error } = await supabase
    .from('staff_alert_subscriptions')
    .upsert({ email, category, granted: true, enabled: true, ...patch, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  clearAlertSubscriberCache()
  return NextResponse.json({ ok: true })
}
