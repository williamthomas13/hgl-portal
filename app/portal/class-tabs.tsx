'use client'

import { useEffect, useState, type ReactNode } from 'react'

// PL-413: the tutor's "My classes" tabbed like the admin's Live class
// rosters once there are 3+ live classes — one tab per class (short
// marketing name via classDisplayLabel, never the full title) plus a
// "Past (N)" bucket for ended/cancelled ones. With 1–2 classes the caller
// keeps today's stacked layout (content-gated, the PL-404 principle).
// Reconciled portal-nav shape (PL-404 + PL-413): the left menu jumps
// BETWEEN the big sections; these tabs switch classes WITHIN My classes —
// one coherent system, not two competing ones.
// Selection is remembered per tutor (localStorage) and ?class={id} deep
// links (emailed alerts) select the right tab — a past class id lands on
// the Past bucket.

export default function ClassTabs({
  live,
  pastCount,
  liveCards,
  pastCards,
  storageKey,
}: {
  live: { id: string; label: string }[]
  pastCount: number
  liveCards: ReactNode[]
  pastCards: ReactNode[]
  storageKey: string
}) {
  const [sel, setSel] = useState('')
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('class')
    if (wanted) {
      if (live.some((c) => c.id === wanted)) return setSel(wanted)
      if (pastCount > 0) return setSel('__past')
    }
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved && (saved === '__past' ? pastCount > 0 : live.some((c) => c.id === saved))) {
        return setSel(saved)
      }
    } catch {
      /* storage unavailable — fall through to the first tab */
    }
    setSel(live[0]?.id ?? (pastCount > 0 ? '__past' : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!sel) return
    try {
      localStorage.setItem(storageKey, sel)
    } catch {
      /* per-browser convenience only */
    }
  }, [sel, storageKey])

  const idx = live.findIndex((c) => c.id === sel)
  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-4">
        {live.map((c) => (
          <button
            key={c.id}
            onClick={() => setSel(c.id)}
            className={`px-3 py-2 text-sm font-semibold rounded-t border-b-2 -mb-px ${
              sel === c.id
                ? 'border-hgl-blue text-hgl-slate bg-white'
                : 'border-transparent text-gray-500 hover:text-hgl-slate'
            }`}
          >
            {c.label}
          </button>
        ))}
        {pastCount > 0 && (
          <button
            onClick={() => setSel('__past')}
            className={`px-3 py-2 text-sm font-semibold rounded-t border-b-2 -mb-px ${
              sel === '__past'
                ? 'border-hgl-blue text-hgl-slate bg-white'
                : 'border-transparent text-gray-500 hover:text-hgl-slate'
            }`}
          >
            Past ({pastCount})
          </button>
        )}
      </div>
      {sel === '__past' ? (
        <div className="space-y-6">{pastCards}</div>
      ) : idx >= 0 ? (
        liveCards[idx]
      ) : (
        liveCards[0] ?? null
      )}
    </div>
  )
}
