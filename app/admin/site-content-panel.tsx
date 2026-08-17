'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { imageAttrs, parseClassPageImage } from '../utils/class-page-images'

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
  image: unknown
  /** PL-373: online-class variant. */
  image_online?: unknown
  scope?: string | null
  course_key?: string | null
  class_id?: string | null
  updated_at: string
  updated_by: string | null
  /** PL-377: approval marker — a review is not an edit. */
  reviewed_by: string | null
  reviewed_at: string | null
}

// PL-351: per-block image controls — upload (alt text REQUIRED first),
// replace, alt/layout edits, and remove behind an inline confirm.
function BlockImageControls({
  blockKey,
  image,
  onChanged,
  target = 'block',
  emptyLabel = 'no image — text-only block',
}: {
  blockKey: string
  image: unknown
  onChanged: () => void
  /** PL-373: 'block-online' edits the online-class variant. */
  target?: 'block' | 'block-online'
  emptyLabel?: string
}) {
  const img = parseClassPageImage(image)
  const [alt, setAlt] = useState(img?.alt ?? '')
  const [layout, setLayout] = useState(img?.layout ?? 'right')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [msg, setMsg] = useState('')

  async function upload(file: File) {
    setBusy(true)
    setMsg('')
    try {
      const body = new FormData()
      body.set('target', target)
      body.set('key', blockKey)
      body.set('file', file)
      body.set('alt', alt)
      body.set('layout', layout)
      const res = await fetch('/api/admin/site-content/image', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setMsg(json.error ?? 'Upload failed.')
      else onChanged()
    } finally {
      setBusy(false)
    }
  }
  async function saveMeta() {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/site-content/image', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, key: blockKey, alt, layout }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setMsg(json.error ?? 'Saving failed.')
      else onChanged()
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/site-content/image', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, key: blockKey }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setMsg(json.error ?? 'Removing failed.')
      else {
        setConfirmRemove(false)
        onChanged()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 border-t border-dashed border-gray-200 pt-2">
      <div className="flex flex-wrap items-start gap-3">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageAttrs(img).src}
            alt={img.alt}
            className="h-20 w-auto rounded border border-gray-200 object-cover"
          />
        ) : (
          <span className="text-xs text-gray-400 italic self-center">{emptyLabel}</span>
        )}
        <div className="flex-1 min-w-56 space-y-1.5">
          <input
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Alt text (required) — describe the image"
            className="w-full border border-gray-300 rounded p-1.5 text-xs"
            aria-label={`Image alt text for ${blockKey}`}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value as 'left' | 'right' | 'hero')}
              className="border border-gray-300 rounded p-1 bg-white"
              aria-label={`Image layout for ${blockKey}`}
            >
              <option value="left">Image left of the text</option>
              <option value="right">Image right of the text</option>
              <option value="hero">Full width above the text</option>
            </select>
            <label className={`underline cursor-pointer ${alt.trim() ? 'text-hgl-blue' : 'text-gray-400 cursor-not-allowed'}`}>
              {img ? 'replace image' : 'upload image'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={busy || !alt.trim()}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) upload(f)
                }}
              />
            </label>
            {img && (
              <button onClick={saveMeta} disabled={busy || !alt.trim()} className="text-hgl-blue underline disabled:opacity-40">
                save alt/layout
              </button>
            )}
            {img && !confirmRemove && (
              <button onClick={() => setConfirmRemove(true)} disabled={busy} className="text-red-600 underline">
                remove…
              </button>
            )}
          </div>
          {!alt.trim() && <p className="text-xs text-gray-400">Add alt text first — uploads without it are refused.</p>}
          {confirmRemove && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs space-x-2">
              <span className="text-red-900">{target === 'block-online' ? 'Remove the online variant? Online classes fall back to the main image.' : 'Remove this image from every class page?'}</span>
              <button onClick={remove} disabled={busy} className="font-bold text-red-700 underline">
                Remove it
              </button>
              <button onClick={() => setConfirmRemove(false)} disabled={busy} className="text-gray-600 underline">
                Keep it
              </button>
            </div>
          )}
          {msg && <p className="text-xs text-red-600">{msg}</p>}
        </div>
      </div>
    </div>
  )
}

