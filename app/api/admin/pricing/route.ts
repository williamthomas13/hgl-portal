import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'

// PL-321: the Settings → Price list API — admin-only (managers 403 and the
// panel hides itself, same pattern as Contact settings). Prices are stored
// the DERIVED way: tier base rate + per-row discount; the DB trigger
// recomputes hourly_rate/package_price, so everything downstream (register
// dropdown via class-info, checkout validation, receipts' forward snapshots)
// resolves the new numbers at render time. Nothing retroactive: paid
// snapshots stay frozen.

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const [{ data: packages }, { data: subjects }, { data: settings }] = await Promise.all([
    supabase
      .from('tutoring_packages')
      .select('id, name, hours, hourly_rate, package_price, regular_hourly_rate, discount_per_hour, phase, tier, active')
      .order('tier')
      .order('phase')
      .order('hours'),
    supabase.from('subjects').select('category, hourly_rate'),
    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['late_reschedule_fee_per_hour', 'late_fee_percent']),
  ])
  const subjectRates: Record<string, number[]> = {}
  for (const s of (subjects as any[]) ?? []) {
    ;(subjectRates[s.category] ??= []).push(Number(s.hourly_rate))
  }
  const settingMap = Object.fromEntries(((settings as any[]) ?? []).map((s) => [s.key, s.value]))
  return NextResponse.json({
    packages: packages ?? [],
    subjectRates: Object.fromEntries(
      Object.entries(subjectRates).map(([cat, rates]) => [cat, [...new Set(rates)].sort((a, b) => a - b)])
    ),
    lateRescheduleFee: Number(settingMap.late_reschedule_fee_per_hour ?? 40),
    lateFeePercent: Number(settingMap.late_fee_percent ?? 10),
  })
}

type Body =
  | { action: 'set_tier_base'; tier: string; phase: string; base: number }
  | { action: 'set_package_discount'; id: string; discount: number }
  | { action: 'set_subject_rate'; category: string; rate: number }
  | { action: 'set_fee'; key: 'late_reschedule_fee_per_hour' | 'late_fee_percent'; value: number }

export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? n : null
  }

  if (body.action === 'set_tier_base') {
    const base = num(body.base, 1, 1000)
    if (base == null) return NextResponse.json({ error: 'Base rate should be a dollar amount.' }, { status: 400 })
    // The trigger recomputes hourly_rate + package_price for every row.
    const { error } = await supabase
      .from('tutoring_packages')
      .update({ regular_hourly_rate: base })
      .eq('tier', body.tier)
      .eq('phase', body.phase)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_package_discount') {
    const discount = num(body.discount, 0, 999)
    if (discount == null) return NextResponse.json({ error: 'Discount should be dollars off the base per hour.' }, { status: 400 })
    const { error } = await supabase
      .from('tutoring_packages')
      .update({ discount_per_hour: discount })
      .eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_subject_rate') {
    const rate = num(body.rate, 1, 1000)
    if (rate == null) return NextResponse.json({ error: 'Rate should be a dollar amount.' }, { status: 400 })
    if (!['test_prep', 'subject_tutoring'].includes(body.category)) {
      return NextResponse.json({ error: 'Unknown subject category.' }, { status: 400 })
    }
    // Base 1-on-1 rates are uniform per category today; this keeps them so.
    // (New engagements prefill from these; existing engagement rates and
    // invoice snapshots never move.)
    const { error } = await supabase.from('subjects').update({ hourly_rate: rate }).eq('category', body.category)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_fee') {
    const max = body.key === 'late_fee_percent' ? 100 : 500
    const value = num(body.value, 0, max)
    if (value == null) return NextResponse.json({ error: 'Enter a plain number.' }, { status: 400 })
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: body.key, value: String(value), updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
