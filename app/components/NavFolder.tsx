'use client'

import { useRef, useState } from 'react'

// PL-492: the header's one-level folder ("Tutoring" → the seven service
// links) on desktop. Opens on hover / focus (pure CSS — works with JS off),
// on click / Enter / Space (keyboard), and Escape closes it. The children are
// server-rendered links, so every item is reachable without JS.
export default function NavFolder({
  label,
  items,
  tone,
}: {
  label: string
  items: { label: string; url: string }[]
  tone: 'white' | 'overlay'
}) {
  const [open, setOpen] = useState(false)
  // After Escape the CSS hover/focus opener is suppressed until the pointer
  // or focus leaves — otherwise the still-focused button re-opens it.
  const [suppressed, setSuppressed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const leave = () => {
    setOpen(false)
    setSuppressed(false)
  }
  return (
    <div
      ref={root}
      className="relative group"
      data-nav-folder={label}
      onMouseLeave={leave}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) leave()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false)
          setSuppressed(true)
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setSuppressed(false)
          setOpen((o) => !o)
        }}
        className={`inline-flex items-center gap-1 whitespace-nowrap ${tone === 'overlay' ? 'hover:text-white/80' : 'hover:text-hgl-blue'}`}
        data-nav-top={label}
      >
        {label}
        <span aria-hidden className="text-[11px] translate-y-px">▾</span>
      </button>
      <ul
        className={`absolute left-0 top-full pt-3 z-40 min-w-[260px] ${
          open ? 'block' : suppressed ? 'hidden' : 'hidden group-hover:block group-focus-within:block'
        }`}
        role="menu"
      >
        <li className="bg-white text-black border border-gray-200 rounded-md shadow-lg py-2">
          {items.map((it) => (
            <a
              key={it.url + it.label}
              href={it.url}
              role="menuitem"
              className="block px-5 py-2 whitespace-nowrap hover:text-hgl-blue"
              data-nav-child={it.label}
            >
              {it.label}
            </a>
          ))}
        </li>
      </ul>
    </div>
  )
}