const SECTION_LABELS: Record<string, string> = {
  included: "What's included in a class? (four cards)",
  // PL-352/357: the upsell is OUT of the landing page and this block IS the
  // registration flow's second-page copy — the label tells the truth now.
  pitch: '1-on-1 tutoring pitch — shown on the registration flow’s second page (the "Add 1-on-1 tutoring?" step), not on class pages. Edit here.',
  instructors: 'Instructors',
  faq: 'FAQs (write questions as "### Question" lines, answers underneath)',
  closing: 'Closing call-to-action (the price renders from each class record — never type prices here)',
  'fine-print': 'Fine print',
  states: 'Honest-state copy (full class · no active class)',
}

// PL-367: shared sections in the order the /c page renders them; 'pitch' is
// flow-only and lives in its own last group.
const SECTION_ORDER = ['included', 'instructors', 'faq', 'closing', 'fine-print', 'states']

// PL-369: conditional blocks say WHEN they show — the walkthrough must read
// honestly. Conditions live in the /c renderer (facts from the class
// record); these labels only describe them.
const BLOCK_CONDITIONS: Record<string, string> = {
  'included-instruction':
    'Shows for every class. When the class is ONLINE, the title automatically reads "Live online class instruction" (only while the heading is the default).',
  'included-strategy':
    "Shows only for SCHOOL classes — open-enrollment/HGL-taught classes don't include strategy sessions.",
  'included-exams': 'Shows only when the class has diagnostic tests (the wizard checkbox).',
  'faq-strategy': 'Shows only for SCHOOL classes (same rule as the strategy-sessions card).',
  'faq-diagnostics': 'Shows only when the class has diagnostic tests.',
}

type PreviewInfo = {
  shared: { url: string; sample: boolean }
  courses: Record<string, { displayName: string; url: string; sample: boolean }>
  flow: { url: string } | null
}

// PL-367 B: the inline preview IS the real page (iframe of the same /c URL
// the link opens) — never a parallel approximation. `nonce` remounts the
// iframe, so saves auto-refresh it.
function InlinePreview({ url, nonce }: { url: string; nonce: number }) {
  return (
    <iframe
      key={`${url}:${nonce}`}
      src={url}
      title={`Live preview of ${url}`}
      className="w-full h-[600px] border border-gray-300 rounded-lg bg-white"
      sandbox="allow-same-origin allow-scripts"
    />
  )
}

function GroupHeader({
  label,
  rows,
  preview,
  sampleNote,
  previewOpen,
  onToggleGroup,
  onTogglePreview,
  onRefreshPreview,
  onMarkAllReviewed,
}: {
  label: string
  rows: Block[]
  preview: string | null
  sampleNote: boolean
  previewOpen: boolean
  onToggleGroup: () => void
  onTogglePreview: () => void
  onRefreshPreview: () => void
  onMarkAllReviewed: (keys: string[]) => void
}) {
  const unreviewedRows = rows.filter((b) => !b.updated_by && !b.reviewed_by)
  const unreviewed = unreviewedRows.length
  return (
    <summary
      onClick={(e) => {
        // State-driven open/closed — the native toggle would fight React's
        // re-renders (typing in a card would snap groups shut).
        e.preventDefault()
        onToggleGroup()
      }}
      className="cursor-pointer list-none flex flex-wrap items-center gap-2 select-none"
    >
      <span aria-hidden className="text-gray-400 text-xs transition-transform group-open:rotate-90">▶</span>
      <span className="text-sm font-bold text-hgl-slate">{label}</span>
      <span className="text-xs text-gray-400">{rows.length} block{rows.length === 1 ? '' : 's'}</span>
      {unreviewed > 0 && (
        <>
          <span className="text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300 rounded-full px-2 py-0.5">
            {unreviewed} not yet reviewed
          </span>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onMarkAllReviewed(unreviewedRows.map((b) => b.key))
            }}
            className="text-xs text-hgl-blue underline"
            title="Approve every unreviewed block in this group as-is"
          >
            mark all reviewed
          </button>
        </>
      )}
      <span className="flex-1" />
      {preview && (
        <>
          <a
            href={preview}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-hgl-blue underline"
          >
            Preview a page using these blocks →
          </a>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onTogglePreview()
            }}
            className="text-xs text-hgl-blue underline"
          >
            {previewOpen ? 'hide inline preview' : 'preview here'}
          </button>
          {previewOpen && (
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRefreshPreview()
              }}
              className="text-xs text-gray-500 underline"
            >
              refresh
            </button>
          )}
          {sampleNote && (
            <span className="text-[11px] text-amber-700">
              (no class uses this set yet — previews a labeled sample class)
            </span>
          )}
        </>
      )}
    </summary>
  )
}

