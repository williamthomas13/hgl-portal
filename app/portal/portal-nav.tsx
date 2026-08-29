// PL-404: the portal's section navigation — a sticky left menu on desktop
// that collapses to a horizontal chip row at phone width. Composed from what
// the account ACTUALLY has (sections gate on content the way blocks gate on
// class facts): fewer than two destinations renders NOTHING, so a family
// with one student and one enrollment keeps today's simple single-column
// page with no chrome for nothing. Pure anchor links — server-rendered, no
// state, which is also what keeps View-as pixel-identical (PL-325's
// pointer-events rule untouched).

export type PortalNavItem = { href: string; label: string }

export default function PortalNav({ items }: { items: PortalNavItem[] }) {
  if (items.length < 2) return null
  return (
    <>
      {/* phone: chip row above the content */}
      <nav className="md:hidden -mx-1 px-1 mb-4 overflow-x-auto whitespace-nowrap flex gap-2 pb-1">
        {items.map((it) => (
          <a
            key={it.href}
            href={it.href}
            className="shrink-0 text-xs font-bold text-hgl-slate bg-white border border-gray-200 rounded-full px-3 py-1.5 hover:border-hgl-blue"
          >
            {it.label}
          </a>
        ))}
      </nav>
      {/* desktop: sticky left menu */}
      <nav className="hidden md:block w-44 shrink-0 sticky top-6 self-start">
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.href}>
              <a
                href={it.href}
                className="block text-sm font-semibold text-gray-600 hover:text-hgl-blue rounded px-2 py-1.5 hover:bg-white"
              >
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
