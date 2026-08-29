'use client'

import { useEffect, useState } from 'react'
import { CollapsibleSection } from '../ui'

// PL-405C: the family's compact activity feed — schedule edits,
// cancellations (with who), regenerations, payments, emails sent, drift
// resolutions — composed by the SAME builder as the dashboard feed
// (loadActivity familyId scope), read-only, each row deep-linking its
// record. This is how staff SEE what happened to a student's schedule
// (Roman's cancel-future mystery) without reconstructing it by hand.

type Row = { id: string; when: string; text: string; href: string; type?: string }

export default function FamilyActivityPane({ familyId }: { familyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async (before?: string) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(
        `/api/admin/dashboard/activity?family=${familyId}&limit=25${before ? `&before=${encodeURIComponent(before)}` : ''}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Load failed.')
      setRows((prev) => [...(before ? (prev ?? []) : []), ...(json.rows ?? [])])
      setHasMore(Boolean(json.hasMore))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId])

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Denver',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

  return (
    <CollapsibleSection
      title="Recent activity"
      subtitle="Schedule changes, cancellations, payments, and emails — who did what, when"
      defaultOpen={false}
    >
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {rows === null ? (
        <p className="text-xs text-gray-400 italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Nothing recorded for this family yet.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex gap-2 items-baseline">
              <span className="text-gray-400 whitespace-nowrap w-28 shrink-0">{fmt(r.when)}</span>
              <a href={r.href} className="text-gray-700 hover:text-hgl-blue">
                {r.text}
              </a>
            </li>
          ))}
        </ul>
      )}
      {hasMore && rows && rows.length > 0 && (
        <button
          onClick={() => load(rows[rows.length - 1].when)}
          disabled={busy}
          className="mt-2 text-xs text-hgl-blue underline disabled:opacity-50"
        >
          {busy ? 'Loading…' : 'Show earlier activity'}
        </button>
      )}
    </CollapsibleSection>
  )
}
