'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// PL-190: Scarlett's IA (Jul 28) — six topline tabs, always clickable, every
// page filed under one. This bar renders from the admin layout so it's on
// EVERY admin page; each tab lands on its section's most useful default.
// Existing deep links (?class=, ?qbo=, /admin/tutoring?family=, every emailed
// alert URL) are untouched — they keep landing exactly where they always did,
// and the bar just highlights the right tab when they do.

// PL-198 made Calendar a provisional seventh topline tab; PL-284 (Scarlett,
// Aug 7) files it under Classes instead — its legend is class language, so it
// lives in the Classes sidebar. /admin/calendar still resolves (deep-link
// rule); the bar highlights Classes when you're there. View-as under Settings.
const TABS = [
  { id: 'dashboard', label: 'Dashboard', href: '/admin' },
  { id: 'leads', label: 'Prospective Students', href: '/admin/leads' },
  { id: 'tutoring', label: 'Tutoring', href: '/admin/tutoring' },
  { id: 'classes', label: 'Classes', href: '/admin?tab=classes' },
  { id: 'contacts', label: 'Contacts', href: '/admin?tab=contacts' },
  { id: 'settings', label: 'Settings', href: '/admin?tab=settings' },
] as const

export type ToplineTab = (typeof TABS)[number]['id']

/** Which topline tab a given /admin URL belongs to. */
function tabForUrl(pathname: string, search: string): ToplineTab {
  if (pathname.startsWith('/admin/leads')) return 'leads'
  if (pathname.startsWith('/admin/tutoring')) return 'tutoring'
  // PL-284: the calendar files under Classes now.
  if (pathname.startsWith('/admin/calendar')) return 'classes'
  // PL-198: View-as files under Settings.
  if (pathname.startsWith('/admin/view-as')) return 'settings'
  // Filed under Contacts in Scarlett's IA (Jul 28).
  if (pathname.startsWith('/admin/communications') || pathname.startsWith('/admin/agreements') || pathname.startsWith('/admin/campaigns')) return 'contacts'
  const q = new URLSearchParams(search)
  const tab = q.get('tab')
  if (tab === 'classes' || tab === 'contacts' || tab === 'settings') return tab
  // Old deep links carry no tab param — infer the home their record lives in.
  if (q.get('class') || q.get('enrollment')) return 'classes'
  if (q.get('qbo')) return 'settings'
  return 'dashboard'
}

export default function AdminTopline() {
  const pathname = usePathname() ?? '/admin'
  // window.location.search is read client-side (no useSearchParams — that
  // would force a Suspense boundary through the server layout).
  const [search, setSearch] = useState('')
  useEffect(() => {
    setSearch(window.location.search)
    // Same-page tab switches on /admin update the URL via history — listen so
    // the highlight follows without a reload.
    const onNav = () => setSearch(window.location.search)
    window.addEventListener('popstate', onNav)
    window.addEventListener('hgl-admin-tab', onNav)
    return () => {
      window.removeEventListener('popstate', onNav)
      window.removeEventListener('hgl-admin-tab', onNav)
    }
  }, [])
  const active = tabForUrl(pathname, search)

  // PL-217: at phone widths the bar scrolls, but a cut-off label with no
  // affordance reads as "that's all the tabs." A right-edge fade shows there
  // is more, and disappears once the bar is scrolled to (or fits) the end.
  // An IntersectionObserver on an end-of-list sentinel drives it — covers
  // scrolling AND resizing without listening to either.
  const scroller = useRef<HTMLElement | null>(null)
  const endMark = useRef<HTMLSpanElement | null>(null)
  const [moreRight, setMoreRight] = useState(false)
  useEffect(() => {
    if (!scroller.current || !endMark.current) return
    const io = new IntersectionObserver(
      ([entry]) => setMoreRight(!entry.isIntersecting),
      { root: scroller.current, threshold: 0.99 }
    )
    io.observe(endMark.current)
    return () => io.disconnect()
  }, [])

  return (
    <div className="bg-hgl-slate relative">
      <nav
        ref={scroller}
        aria-label="Admin"
        className="max-w-6xl mx-auto px-4 sm:px-10 flex items-center gap-1 overflow-x-auto"
      >
        {TABS.map((t) => (
          <a
            key={t.id}
            href={t.href}
            className={`text-sm font-semibold px-3 py-2.5 whitespace-nowrap transition border-b-2 ${
              active === t.id
                ? 'text-white border-white'
                : 'text-white/70 border-transparent hover:text-white'
            }`}
          >
            {t.label}
          </a>
        ))}
        <span ref={endMark} aria-hidden className="w-px shrink-0 self-stretch" />
      </nav>
      {moreRight && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-hgl-slate to-transparent"
        />
      )}
    </div>
  )
}
