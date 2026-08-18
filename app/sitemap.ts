import type { MetadataRoute } from 'next'
import { supabaseAdmin as supabase } from './utils/supabase-admin'
import { emailBaseUrl } from './utils/base-url'

// PL-384 (supersedes PL-359 B): the sitemap lists THE permanent addresses —
// every school/course evergreen /{code} URL (each always serves something
// honest: the open class, or the interest capture), plus /classes and /team.
// /c/{slug} pages are internal plumbing now: always noindex, never listed.
// lastmod rides the code's currently-served class when one is open.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = emailBaseUrl()
  const entries: MetadataRoute.Sitemap = []

  const [{ data: schools }, { data: courses }, { data: classes }] = await Promise.all([
    supabase.from('schools').select('id, evergreen_code').not('evergreen_code', 'is', null),
    supabase.from('course_meta').select('course_key, evergreen_code').not('evergreen_code', 'is', null),
    supabase
      .from('classes')
      .select('school_id, course_key, status, collateral_changed_at, created_at')
      .eq('status', 'open'),
  ])

  const lastmodFor = (match: (c: any) => boolean): Date | null => {
    const stamps = ((classes as any[]) ?? [])
      .filter(match)
      .map((c) => c.collateral_changed_at ?? c.created_at)
      .filter(Boolean)
      .sort()
    return stamps.length > 0 ? new Date(stamps[stamps.length - 1]) : null
  }

  for (const s of ((schools as any[]) ?? [])) {
    const lastmod = lastmodFor((c) => c.school_id === s.id)
    entries.push({ url: `${base}/${s.evergreen_code}`, ...(lastmod ? { lastModified: lastmod } : {}) })
  }
  for (const m of ((courses as any[]) ?? [])) {
    const lastmod = lastmodFor((c) => !c.school_id && c.course_key === m.course_key)
    entries.push({ url: `${base}/${m.evergreen_code}`, ...(lastmod ? { lastModified: lastmod } : {}) })
  }
  entries.push({ url: `${base}/classes` })
  entries.push({ url: `${base}/team` })
  return entries
}
