import { supabaseAdmin as supabase } from './supabase-admin'

// PL-473: spam protection for the public forms, stated plainly:
//   1. honeypot (every form; bots fill the invisible "company" field);
//   2. per-email throttle — the same address submitting the same form
//      inside 10 minutes gets a friendly OK and no second row (a double
//      click, a retry, or a bot replaying);
//   3. best-effort per-instance IP bucket (serverless: one function instance
//      keeps its own counter — a brake, not a guarantee; the honeypot + email
//      throttle are the real gates).
const ipHits = new Map<string, number[]>()
export function ipThrottled(req: Request, limit = 8, windowMs = 10 * 60_000): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const now = Date.now()
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < windowMs)
  hits.push(now)
  ipHits.set(ip, hits)
  return hits.length > limit
}

/** True when this email already created a row in `table` within the window. */
export async function recentDuplicate(table: 'leads' | 'marketing_subscribers', emailColumn: string, email: string, minutes = 10): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(emailColumn, email)
    .gte('created_at', since)
  return (count ?? 0) > 0
}

export const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export const EMAIL_RE = /^\S+@\S+\.\S+$/

/** "+39 333 1234567" from the embed's dial-code + number pair. */
export function composePhone(country: unknown, number: unknown): string | null {
  const n = str(number, 50)
  if (!n) return null
  const c = str(country, 8)
  return c && !n.startsWith('+') ? `${c} ${n}` : n
}
