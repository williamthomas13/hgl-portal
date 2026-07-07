'use client'

import { useState } from 'react'

// Small shared admin UI pieces (admin UX addendum): collapsible sections and
// the 24-hour / 5-minute time picker used everywhere a session time is set.

export function CollapsibleSection({
  title,
  subtitle,
  accent = 'border-hgl-slate',
  defaultOpen = false,
  children,
}: {
  title: string
  subtitle?: string
  accent?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`bg-white rounded-lg shadow-md border-t-4 ${accent}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-8 py-5 text-left"
      >
        <span>
          <span className="text-2xl font-bold text-hgl-slate">{title}</span>
          {subtitle && <span className="block text-sm text-gray-500 mt-0.5">{subtitle}</span>}
        </span>
        <span className={`text-gray-400 text-xl transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>
      {open && <div className="px-8 pb-8">{children}</div>}
    </div>
  )
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

/** "HH:MM" (24-hour) from a Postgres time-ish string, or '' when unset. */
export function to24h(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
}

/**
 * 24-hour time picker in 5-minute increments — native <input type="time">
 * renders 12-hour AM/PM in most locales, and the addendum wants 24-hour
 * throughout admin, so this is two selects producing "HH:MM".
 */
export function TimeSelect({
  value,
  onChange,
  required = false,
}: {
  value: string // '' or 'HH:MM'
  onChange: (v: string) => void
  required?: boolean
}) {
  const [h, m] = value ? value.split(':') : ['', '']
  const set = (hh: string, mm: string) => {
    if (hh === '' && mm === '') onChange('')
    else onChange(`${hh || '00'}:${mm || '00'}`)
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={h}
        required={required}
        onChange={(e) => set(e.target.value, m)}
        className="border border-gray-300 rounded p-1 bg-white"
      >
        <option value="">–</option>
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>{hh}</option>
        ))}
      </select>
      :
      <select
        value={m}
        required={required}
        onChange={(e) => set(h, e.target.value)}
        className="border border-gray-300 rounded p-1 bg-white"
      >
        <option value="">–</option>
        {MINUTES.map((mm) => (
          <option key={mm} value={mm}>{mm}</option>
        ))}
      </select>
    </span>
  )
}
