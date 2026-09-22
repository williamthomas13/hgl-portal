import { supabaseAdmin as supabase } from './supabase-admin'

// PL-478: the public header/footer mirror highergroundlearning.com so nobody
// is stranded on a portal page. ONE source of truth: the nav items are an
// EDITABLE list under Settings (app_settings `site_nav` / `site_footer_nav`,
// JSON) seeded with the main site's menu — Scarlett mirrors a menu change
// without Code. Portal-internal items use site-relative URLs (/classes,
// /team, /inquire); main-site items are absolute, same-tab links.
//
// PL-492/493 (Scarlett, Sep 22): ONE level of nesting. In the header a
// folder ("Tutoring") holds the seven service links exactly as the main
// site's menu does; in the footer a group is a link column with a heading
// ("Questions?", "Support") or none. A saved flat list from before is
// migrated in place on first load (see migrateNav) — nobody re-enters the
// menu.

export type NavItem = {
  label: string
  /** '' is allowed for a folder/group (a heading with children, no page). */
  url: string
  /** false = kept in the list but hidden. */
  show: boolean
  /** 'classes' | 'team' — marked current on that portal page. */
  key?: string
  /** PL-492/493: one level only — children never have children. */
  children?: NavItem[]
}

export const MAIN_SITE = 'https://www.highergroundlearning.com'

const TUTORING_CHILDREN: NavItem[] = [
  { label: 'Buy 1-on-1 tutoring hours', url: `${MAIN_SITE}/1on1`, show: true },
  { label: 'Academic Support', url: `${MAIN_SITE}/academic-support`, show: true },
  { label: 'SAT', url: `${MAIN_SITE}/sat`, show: true },
  { label: 'ACT', url: `${MAIN_SITE}/act`, show: true },
  { label: 'AP/IB', url: `${MAIN_SITE}/ap-ib`, show: true },
  { label: 'University Applications', url: `${MAIN_SITE}/university-applications`, show: true },
  { label: 'GRE/GMAT', url: `${MAIN_SITE}/gre-gmat`, show: true },
]

export const DEFAULT_SITE_NAV: NavItem[] = [
  { label: 'Tutoring', url: '', show: true, children: TUTORING_CHILDREN },
  { label: 'Classes', url: '/classes', show: true, key: 'classes' },
  { label: 'About', url: `${MAIN_SITE}/about`, show: true },
  { label: 'Team', url: '/team', show: true, key: 'team' },
  { label: 'Pricing', url: `${MAIN_SITE}/pricing`, show: true },
  { label: 'Contact', url: `${MAIN_SITE}/contact`, show: true },
]

// PL-493: the main site's footer columns, verbatim (two headed, two not).
export const DEFAULT_FOOTER_NAV: NavItem[] = [
  {
    label: 'Questions?',
    url: '',
    show: true,
    children: [
      { label: 'FAQs', url: `${MAIN_SITE}/faqs`, show: true },
      { label: 'Contact us', url: `${MAIN_SITE}/contact`, show: true },
    ],
  },
  {
    label: 'Support',
    url: '',
    show: true,
    children: [
      { label: 'Terms and Conditions', url: `${MAIN_SITE}/terms-of-service`, show: true },
      { label: 'Privacy Policy', url: `${MAIN_SITE}/privacy-policy`, show: true },
    ],
  },
  {
    label: '',
    url: '',
    show: true,
    children: [
      { label: 'About', url: `${MAIN_SITE}/about`, show: true },
      { label: 'Services', url: `${MAIN_SITE}/services`, show: true },
      { label: 'Team', url: '/team', show: true, key: 'team' },
    ],
  },
  {
    label: '',
    url: '',
    show: true,
    children: [
      { label: 'Our Approach', url: `${MAIN_SITE}/our-approach`, show: true },
      { label: 'Get Started', url: '/inquire?source=footer', show: true },
      { label: 'Bring HGL to your school', url: '/partner', show: true },
    ],
  },
]

const URL_RE = /^(\/[^\s]*|https?:\/\/[^\s]+)$/

