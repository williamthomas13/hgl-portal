'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

// PL-190: Scarlett's IA (Jul 28) — six topline tabs, always clickable, every
// page filed under one. This bar renders from the admin layout so it's on
// EVERY admin page; each tab lands on its section's most useful default.
// Existing deep links (?class=, ?qbo=, /admin/tutoring?family=, every emailed
// alert URL) are untouched — they keep landing exactly where they always did,
// and the bar just highlights the right tab when they do.

// PL-198 (Scarlett, Jul 29, provisional): Calendar is a daily-driver surface,
// not a filed page — seventh topline tab. View-as filed under Settings.
const TABS = [
  { id: 'dashboard', label: 'Dashboard', href: '/admin' },
  { id: 'leads', label: 'Prospective Students', href: '/admin/leads' },
  { id: 'tutoring', label: 'Tutoring', href: '/admin/tutoring' },
  { id: 'calendar', label: 'Calendar', href: '/admin/calendar' },
  { id: 'classes', label: 'Classes', href: '/admin?tab=classes' },
  { id: 'contacts', label: 'Contacts', href: '/admin?tab=contacts' },
  { id: 'settings', label: 'Settings', href: '/admin?tab=settings' },
] as const

export type ToplineTab = (typeof TABS)[number]['id']

/** Which topline tab a given /admin URL belongs to. */
function tabForUrl(pathname: string, search: string): ToplineTab {
  if (pathname.startsWith('/admin/leads')) return 'leads'
  if (pathname.startsWith('/admin/tutoring')) return 'tutoring'
  if (pathname.startsWith('/admin/calendar')) return 'calendar'
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

  return (
    <div className="bg-hgl-slate">
      <nav
        aria-label="Admin"
        className="max-w-6xl mx-auto px-10 flex items-center gap-1 overflow-x-auto"
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
      </nav>
    </div>
  )
}