export default function SiteContentPanel() {
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [preview, setPreview] = useState<PreviewInfo | null>(null)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, { heading: string; body_markdown: string }>>({})
  const [busyKey, setBusyKey] = useState('')
  const [savedKey, setSavedKey] = useState('')
  // PL-367 B: which groups have their inline preview pane open, and the
  // nonce that remounts every open iframe (bumped on each successful save —
  // edit → save → see is one surface).
  const [openPreviews, setOpenPreviews] = useState<Record<string, boolean>>({})
  const [previewNonce, setPreviewNonce] = useState(0)
  // PL-367 A: explicit open/closed per group — initialized ONCE from the
  // first load (groups with unreviewed seeds start open, so the badges
  // point at something visible).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/site-content')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? `The server returned ${res.status}.`)
        return
      }
      const rows: Block[] = json.blocks ?? []
      setBlocks(rows)
      setPreview(json.preview ?? null)
      setOpenGroups((prev) => {
        if (prev) return prev
        const unreviewed = (f: (b: Block) => boolean) => rows.some((b) => f(b) && !b.updated_by && !b.reviewed_by)
        const initial: Record<string, boolean> = {
          shared: unreviewed((b) => (!b.scope || b.scope === 'shared') && b.section !== 'pitch'),
          flow: unreviewed((b) => (!b.scope || b.scope === 'shared') && b.section === 'pitch'),
          'per-class': unreviewed((b) => b.scope === 'class'),
        }
        for (const b of rows) {
          if (b.scope === 'course' && b.course_key) {
            initial[`course:${b.course_key}`] =
              initial[`course:${b.course_key}`] || (!b.updated_by && !b.reviewed_by)
          }
        }
        return initial
      })
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
      // PL-367: every open inline preview reloads — save → see.
      setPreviewNonce((n) => n + 1)
    } finally {
      setBusyKey('')
    }
  }

  if (error && !blocks) return <p className="text-sm text-red-600">{error}</p>
  if (!blocks) return <p className="text-sm text-gray-500">Loading…</p>

  const isShared = (b: Block) => !b.scope || b.scope === 'shared'
  // PL-355: course-type block sets, grouped per course key — inherited by
  // every class of that course automatically.
  const courseKeys = [...new Set(blocks.filter((b) => b.scope === 'course').map((b) => b.course_key ?? ''))]
    .filter(Boolean)
    .sort()
  const classScoped = blocks.filter((b) => b.scope === 'class')
  const sharedRows = blocks.filter((b) => isShared(b) && b.section !== 'pitch')
  const flowRows = blocks.filter((b) => isShared(b) && b.section === 'pitch')

  const blockChanged = () => {
    load()
    setPreviewNonce((n) => n + 1)
  }

  // PL-377: approve-as-is — a review marker, never a fake edit.
  const markReviewed = async (keys: string[]) => {
    const res = await fetch('/api/admin/site-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_reviewed', keys }),
    })
    if (res.ok) load()
    else setError((await res.json().catch(() => ({}))).error ?? 'Marking failed.')
  }

  const blockCard = (b: Block) => {
    const d = draftFor(b)
    return (
      <div key={b.key} className="border border-gray-200 rounded-lg p-4 bg-white">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <input
            type="text"
            value={d.heading}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [b.key]: { ...d, heading: e.target.value } }))}
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
        {BLOCK_CONDITIONS[b.key] && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1 mb-2">
            {BLOCK_CONDITIONS[b.key]}
          </p>
        )}
        <textarea
          value={d.body_markdown}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [b.key]: { ...d, body_markdown: e.target.value } }))}
          rows={Math.min(16, Math.max(4, d.body_markdown.split('\n').length + 1))}
          className="w-full border border-gray-300 rounded p-2 text-sm font-mono"
          aria-label={`Content for ${b.key}`}
        />
        <p className="text-xs text-gray-400 mt-1">
          {savedKey === b.key && <span className="text-green-700 font-semibold">Saved. </span>}
          {isDirty(b) && savedKey !== b.key && <span className="text-amber-700">Unsaved changes. </span>}
          Last changed {new Date(b.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
          {b.updated_by ? (
            ` by ${b.updated_by}`
          ) : b.reviewed_by ? (
            // PL-377: approval marker, honestly separate from edits.
            ` — approved as-is by ${b.reviewed_by}${b.reviewed_at ? `, ${new Date(b.reviewed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}` : ''}`
          ) : (
            <>
              {' (seeded copy — not yet reviewed) '}
              <button
                onClick={() => markReviewed([b.key])}
                className="text-hgl-blue underline"
                title="Approve this copy as-is — records you as the reviewer without counting as an edit"
              >
                mark reviewed
              </button>
            </>
          )}
        </p>
        <BlockImageControls blockKey={b.key} image={b.image} onChanged={blockChanged} />
        {/* PL-373: the online-class variant — shown when the class's
            delivery mode is online; blank = the main image everywhere. */}
        <p className="text-[11px] text-gray-500 mt-2 mb-0.5 font-semibold">
          Image shown for online classes (optional — blank means the image above shows for
          every class)
        </p>
        <BlockImageControls
          blockKey={b.key}
          image={(b as unknown as { image_online?: unknown }).image_online}
          onChanged={blockChanged}
          target="block-online"
          emptyLabel="no online variant — online classes show the main image"
        />
      </div>
    )
  }

  // PL-367 A: collapsible groups in page-render order — Shared first, one
  // group per course set (display-named), per-class rows, flow-only last.
  // Groups with unreviewed seeds start open so the badges point somewhere.
  const groupDef = (
    id: string,
    label: string,
    rows: Block[],
    previewUrl: string | null,
    sampleNote: boolean,
    body: ReactNode
  ) => (
    <details
      key={id}
      className="group border border-gray-200 rounded-lg p-3 bg-gray-50/50"
      open={Boolean(openGroups?.[id])}
    >
      <GroupHeader
        label={label}
        rows={rows}
        preview={previewUrl}
        sampleNote={sampleNote}
        previewOpen={Boolean(openPreviews[id])}
        onToggleGroup={() => setOpenGroups((p) => ({ ...(p ?? {}), [id]: !p?.[id] }))}
        onTogglePreview={() => setOpenPreviews((p) => ({ ...p, [id]: !p[id] }))}
        onRefreshPreview={() => setPreviewNonce((n) => n + 1)}
        onMarkAllReviewed={markReviewed}
      />
      {openPreviews[id] && previewUrl && (
        <div className="mt-3">
          <InlinePreview url={previewUrl} nonce={previewNonce} />
        </div>
      )}
      <div className="mt-3 space-y-4">{body}</div>
    </details>
  )

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        These blocks render on the public class pages (/c/…), below the class-specific top —
        shared blocks on EVERY page, course blocks on every class of that course, edit once and
        all matching pages update. Class facts (price, schedule, deadline) always come from
        the class record, never from this copy. Formatting: **bold**, [link](https://…),
        &quot;- &quot; lists, and &quot;### &quot; sub-headings (FAQ questions). {'{address}'},
        {' {examName}'}, {'{examRegistrationLink}'}, {'{instructionHours}'} (summed from the
        class&apos;s real sessions — &quot;8 hours&quot;), and {'{practiceTestCount}'} (&quot;2
        full-length practice tests&quot;, pluralized automatically) fill in from each class record
        in SHARED and course blocks alike (PSAT classes get school-based registration wording
        instead of a link).
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {groupDef(
        'shared',
        'Shared — every class page',
        sharedRows,
        preview?.shared?.url ?? null,
        Boolean(preview?.shared?.sample),
        SECTION_ORDER.filter((s) => sharedRows.some((b) => b.section === s)).map((section) => (
          <div key={section}>
            <h5 className="text-xs font-bold text-gray-600 mb-2">{SECTION_LABELS[section] ?? section}</h5>
            <div className="space-y-4">
              {sharedRows.filter((b) => b.section === section).map(blockCard)}
            </div>
          </div>
        ))
      )}

      {courseKeys.map((ck) =>
        groupDef(
          `course:${ck}`,
          `${preview?.courses?.[ck]?.displayName ?? ck} — course set (every class of this course inherits these)`,
          blocks.filter((b) => b.scope === 'course' && b.course_key === ck),
          preview?.courses?.[ck]?.url ?? `/c/sample--${ck}`,
          Boolean(preview?.courses?.[ck]?.sample),
          blocks
            .filter((b) => b.scope === 'course' && b.course_key === ck)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(blockCard)
        )
      )}

      <MintCourseSet existingKeys={courseKeys} onMinted={load} />

      {classScoped.length > 0 &&
        groupDef(
          'per-class',
          'Per-class blocks (each renders on exactly one class page)',
          classScoped,
          null,
          false,
          classScoped.map(blockCard)
        )}

      {flowRows.length > 0 &&
        groupDef(
          'flow',
          'Registration flow only — not on class pages',
          flowRows,
          preview?.flow?.url ?? null,
          false,
          <>
            {preview?.flow?.url && (
              <p className="text-xs text-gray-500">
                The preview opens the registration flow — this copy appears on its second step
                (&ldquo;Add 1-on-1 tutoring?&rdquo;).
              </p>
            )}
            {flowRows.map(blockCard)}
          </>
        )}
    </div>
  )
}

