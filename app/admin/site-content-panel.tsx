'use client'

import { useCallback, useEffect, useState } from 'react'

// PL-348: Settings → Class pages — the shared content every public /c/{slug}
// page renders below its class-specific top. Edit once, every class page
// updates on its next load (the pages render live). Copy was seeded from the
// old Squarespace class pages and is Scarlett's to approve/rewrite here.

type Block = {
  key: string
  section: string
  heading: string
  body_markdown: string
  sort_order: number
  updated_at: string
  updated_by: string | null
}

const SECTION_LABELS: Record<string, string> = {
  included: "What's included in a class? (four cards)",
  // PL-352 (amendment): the upsell is OUT of the landing page — this copy is
  // kept here for the registration flow only.
  pitch: '1-on-1 tutoring pitch — NOT shown on class pages (the upsell lives on the registration flow’s second page)',
  instructors: 'Instructors',
  faq: 'FAQs (write questions as "### Question" lines, answers underneath)',
  closing: 'Closing call-to-action (the price renders from each class record — never type prices here)',
  'fine-print': 'Fine print',
  states: 'Honest-state copy (full class · no active class)',
}

const SECTION_ORDER = ['included', 'pitch', 'instructors', 'faq', 'closing', 'fine-print', 'states']

export default function SiteContentPanel() {
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, { heading: string; body_markdown: string }>>({})
  const [busyKey, setBusyKey] = useState('')
  const [savedKey, setSavedKey] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/site-content')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? `The server returned ${res.status}.`)
        return
      }
      setBlocks(json.blocks ?? [])
      setError('')
    } catch {
      setError("Couldn't load the content blocks — check your connection.")
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const draftFor = (b: Block) => drafts[b.key] ?? { heading: b.heading, body_markdown: b.body_markdown }
  const isDirty = (b: Block) => {
    const d = draftFor(b)
    return d.heading !== b.heading || d.body_markdown !== b.body_markdown
  }

  async function save(b: Block) {
    const d = draftFor(b)
    setBusyKey(b.key)
    setSavedKey('')
    try {
      const res = await fetch('/api/admin/site-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: b.key, heading: d.heading, body_markdown: d.body_markdown }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'That save failed.')
        return
      }
      setError('')
      setSavedKey(b.key)
      setBlocks((prev) =>
        (prev ?? []).map((x) => (x.key === b.key ? { ...x, heading: d.heading, body_markdown: d.body_markdown } : x))
      )
      setDrafts((prev) => {
        const { [b.key]: _gone, ...rest } = prev
        return rest
      })
    } finally {
      setBusyKey('')
    }
  }

  if (error && !blocks) return <p className="text-sm text-red-600">{error}</p>
  if (!blocks) return <p className="text-sm text-gray-500">Loading…</p>

  const sections = SECTION_ORDER.filter((s) => blocks.some((b) => b.section === s))

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">
        These blocks render on EVERY public class page (/c/…), below the class-specific top —
        edit once, all pages update. Class facts (price, schedule, deadline) always come from
        the class record, never from this copy. Formatting: **bold**, [link](https://…),
        &quot;- &quot; lists, and &quot;### &quot; sub-headings (FAQ questions).
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {sections.map((section) => (
        <div key={section}>
          <h4 className="text-sm font-bold text-hgl-slate mb-2">{SECTION_LABELS[section] ?? section}</h4>
          <div className="space-y-4">
            {blocks
              .filter((b) => b.section === section)
              .map((b) => {
                const d = draftFor(b)
                return (
                  <div key={b.key} className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={d.heading}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [b.key]: { ...d, heading: e.target.value } }))
                        }
                        className="flex-1 min-w-48 border border-gray-300 rounded p-1.5 text-sm font-semibold"
                        aria-label={`Heading for ${b.key}`}
                      />
                      <button
                        onClick={() => save(b)}
                        disabled={busyKey === b.key || !isDirty(b)}
                        className="bg-hgl-slate text-white text-xs font-bold py-1.5 px-4 rounded disabled:opacity-40"
                      >
                        {busyKey === b.key ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    <textarea
                      value={d.body_markdown}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [b.key]: { ...d, body_markdown: e.target.value } }))
                      }
                      rows={Math.min(16, Math.max(4, d.body_markdown.split('\n').length + 1))}
                      className="w-full border border-gray-300 rounded p-2 text-sm font-mono"
                      aria-label={`Content for ${b.key}`}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      {savedKey === b.key && <span className="text-green-700 font-semibold">Saved. </span>}
                      {isDirty(b) && savedKey !== b.key && <span className="text-amber-700">Unsaved changes. </span>}
                      Last changed {new Date(b.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                      {b.updated_by ? ` by ${b.updated_by}` : ' (seeded copy — not yet reviewed)'}
                    </p>
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
