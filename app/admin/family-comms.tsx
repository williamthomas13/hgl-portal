'use client'

import { useState } from 'react'

// PL-83: the family-scoped comms timeline (Kelsie's "what have they been
// told?") — embedded on the admin family/student record surfaces: the class
// roster row and the tutoring family card. Read-only; every row is badged
// automatic / by hand / test and opens to the exact render via the PL-77
// preview endpoint. The compose panel stays where it is.

type Item = {
  id: string
  label: string
  subject: string | null
  recipient: string
  recipientRole: string
  state: 'upcoming' | 'held' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'cancelled' | 'failed'
  origin: 'automatic' | 'by hand' | 'test'
  when: string | null
}

const STATE_STYLES: Record<Item['state'], string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  held: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
  delivered: 'bg-green-100 text-green-700',
  opened: 'bg-emerald-100 text-emerald-800',
  bounced: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-200 text-gray-500 line-through',
}

const ORIGIN_STYLES: Record<Item['origin'], string> = {
  automatic: 'bg-slate-100 text-slate-600',
  'by hand': 'bg-purple-100 text-purple-700',
  test: 'bg-yellow-100 text-yellow-700',
}

function fmtWhen(iso: string | null, state: Item['state']) {
  if (!iso) return ''
  const d = new Date(iso)
  const s = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return state === 'upcoming' || state === 'held' ? `${s} (scheduled)` : s
}

export function FamilyCommsTimeline({ studentId, familyId }: { studentId?: string; familyId?: string }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string | null; note?: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && items === null && !loading) {
      setLoading(true)
      setError('')
      try {
        const qs = familyId ? `familyId=${familyId}` : `studentId=${studentId}`
        const res = await fetch(`/api/admin/family-comms?${qs}`)
        const json = await res.json()
        if (!res.ok) setError(json.error ?? 'Could not load the timeline.')
        else setItems(json.items)
      } catch {
        setError('Could not load the timeline.')
      }
      setLoading(false)
    }
  }

  async function openPreview(item: Item) {
    if (openRow === item.id) {
      setOpenRow(null)
      setPreview(null)
      return
    }
    setOpenRow(item.id)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/portal/comms-preview?id=${item.id}`)
      const json = await res.json()
      setPreview(res.ok ? json : { subject: item.subject ?? item.label, html: null, note: json.error })
    } catch {
      setPreview({ subject: item.subject ?? item.label, html: null, note: 'Could not load the email.' })
    }
    setPreviewLoading(false)
  }

  return (
    <div className="text-sm">
      <button onClick={toggle} className="text-xs text-hgl-blue underline hover:text-hgl-slate">
        {open ? '▾' : '▸'} Family emails — sent &amp; upcoming
        {items ? ` (${items.length})` : ''}
      </button>
      {open && (
        <div className="mt-2">
          {loading && <p className="text-xs text-gray-400">Loading…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {items && items.length === 0 && (
            <p className="text-xs text-gray-500 italic">No emails for this family yet.</p>
          )}
          {items && items.length > 0 && (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md bg-white">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => openPreview(item)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 flex-wrap"
                  >
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide ${STATE_STYLES[item.state]}`}
                    >
                      {item.state}
                    </span>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${ORIGIN_STYLES[item.origin]}`}
                      title={
                        item.origin === 'automatic'
                          ? 'Sent by the system (sequence, cron, or webhook)'
                          : item.origin === 'by hand'
                            ? 'A human wrote this or chose its send moment'
                            : 'Test send from the template editor'
                      }
                    >
                      {item.origin}
                    </span>
                    <span className="font-medium text-gray-800">{item.label}</span>
                    <span className="text-gray-400 text-xs">
                      {fmtWhen(item.when, item.state)} · to {item.recipient}
                      {item.recipientRole === 'student' ? ' (student)' : ''}
                    </span>
                  </button>
                  {openRow === item.id && (
                    <div className="border-t border-gray-100 bg-gray-50 p-3">
                      {previewLoading && <p className="text-xs text-gray-400">Loading the email…</p>}
                      {preview && (
                        <>
                          <p className="text-xs font-semibold text-gray-600 mb-2">Subject: {preview.subject}</p>
                          {preview.html ? (
                            <iframe
                              srcDoc={preview.html}
                              sandbox=""
                              title={preview.subject}
                              className="w-full h-96 bg-white border border-gray-200 rounded"
                            />
                          ) : (
                            <p className="text-xs text-gray-500 italic">{preview.note}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Table flavor for the class roster: renders as a slim full-width row. */
export function FamilyCommsRow({ studentId, colSpan }: { studentId: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-1.5 bg-gray-50/50">
        <FamilyCommsTimeline studentId={studentId} />
      </td>
    </tr>
  )
}
