import { supabaseAdmin as supabase } from './supabase-admin'

// PL-478: the public header/footer mirror highergroundlearning.com so nobody
// is stranded on a portal page. ONE source of truth: the nav items are an
// EDITABLE list under Settings (app_settings `site_nav` / `site_footer_nav`,
// JSON) seeded with the main site's menu — Scarlett mirrors a menu change
// without Code. Portal-internal items use site-relative URLs (/classes,
// /team, /inquire); main-site items are absolute, same-tab links.

export type NavItem = {
  label: string
  url: string
  /** false = kept in the list but hidden. */
  show: boolean
  /** 'classes' | 'team' — marked current on that portal page. */
  key?: string
}

export const MAIN_SITE = 'https://www.highergroundlearning.com'

export const DEFAULT_SITE_NAV: NavItem[] = [
  { label: 'Buy 1-on-1 tutoring hours', url: `${MAIN_SITE}/1on1`, show: true },
  { label: 'Academic Support', url: `${MAIN_SITE}/academic-support`, show: true },
  { label: 'SAT', url: `${MAIN_SITE}/sat`, show: true },
  { label: 'ACT', url: `${MAIN_SITE}/act`, show: true },
  { label: 'AP/IB', url: `${MAIN_SITE}/ap-ib`, show: true },
  { label: 'University Applications', url: `${MAIN_SITE}/university-applications`, show: true },
  { label: 'GRE/GMAT', url: `${MAIN_SITE}/gre-gmat`, show: true },
  { label: 'Classes', url: '/classes', show: true, key: 'classes' },
  { label: 'About', url: `${MAIN_SITE}/about`, show: true },
  { label: 'Team', url: '/team', show: true, key: 'team' },
  { label: 'Pricing', url: `${MAIN_SITE}/pricing`, show: true },
  { label: 'Contact', url: `${MAIN_SITE}/contact`, show: true },
]

export const DEFAULT_FOOTER_NAV: NavItem[] = [
  { label: 'About', url: `${MAIN_SITE}/about`, show: true },
  { label: 'Team', url: '/team', show: true, key: 'team' },
  { label: 'Pricing', url: `${MAIN_SITE}/pricing`, show: true },
  { label: 'FAQs', url: `${MAIN_SITE}/faqs`, show: true },
  { label: 'Contact', url: `${MAIN_SITE}/contact`, show: true },
  { label: 'Privacy Policy', url: `${MAIN_SITE}/privacy-policy`, show: true },
  { label: 'Terms', url: `${MAIN_SITE}/terms`, show: true },
]

export function parseNav(raw: unknown, fallback: NavItem[]): NavItem[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr) || arr.length === 0) return fallback
    const out: NavItem[] = []
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue
      const label = String((it as NavItem).label ?? '').trim()
      const url = String((it as NavItem).url ?? '').trim()
      if (!label || !url) continue
      if (!/^(\/[^\s]*|https?:\/\/[^\s]+)$/.test(url)) continue
      out.push({ label: label.slice(0, 60), url: url.slice(0, 300), show: (it as NavItem).show !== false, key: typeof (it as NavItem).key === 'string' ? (it as NavItem).key : undefined })
    }
    return out.length ? out : fallback
  } catch {
    return fallback
  }
}

export async function loadSiteNav(): Promise<{ header: NavItem[]; footer: NavItem[] }> {
  const { data } = await supabase.from('app_settings').select('key, value').in('key', ['site_nav', 'site_footer_nav'])
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  return { header: parseNav(map.site_nav, DEFAULT_SITE_NAV), footer: parseNav(map.site_footer_nav, DEFAULT_FOOTER_NAV) }
}
