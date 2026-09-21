'use client'

import Link from 'next/link'

// PL-491: the "more" link on /classes "Recent classes" — a REAL link (PL-460):
// with JS it expands the hidden remainder in place; without JS the href
// (/classes?recent=all) renders the full list server-side.
export default function RecentMore({ count }: { count: number }) {
  return (
    <Link
      href="/classes?recent=all"
      data-testid="recent-more"
      className="text-sm font-semibold text-hgl-blue underline"
      onClick={(e) => {
        const rest = document.getElementById('recent-rest')
        if (!rest) return
        e.preventDefault()
        rest.style.display = ''
        ;(e.currentTarget as HTMLElement).hidden = true
      }}
    >
      more{count > 0 ? ` (${count})` : ''}
    </Link>
  )
}
