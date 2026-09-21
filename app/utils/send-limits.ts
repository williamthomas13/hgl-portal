// PL-469: THE one reader for the sending limits. Resend Pro has NO daily
// limit (50k/month, confirmed Sep 21) — so the "daily cap" is a SAFETY BRAKE
// for campaigns, not a Resend limit, and transactional sends are never
// gated by it (sendOnce reads nothing here). Both values live in app_settings
// and are staff-editable under Settings; unset = no brake / no quota shown.
import { supabaseAdmin as supabase } from './supabase-admin'

export type SendLimits = {
  /** Campaigns pause when today's sends reach this (minus the transactional reserve). null = no brake. */
  dailyBrake: number | null
  /** The plan's monthly quota, shown against month-to-date sends. null = not set. */
  monthlyQuota: number | null
}

const num = (v: unknown): number | null => {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

export async function loadSendLimits(): Promise<SendLimits> {
  const { data } = await supabase.from('app_settings').select('key, value').in('key', ['resend_daily_cap', 'resend_monthly_quota'])
  const byKey = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  return { dailyBrake: num(byKey.resend_daily_cap), monthlyQuota: num(byKey.resend_monthly_quota) }
}

/** Denver-local day start, ISO — the day the health card and the brake count. */
export function denverDayStartIso(): string {
  return new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) + 'T00:00:00-06:00').toISOString()
}

/** Denver-local first-of-month, ISO — month-to-date against the plan quota. */
export function denverMonthStartIso(): string {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  return new Date(ymd.slice(0, 7) + '-01T00:00:00-06:00').toISOString()
}