// PL-355: minting a NEW course's block set is a first-class action — a
// future follow-up course means new blocks here, never a code change.
function MintCourseSet({ existingKeys, onMinted }: { existingKeys: string[]; onMinted: () => void }) {
  const [courseKey, setCourseKey] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h4 className="text-sm font-bold text-hgl-slate mb-1">Mint a new course block set</h4>
      <p className="text-xs text-gray-500 mb-3">
        For a NEW course (a future follow-up, a new local class type). The course key must match
        what the wizard derives from the class type — lowercase with dashes, e.g. class type
        &ldquo;ACT Prep&rdquo; → <span className="font-mono">act-prep</span>. Copying an existing
        course starts you from its copy; blank starts a skeleton.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">Course key</label>
          <input
            type="text"
            value={courseKey}
            onChange={(e) => setCourseKey(e.target.value.toLowerCase())}
            placeholder="act-prep"
            className="mt-1 border border-gray-300 rounded p-1.5 text-sm w-56 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Start from</label>
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            className="mt-1 border border-gray-300 rounded p-1.5 bg-white text-sm"
          >
            <option value="">Blank skeleton</option>
            {existingKeys.map((k) => (
              <option key={k} value={k}>Copy of {k}</option>
            ))}
          </select>
        </div>
        <button
          disabled={busy || !courseKey.trim()}
          onClick={async () => {
            setBusy(true)
            setMsg('')
            try {
              const res = await fetch('/api/admin/site-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'mint', courseKey: courseKey.trim(), copyFrom: copyFrom || null }),
              })
              const json = await res.json().catch(() => ({}))
              if (!res.ok) setMsg(json.error ?? 'Minting failed.')
              else {
                setMsg(`Minted ${json.minted} blocks for '${courseKey.trim()}' — edit them above.`)
                setCourseKey('')
                setCopyFrom('')
                onMinted()
              }
            } finally {
              setBusy(false)
            }
          }}
          className="bg-hgl-slate text-white text-xs font-bold py-2 px-4 rounded disabled:opacity-40"
        >
          {busy ? 'Minting…' : 'Mint the block set'}
        </button>
      </div>
      {msg && <p className={`text-xs mt-2 ${msg.startsWith('Minted') ? 'text-green-700' : 'text-red-600'}`}>{msg}</p>}
    </div>
  )
}
