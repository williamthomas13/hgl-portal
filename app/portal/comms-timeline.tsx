'use client'

import { useState } from 'react'

// PL-77: the read-only family-comms timeline on the instructor's class card —
// the root fix for duplicate instructor emails ("families already got the
// classroom + start date Tuesday" is visible before the reflex to write one).
// Rows are grouped per email step (one line per template per day, families
// counted); each opens the rendered email exactly as families saw/will see
// it. No admin controls here on purpose.

export type TimelineItem = {
  /** A representative email_sends id for the render. */
  previewId: string
  label: string
  when: string // display string
  sortKey: string
  state: 'sent' | 'upcoming' | 'cancelled'
  recipients: number
}

const STATE_STYLES: Record<TimelineItem['state'], string> = {
  sent: 'bg-green-100 text-green-700',
  upcoming: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-gray-200 text-gray-500 line-through',
}

export default function CommsTimeline({ items }: { items: TimelineItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string | null; note?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function open(item: TimelineItem) {
    if (openId === item.previewId) {
      setOpenId(null)
      setPreview(null)
      return
    }
    setOpenId(item.previewId)
    setPreview(null)
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/portal/comms-preview?id=${item.previewId}`)
      const json = await res.json()
      if (!res.ok) setError(json.error ?? 'Could not load the email.')
      else setPreview(json)
    } catch {
      setError('Could not load the email.')
    }
    setLoading(false)
  }

  if (items.length === 0) {
    return <p className="text-sm text-gray-500">No family emails for this class yet.</p>
  }

  return (
    <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
      {items.map((item) => (
        <li key={item.previewId + item.state}>
          <button
            onClick={() => open(item)}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 flex-wrap"
          >
            <span
              className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide ${STATE_STYLES[item.state]}`}
            >
              {item.state}
            </span>
            <span className="font-medium text-gray-800">{item.label}</span>
            <span className="text-gray-400 text-xs">
              {item.when}
              {item.recipients > 1 ? ` · ${item.recipients} families` : ''}
            </span>
          </button>
          {openId === item.previewId && (
            <div className="border-t border-gray-100 bg-gray-50 p-3">
              {loading && <p className="text-xs text-gray-400">Loading the email…</p>}
              {error && <p className="text-xs text-red-600">{error}</p>}
              {preview && (
                <>
                  <p className="text-xs font-semibold text-gray-600 mb-2">
                    Subject: {preview.subject}
                  </p>
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
  )
}
