'use client'

import { useEffect, useState } from 'react'

// PL-93: the counselor-facing comms timeline, per contact-at-school — every
// CD/CR/FP/CX-C send with delivered/OPENED status, the automatic/by-hand
// badge, and the openable render (PL-77 preview endpoint; staff pass).
// "Are our nudges landing?" answered per row, raw status only.

type Item = {
  id: string
  label: string
  subject: string | null
  recipient: string
  state: string
  origin: string
  when: string | null
}

const STATE_STYLES: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  held: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
  delivered: 'bg-green-100 text-green-700',
  opened: 'bg-emerald-100 text-emerald-800',
  bounced: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-200 text-gray-500 line-through',
}

const ORIGIN_STYLES: Record<string, string> = {
  automatic: 'bg-slate-100 text-slate-600',
  'by hand': 'bg-purple-100 text-purple-700',
  test: 'bg-yellow-100 text-yellow-700',
}

export function SchoolCommsTimeline({ schoolId, email }: { schoolId: string; email?: string }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string | null; note?: string } | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && items === null) {
      try {
        const qs = `schoolId=${schoolId}${email ? `&email=${encodeURIComponent(email)}` : ''}`
        const res = await fetch(`/api/admin/school-comms?${qs}`)
        const json = await res.json()
        if (!res.ok) setError(json.error ?? 'Could not load.')
        else setItems(json.items)
      } catch {
        setError('Could not load.')
      }
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
    try {
      const res = await fetch(`/api/portal/comms-preview?id=${item.id}`)
      const json = await res.json()
      setPreview(res.ok ? json : { subject: item.subject ?? item.label, html: null, note: json.error })
    } catch {
      setPreview({ subject: item.subject ?? item.label, html: null, note: 'Could not load the email.' })
    }
  }

  const unopened = items?.filter((i) => ['sent', 'delivered'].includes(i.state)).length ?? 0
  const openedCount = items?.filter((i) => i.state === 'opened').length ?? 0

  return (
    <div className="text-sm">
      <button onClick={toggle} className="text-xs text-hgl-blue underline hover:text-hgl-slate">
        {open ? '▾' : '▸'} Emails to this contact
        {items ? ` (${items.length} — ${openedCount} opened, ${unopened} not yet)` : ''}
      </button>
      {open && (
        <div className="mt-2">
          {error && <p className="text-xs text-red-600">{error}</p>}
          {items && items.length === 0 && <p className="text-xs text-gray-500 italic">No emails yet.</p>}
          {items && items.length > 0 && (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md bg-white">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => openPreview(item)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 flex-wrap"
                  >
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide ${STATE_STYLES[item.state] ?? 'bg-gray-100 text-gray-600'}`}>
                      {item.state}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${ORIGIN_STYLES[item.origin] ?? ''}`}>
                      {item.origin}
                    </span>
                    <span className="font-medium text-gray-800">{item.label}</span>
                    <span className="text-gray-400 text-xs">
                      {item.when ? new Date(item.when).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                    </span>
                  </button>
                  {openRow === item.id && (
                    <div className="border-t border-gray-100 bg-gray-50 p-3">
                      {preview ? (
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
                      ) : (
                        <p className="text-xs text-gray-400">Loading the email…</p>
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

/** Table flavor for the counselors panel. */
export function SchoolCommsRow({ schoolId, email, colSpan }: { schoolId: string; email: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-1.5 bg-gray-50/50">
        <SchoolCommsTimeline schoolId={schoolId} email={email} />
      </td>
    </tr>
  )
}

/** PL-93: the CR chase line with open state, appended wherever a chase
 *  status renders (the class-card room badge). */
export function ChaseStatus({ classId }: { classId: string }) {
  const [line, setLine] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/admin/school-comms?chaseClassId=${classId}`)
      .then((r) => r.json())
      .then((j) => setLine(j.line ?? null))
      .catch(() => setLine(null))
  }, [classId])
  if (!line) return null
  return <span className="block text-[11px] text-gray-500 mt-0.5">{line}</span>
}
