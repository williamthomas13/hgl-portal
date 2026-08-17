import type { MetadataRoute } from 'next'
import { supabaseAdmin as supabase } from './utils/supabase-admin'
import { emailBaseUrl } from './utils/base-url'

// PL-359 B: only the pages we WANT indexed — live/upcoming class pages and
// the team page. Cancelled/finished classes stay out (their /c pages also
// carry noindex); honest lastmod from the record's own timestamps, omitted
// when nothing trustworthy exists.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = emailBaseUrl()
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('classes')
    .select('slug, status, start_date, registration_close_date, collateral_changed_at, created_at, sessions ( session_date )')
    .eq('status', 'open')
    .not('slug', 'is', null)

  const entries: MetadataRoute.Sitemap = []
  for (const c of ((data as any[]) ?? [])) {
    const days = (c.sessions ?? []).map((s: any) => s.session_date).sort()
    const close = String(c.registration_close_date ?? days[0] ?? c.start_date ?? '').slice(0, 10)
    if (!close || close < today) continue // registration over → not index-worthy
    const lastmod = c.collateral_changed_at ?? c.created_at ?? null
    entries.push({
      url: `${base}/c/${c.slug}`,
      ...(lastmod ? { lastModified: new Date(lastmod) } : {}),
    })
  }
  entries.push({ url: `${base}/team` })
  // PL-378: the public classes browse page.
  entries.push({ url: `${base}/classes` })
  return entries
}
