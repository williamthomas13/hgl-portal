'use client'

import type { ReactNode } from 'react'

// Batch 23 (PL-227/229/230): ONE sidebar layout for every admin surface that
// files content under left-hand sections — the /admin topline groups, the
// Tutoring page, the standalone pages that wear Contacts chrome
// (Communications / Campaigns / Agreements), and the Family profile.
//
// Two invariants every consumer relies on:
//   1. Panels hide with CSS, never unmount (the PL-99 late-mount lesson —
//      deep-link focus polling and data loads keep working in hidden panels).
//   2. An entry may be a BUTTON (local section switch via onSelect) or a
//      LINK (href — a real navigation to a sibling page that renders its own
//      copy of this sidebar). Both show the same selected state, so a page
//      reached by deep link still looks like "a section of" its group.

export type SidebarEntry = { id: string; label: string; href?: string }

export function SidebarNav({
  entries,
  active,
  onSelect,
}: {
  entries: SidebarEntry[]
  active: string
  onSelect?: (id: string) => void
}) {
  return (
    <nav
      aria-label="Admin sections"
      className="flex md:flex-col gap-1 md:w-52 shrink-0 md:sticky md:top-6 overflow-x-auto pb-2 md:pb-0 mb-4 md:mb-0"
    >
      {entries.map((s) => {
        const selected = active === s.id
        const cls = `text-left text-sm rounded-md px-3 py-2 whitespace-nowrap font-semibold transition ${
          selected ? 'bg-hgl-slate text-white' : 'text-gray-600 hover:bg-gray-200'
        }`
        return s.href && !selected ? (
          <a key={s.id} href={s.href} className={cls}>
            {s.label}
          </a>
        ) : (
          <button
            key={s.id}
            onClick={() => !selected && onSelect?.(s.id)}
            className={cls}
            aria-current={selected ? 'page' : undefined}
          >
            {s.label}
          </button>
        )
      })}
    </nav>
  )
}

/** Nav + right pane. Pass panels as `children` — the consumer wraps each in
 *  `<SidebarPanel id=… active=…>` (or its own hidden-div equivalent) so
 *  everything stays mounted. */
export function SidebarLayout({
  entries,
  active,
  onSelect,
  children,
}: {
  entries: SidebarEntry[]
  active: string
  onSelect?: (id: string) => void
  children: ReactNode
}) {
  return (
    <div className="md:flex md:gap-6 md:items-start">
      <SidebarNav entries={entries} active={active} onSelect={onSelect} />
      <div className="flex-1 min-w-0 space-y-6">{children}</div>
    </div>
  )
}

export function SidebarPanel({
  id,
  active,
  children,
}: {
  id: string
  active: string
  children: ReactNode
}) {
  return <div className={active === id ? '' : 'hidden'}>{children}</div>
}