function parseItem(it: unknown, allowChildren: boolean): NavItem | null {
  if (!it || typeof it !== 'object') return null
  const raw = it as NavItem
  const label = String(raw.label ?? '').trim().slice(0, 60)
  const url = String(raw.url ?? '').trim().slice(0, 300)
  const children = allowChildren && Array.isArray(raw.children)
    ? raw.children.map((c) => parseItem(c, false)).filter((c): c is NavItem => c != null)
    : []
  if (url && !URL_RE.test(url)) return null
  // A leaf needs a label AND a URL; a folder/group needs children (its
  // label may be blank — a heading-less footer column — and its URL too).
  if (children.length === 0 && (!label || !url)) return null
  const out: NavItem = { label, url, show: raw.show !== false, key: typeof raw.key === 'string' ? raw.key : undefined }
  if (children.length) out.children = children
  return out
}

export function parseNav(raw: unknown, fallback: NavItem[]): NavItem[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr) || arr.length === 0) return fallback
    const out = arr.map((it) => parseItem(it, true)).filter((it): it is NavItem => it != null)
    return out.length ? out : fallback
  } catch {
    return fallback
  }
}

/** Leaf-level compare: same link = same URL (case-insensitive) or same label. */
const same = (a: NavItem, b: NavItem) =>
  (a.url && b.url && a.url.toLowerCase() === b.url.toLowerCase()) || a.label.toLowerCase() === b.label.toLowerCase()

/** PL-492/493: a saved list from before the nesting (flat) is reshaped in
 *  place. Header: the seven service links fold into a "Tutoring" folder at
 *  the position of the first one; everything else keeps its order and its
 *  show flag. Footer: the flat list becomes the main site's columns; a saved
 *  show flag carries over by link, and any saved link the columns don't know
 *  is appended to the last group so nothing Scarlett added is lost. */
export function migrateNav(kind: 'header' | 'footer', items: NavItem[]): { items: NavItem[]; changed: boolean } {
  if (items.some((it) => it.children && it.children.length)) return { items, changed: false }
  if (kind === 'header') {
    const isService = (it: NavItem) => TUTORING_CHILDREN.some((c) => same(c, it))
    const firstIdx = items.findIndex(isService)
    if (firstIdx < 0) return { items, changed: false }
    const folder: NavItem = {
      label: 'Tutoring',
      url: '',
      show: true,
      children: items.filter(isService).map((it) => ({ label: it.label, url: it.url, show: it.show })),
    }
    const out: NavItem[] = []
    items.forEach((it, i) => {
      if (i === firstIdx) out.push(folder)
      if (!isService(it)) out.push(it)
    })
    return { items: out, changed: true }
  }
  const known = new Set<NavItem>()
  const groups = DEFAULT_FOOTER_NAV.map((g) => ({
    ...g,
    children: (g.children ?? []).map((c) => {
      const saved = items.find((it) => same(it, c))
      if (saved) known.add(saved)
      return { ...c, show: saved ? saved.show : c.show }
    }),
  }))
  const extras = items.filter((it) => !known.has(it)).map((it) => ({ label: it.label, url: it.url, show: it.show, key: it.key }))
  if (extras.length) groups[groups.length - 1].children = [...(groups[groups.length - 1].children ?? []), ...extras]
  return { items: groups, changed: true }
}

export async function loadSiteNav(): Promise<{ header: NavItem[]; footer: NavItem[] }> {
  const { data } = await supabase.from('app_settings').select('key, value').in('key', ['site_nav', 'site_footer_nav'])
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  const header = migrateNav('header', parseNav(map.site_nav, DEFAULT_SITE_NAV))
  const footer = migrateNav('footer', parseNav(map.site_footer_nav, DEFAULT_FOOTER_NAV))
  // Migrated in place: the saved JSON is rewritten ONCE in the new shape so
  // Settings → Public site menu shows the nesting (best-effort, never blocks a render).
  const writes = []
  if (map.site_nav != null && header.changed) writes.push({ key: 'site_nav', value: JSON.stringify(header.items), updated_at: new Date().toISOString() })
  if (map.site_footer_nav != null && footer.changed) writes.push({ key: 'site_footer_nav', value: JSON.stringify(footer.items), updated_at: new Date().toISOString() })
  if (writes.length) await supabase.from('app_settings').upsert(writes).then(() => {}, () => {})
  return { header: header.items, footer: footer.items }
}

/** A nav list with hidden items (and emptied folders) dropped — what renders. */
export function visibleNav(items: NavItem[]): NavItem[] {
  return items
    .filter((it) => it.show)
    .map((it) => (it.children ? { ...it, children: it.children.filter((c) => c.show) } : it))
    .filter((it) => !it.children || it.children.length > 0 || it.url)
}
