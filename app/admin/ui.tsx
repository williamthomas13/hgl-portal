'use client'

import { useState, useMemo, useEffect } from 'react'
import { formatDateAdmin } from '../utils/dates'

// Small shared admin UI pieces (admin UX addendum): collapsible sections and
// the 24-hour / 5-minute time picker used everywhere a session time is set.

export function CollapsibleSection({
  title,
  subtitle,
  accent = 'border-hgl-slate',
  defaultOpen = false,
  openSignal,
  children,
}: {
  title: string
  subtitle?: string
  accent?: string
  defaultOpen?: boolean
  /** Bump this counter to force the section open (e.g. "Duplicate class"
   *  jumping the user up into the wizard). */
  openSignal?: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  // "Adjust state during render" pattern: a bumped openSignal (Duplicate
  // class, alert deep-links) forces the section open without an
  // effect-driven double render. PL-99: seenSignal starts at 0 — NOT at the
  // incoming value — so a signal fired BEFORE this section mounted (deep-link
  // intent set while the page was still loading; these sections render only
  // after `loaded` flips) still opens it on first render. A one-shot signal
  // must survive late mounts.
  const [seenSignal, setSeenSignal] = useState(0)
  if (openSignal !== undefined && openSignal !== seenSignal) {
    setSeenSignal(openSignal)
    setOpen(true)
  }
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

// Full IANA timezone picker (addendum §7.2): HGL's schools span at least the
// Americas and Europe, so no curated subset — the complete list, searchable
// ("Berlin" or "Europe" both filter) and grouped by region for browsing.
const TZ_FALLBACK = [
  'America/Mexico_City',
  'America/Santiago',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/London',
]

export function TimezoneSelect({
  value,
  onChange,
  required = false,
}: {
  value: string
  onChange: (v: string) => void
  required?: boolean
}) {
  const [filter, setFilter] = useState('')
  const all = useMemo<string[]>(
    () =>
      typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : TZ_FALLBACK,
    []
  )
  const filtered = filter.trim()
    ? all.filter((tz) => tz.toLowerCase().includes(filter.trim().toLowerCase()))
    : all
  const groups = new Map<string, string[]>()
  for (const tz of filtered) {
    const region = tz.includes('/') ? tz.slice(0, tz.indexOf('/')) : 'Other'
    groups.set(region, [...(groups.get(region) ?? []), tz])
  }
  return (
    <div>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder='Search timezones — e.g. "Berlin" or "Europe"'
        className="block w-full border border-gray-300 rounded-md p-2 mb-1"
      />
      <select
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full border border-gray-300 rounded-md p-2 bg-white"
      >
        <option value="">Pick a timezone…</option>
        {/* keep the current value selectable even when the filter hides it */}
        {value && !filtered.includes(value) && <option value={value}>{value}</option>}
        {[...groups.entries()].map(([region, zones]) => (
          <optgroup key={region} label={region}>
            {zones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

/** PL-26: native date inputs render in the browser locale (often
 *  DD/MM/YYYY); this prints the picked date in the admin-wide format
 *  ("17 July 2026") beside the picker so nobody has to decode it. */
export function DateHint({ value }: { value: string }) {
  if (!value) return null
  return <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">= {formatDateAdmin(value)}</span>
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

// PL-90/92 standing rule: internal alerts deep-link the specific record they
// are about. The alert URL carries a focus param; the page calls this with
// the target element id and it scrolls + highlights once the data-loaded DOM
// contains it (polls briefly — panels fetch client-side).
export function useDeepLinkFocus(elementId: string | null) {
  useEffect(() => {
    if (!elementId) return
    let tries = 0
    const timer = setInterval(() => {
      const el = document.getElementById(elementId)
      tries++
      if (el) {
        clearInterval(timer)
        // PL-99: panels keep loading after the first scroll (layout shifts)
        // AND React re-renders can recreate the node or reset className,
        // wiping a one-shot class mutation — so re-QUERY and re-apply at
        // each assert point instead of holding the original node.
        const assert = (smooth: boolean) => {
          const node = document.getElementById(elementId)
          if (!node) return
          node.scrollIntoView(smooth ? { block: 'center', behavior: 'smooth' } : { block: 'center' })
          node.classList.add('ring-2', 'ring-hgl-blue')
        }
        assert(true)
        setTimeout(() => assert(true), 1800)
        setTimeout(() => assert(false), 4000)
        setTimeout(() => document.getElementById(elementId)?.classList.remove('ring-2', 'ring-hgl-blue'), 9000)
      } else if (tries > 75) {
        // ~30s: generous enough to outlive slow data loads (and first-hit
        // dev compiles) without polling forever.
        clearInterval(timer)
      }
    }, 400)
    return () => clearInterval(timer)
  }, [elementId])
}
