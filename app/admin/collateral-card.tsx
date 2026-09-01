'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { fetchErrorLine } from '../utils/fetch-error'
import { flyerIntroDefault } from '../utils/collateral-shared'
import { imageAttrs, parseClassPageImage } from '../utils/class-page-images'
import { DateHint } from './ui'
import type { School } from './class-wizard'

// Phase 4.5 admin Collateral card (spec §7): download buttons + preview
// thumbnails for the four generated artifacts, plus the class fields that
// drive them. Downloads always render live data, so edits here show up in
// the very next download — nothing is stored.

export type CollateralFields = {
  collateral_language: string | null
  flyer_blurb: string | null
  letter_blurb: string | null
  letter_blurb_es: string | null
  practice_test_count: number | null
  promo_code: string | null
  promo_amount: number | null
  promo_deadline: string | null
  /** PL-348: hero bullets on the public /c/{slug} page, one per line. */
  selling_bullets?: string | null
  /** PL-351: the class's hero photo descriptor (class-page-images shape). */
  hero_image?: unknown
  /** PL-355: prerequisite line near the bullets. */
  prerequisite_note?: string | null
}

// PL-449: preview thumbnails FETCH the artifact so a failure can show the
// route's plain reason — the old bare <img> swallowed every 400/500 body
// into a broken-image icon (the MIS incident read as mysterious alt-text
// boxes with no explanation anywhere).
function PreviewThumb({ url, label }: { url: string; label: string }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ok'; src: string } | { kind: 'error'; message: string }
  >({ kind: 'loading' })
  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    setState({ kind: 'loading' })
    fetch(url)
      .then(async (res) => {
        if (!alive) return
        if (!res.ok) {
          setState({ kind: 'error', message: await fetchErrorLine(res, 'render this preview') })
          return
        }
        objectUrl = URL.createObjectURL(await res.blob())
        if (alive) setState({ kind: 'ok', src: objectUrl })
      })
      .catch(() => {
        if (alive)
          setState({
            kind: 'error',
            message: "Couldn't render this preview — the server didn't answer; try again.",
          })
      })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  if (state.kind === 'ok') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={state.src} alt={label} className="w-40 border border-gray-300 rounded shadow-sm" />
  }
  return (
    <div className="w-40 min-h-52 border border-gray-300 rounded shadow-sm bg-white p-2 text-[11px] leading-snug text-gray-600 flex items-center">
      {state.kind === 'loading' ? (
        <span className="animate-pulse text-gray-400">Rendering {label}…</span>
      ) : (
        <span className="text-red-600">{state.message}</span>
      )}
    </div>
  )
}

// PL-351: the per-class hero photo — upload (alt required), replace, remove
// with an inline confirm. Writes go through the staff-gated image route.
function HeroImageControl({
  classId,
  image,
  onChanged,
}: {
  classId: string
  image: unknown
  onChanged: () => void
}) {
  const img = parseClassPageImage(image)
  const [alt, setAlt] = useState(img?.alt ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [msg, setMsg] = useState('')

  async function call(init: RequestInit) {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/site-content/image', init)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(json.error ?? 'That image change failed.')
        return false
      }
      onChanged()
      return true
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-3 border border-gray-200 rounded p-2.5">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageAttrs(img).src} alt={img.alt} className="h-16 w-auto rounded border border-gray-200 object-cover" />
      ) : (
        <span className="text-xs text-gray-400 italic self-center">no photo — the page shows the branded hero alone</span>
      )}
      <div className="flex-1 min-w-56 space-y-1.5 text-xs">
        <input
          type="text"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Alt text (required) — describe the photo"
          className="w-full border border-gray-300 rounded p-1.5"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className={`underline cursor-pointer ${alt.trim() ? 'text-hgl-blue' : 'text-gray-400 cursor-not-allowed'}`}>
            {img ? 'replace photo' : 'upload photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={busy || !alt.trim()}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const body = new FormData()
                body.set('target', 'class-hero')
                body.set('classId', classId)
                body.set('file', f)
                body.set('alt', alt)
                call({ method: 'POST', body })
              }}
            />
          </label>
          {img && (
            <button
              onClick={() =>
                call({
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ target: 'class-hero', classId, alt }),
                })
              }
              disabled={busy || !alt.trim()}
              className="text-hgl-blue underline disabled:opacity-40"
            >
              save alt text
            </button>
          )}
          {img && !confirmRemove && (
            <button onClick={() => setConfirmRemove(true)} disabled={busy} className="text-red-600 underline">
              remove…
            </button>
          )}
        </div>
        {confirmRemove && (
          <div className="bg-red-50 border border-red-200 rounded p-2 space-x-2">
            <span className="text-red-900">Remove the hero photo from this class&apos;s public page?</span>
            <button
              onClick={async () => {
                const ok = await call({
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ target: 'class-hero', classId }),
                })
                if (ok) setConfirmRemove(false)
              }}
              disabled={busy}
              className="font-bold text-red-700 underline"
            >
              Remove it
            </button>
            <button onClick={() => setConfirmRemove(false)} disabled={busy} className="text-gray-600 underline">
              Keep it
            </button>
          </div>
        )}
        {msg && <p className="text-red-600">{msg}</p>}
      </div>
    </div>
  )
}

export default function CollateralCard({
  classId,
  classType,
  inPerson,
  sessionDates,
  fields,
  school,
  onSaved,
  slug = null,
  pageFacts = null,
}: {
  classId: string
  classType: string
  inPerson: boolean
  sessionDates: string[]
  fields: CollateralFields
  school: (School & { collateral_language?: string | null }) | null
  onSaved: () => void
  /** PL-348: the class slug — shown as the public page link when present. */
  slug?: string | null
  /** PL-450: the class's resolved code facts (the admin page's evergreen
   *  map) — drives the read-only printed-link display and the nudge. */
  pageFacts?: { code: string | null; servesThisClass: boolean } | null
}) {
  const [form, setForm] = useState({
    collateral_language: fields.collateral_language ?? '',
    flyer_blurb: fields.flyer_blurb ?? '',
    letter_blurb: fields.letter_blurb ?? '',
    letter_blurb_es: fields.letter_blurb_es ?? '',
    practice_test_count: String(fields.practice_test_count ?? 2),
    promo_code: fields.promo_code ?? '',
    promo_amount: fields.promo_amount != null ? String(fields.promo_amount) : '',
    promo_deadline: fields.promo_deadline ?? '',
    selling_bullets: fields.selling_bullets ?? '',
    prerequisite_note: fields.prerequisite_note ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showPreviews, setShowPreviews] = useState(false)
  // PL-214: the admin-initiated CS welcome send (button, never automation).
  const [sendingCs, setSendingCs] = useState(false)
  // PL-225 B: the send dialog — recipients, the include-the-announcement
  // checkbox (heuristic default; the admin always confirms — portal history
  // starts 2026-07-20, so long-standing partners can look new in the data),
  // and a preview that reflects the toggle.
  const [csDialog, setCsDialog] = useState<null | {
    loading: boolean
    counselors: { email: string; name: string; priorCs: boolean }[]
    schoolHasCompletedClass: boolean
    defaultInclude: boolean
    include: boolean
    canSuppress: boolean
    previews: { include: string; exclude: string } | null
    // PL-449: when the preview can't render, the panel says WHAT failed.
    previewsMissingReason?: string | null
    // PL-449 amendment 2: the exact files the send will carry — visible
    // BEFORE any send (the panel contract).
    attachmentNames?: string[]
    logoNote?: string | null
    // PL-237: the collateral fork — attachments on/off + the explicit
    // second confirm the no-collateral send requires.
    includeCollateral: boolean
    confirmNoCollateral: boolean
    ncSendOnRecord: boolean
    error?: string
  }>(null)
  const [sendingFollowup, setSendingFollowup] = useState(false)
  // Cache-buster so reopened previews reflect saved edits.
  const [previewNonce, setPreviewNonce] = useState(0)

  const schoolDefault = school?.collateral_language ?? 'en'
  const effectiveLang = form.collateral_language || schoolDefault
  const langs = effectiveLang === 'both' ? (['en', 'es'] as const) : ([effectiveLang] as const)
  const promoPartial =
    [form.promo_code.trim(), form.promo_amount.trim(), form.promo_deadline].filter(Boolean).length %
      3 !==
    0

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const { error } = await supabase
      .from('classes')
      .update({
        collateral_language: form.collateral_language || null,
        flyer_blurb: form.flyer_blurb.trim() || null,
        letter_blurb: form.letter_blurb.trim() || null,
        letter_blurb_es: form.letter_blurb_es.trim() || null,
        practice_test_count: Math.max(0, parseInt(form.practice_test_count, 10) || 2),
        promo_code: form.promo_code.trim() || null,
        promo_amount: form.promo_amount.trim() ? Number(form.promo_amount) : null,
        promo_deadline: form.promo_deadline || null,
        // PL-429: saving collateral IS completing it — the wizard's
        // skip-for-now stamp clears, which retires the dashboard reminder
        // and cancels the email nudge (post-PL-384 the evergreen link made
        // "short_link set" a stale completion proxy; this is the real one).
        collateral_reminder_at: null,
        // PL-348 ship-dark guard: only write the column once the migration
        // has landed (the loaded row carries the key) — otherwise EVERY
        // collateral save would break on the unknown column.
        ...('selling_bullets' in fields ? { selling_bullets: form.selling_bullets.trim() || null } : {}),
        ...('prerequisite_note' in fields ? { prerequisite_note: form.prerequisite_note.trim() || null } : {}),
      })
      .eq('id', classId)
    setSaving(false)
    if (error) {
      setMessage('Error saving: ' + error.message)
      return
    }
    setMessage('Saved — downloads now use the new values.')
    setPreviewNonce((n) => n + 1)
    onSaved()
  }

  const artifactUrl = (artifact: string, lang: string, inline = false) =>
    `/api/classes/${classId}/collateral/${artifact}?lang=${lang}${inline ? `&inline=1&v=${previewNonce}` : ''}`

  const label = (base: string, lang: string) =>
    langs.length > 1 ? `${base} (${lang.toUpperCase()})` : base

  return (
    <div className="p-6 border-b border-gray-200">
      <h4 className="font-semibold text-hgl-slate mb-1">Collateral</h4>
      <p className="text-xs text-gray-500 mb-3">
        Flyer + parent letter, generated from the class record — always current, so re-download
        after any schedule change. Language: <strong>{effectiveLang}</strong>
        {form.collateral_language ? ' (class override)' : ` (school default)`}
      </p>

      {/* PL-450: the printed link composes from the school/course evergreen
          code (Classes → Short links) — read-only here, one place to edit.
          Codeless → the honest full URL prints, with the nudge below. */}
      {!(pageFacts?.code && pageFacts.servesThisClass) && (
        <p className="mb-3 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          No short code is serving this class — the flyer prints the full registration URL.
          Add {pageFacts?.code ? 'or repoint' : ''} the school&rsquo;s code in Classes → Short
          links for a printable hgl.co link.
        </p>
      )}

      {/* PL-449 soft-fail note: a missing logo degrades ONE element (the
          name renders in the slot), never the document — but say so. */}
      {school && !school.logo_url && (
        <p className="mb-3 text-xs text-amber-700">
          School logo missing — the flyer shows the school name in its place. Upload the logo
          under Classes → Schools.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {langs.map((lang) => (
          <span key={lang} className="flex flex-wrap gap-2">
            {(
              [
                ['flyer.pdf', 'Flyer PDF'],
                ['flyer.jpg', 'Flyer JPG'],
                ['letter.pdf', 'Letter PDF'],
                ['letter.jpg', 'Letter JPG'],
              ] as const
            ).map(([artifact, name]) => (
              <a
                key={artifact + lang}
                href={artifactUrl(artifact, lang)}
                target="_blank"
                rel="noopener"
                className="bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-hgl-blue-hover transition"
              >
                {label(name, lang)}
              </a>
            ))}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setShowPreviews((v) => !v)}
          className="text-xs text-gray-500 underline hover:text-hgl-blue"
        >
          {showPreviews ? 'Hide previews' : 'Show previews'}
        </button>
      </div>

      {/* PL-219: the live performance report + admin-only PDF handouts. */}
      <p className="mb-3 text-xs">
        <a href={`/class-report/${classId}`} className="text-hgl-blue underline mr-3">
          Performance report (live) →
        </a>
        <a href={`/api/class-report-pdf?class=${classId}&flavor=anonymized`} className="text-hgl-blue underline mr-3">
          One-pager PDF (anonymized)
        </a>
        <a href={`/api/class-report-pdf?class=${classId}&flavor=named`} className="text-hgl-blue underline">
          One-pager PDF (named)
        </a>
      </p>

      {/* PL-214: the "class is ready" welcome to the school's counselor(s) —
          sales-page link + deadline, letter + flyer attached (generated
          fresh), the portal intro, and a forwardable sample announcement. */}
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          disabled={sendingCs || (csDialog?.loading ?? false)}
          onClick={async () => {
            if (csDialog) {
              setCsDialog(null)
              return
            }
            setCsDialog({
              loading: true,
              counselors: [],
              schoolHasCompletedClass: false,
              defaultInclude: true,
              include: true,
              canSuppress: false,
              previews: null,
              includeCollateral: true,
              confirmNoCollateral: false,
              ncSendOnRecord: false,
            })
            try {
              const res = await fetch(`/api/admin/class-confirmed?class_id=${classId}`)
              const json = await res.json().catch(() => ({}))
              if (!res.ok) {
                // PL-449C: name what failed + the honest status — never bare.
                setCsDialog((d) =>
                  d
                    ? {
                        ...d,
                        loading: false,
                        error: json.error
                          ? `Couldn't build the send preview — ${json.error} (HTTP ${res.status})`
                          : `Couldn't build the send preview (HTTP ${res.status}) — try again; if it keeps failing, tell Code.`,
                      }
                    : d
                )
                return
              }
              setCsDialog({
                loading: false,
                counselors: json.counselors ?? [],
                schoolHasCompletedClass: !!json.schoolHasCompletedClass,
                defaultInclude: !!json.defaultInclude,
                include: !!json.defaultInclude,
                canSuppress: !!json.canSuppress,
                previews: json.previews ?? null,
                previewsMissingReason: json.previewsMissingReason ?? null,
                attachmentNames: json.attachmentNames ?? [],
                logoNote: json.logoNote ?? null,
                includeCollateral: json.defaultIncludeCollateral !== false,
                confirmNoCollateral: false,
                ncSendOnRecord: !!json.ncSendOnRecord,
              })
            } catch {
              setCsDialog((d) =>
                d ? { ...d, loading: false, error: "Couldn't reach the server." } : d
              )
            }
          }}
          className="text-xs font-semibold bg-hgl-slate text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          {sendingCs ? 'Sending…' : csDialog ? 'Close send panel' : 'Send "class is ready" welcome to the school'}
        </button>
        <span className="text-xs text-gray-500">
          Letter + flyer attached, generated fresh. Needs the short link and deadline set.
        </span>
      </div>

      {csDialog && (
        <div className="mb-3 border border-gray-300 rounded-lg p-3 bg-gray-50 text-sm space-y-2">
          <p className="font-semibold text-hgl-slate">Send the &quot;everything&apos;s ready&quot; welcome</p>
          {csDialog.loading ? (
            <p className="text-xs text-gray-500 animate-pulse">Checking who this goes to…</p>
          ) : csDialog.error ? (
            <p className="text-xs text-red-600">{csDialog.error}</p>
          ) : (
            <>
              <p className="text-xs text-gray-600">
                Goes to every active contact at this school:{' '}
                <strong>{csDialog.counselors.map((c) => `${c.name} (${c.email})`).join(', ')}</strong>
                {' '}— sales-page link, deadline, portal intro, and the letter + flyer attached (generated fresh).
              </p>
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={csDialog.include}
                  onChange={(e) => setCsDialog((d) => (d ? { ...d, include: e.target.checked } : d))}
                  className="mt-0.5"
                />
                <span>
                  <strong>Include the sample announcement</strong>{' '}(the forwardable
                  &quot;we&apos;re partnering&quot; intro — for a new school or a new contact).{' '}
                  <span className="text-gray-500">
                    {csDialog.defaultInclude
                      ? 'Suggested: include — nothing on file says this school or contact has worked with us before.'
                      : csDialog.schoolHasCompletedClass
                        ? 'Suggested: leave it out — this school already has a completed class with us.'
                        : 'Suggested: leave it out — everyone listed has received this welcome before.'}
                    {' '}Portal history only goes back to July 2026, so trust your own read and flip this if it&apos;s wrong.
                  </span>
                </span>
              </label>
              {!csDialog.include && !csDialog.canSuppress && (
                <p className="text-xs text-amber-700">
                  Note: the template&apos;s announcement section couldn&apos;t be located (the copy has
                  changed since this was built) — if you send, the full email including the
                  announcement goes out.
                </p>
              )}
              {/* PL-237: the collateral fork — some schools don't want the docs. */}
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={csDialog.includeCollateral}
                  onChange={(e) =>
                    setCsDialog((d) =>
                      d ? { ...d, includeCollateral: e.target.checked, confirmNoCollateral: false } : d
                    )
                  }
                  className="mt-0.5"
                />
                <span>
                  <strong>Attach the letter + flyer</strong> (generated fresh at send time).
                  {!csDialog.includeCollateral && (
                    <span className="text-gray-500">
                      {' '}Leaving them off sends the same welcome — sales link, deadline, portal
                      intro — with no attachments and no &quot;I&apos;ve attached the materials&quot;
                      paragraph. You can send the materials later with the letter + flyer
                      follow-up from this card.
                    </span>
                  )}
                </span>
              </label>
              {!csDialog.includeCollateral && (
                <label className="flex items-start gap-2 text-xs cursor-pointer bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <input
                    type="checkbox"
                    checked={csDialog.confirmNoCollateral}
                    onChange={(e) =>
                      setCsDialog((d) => (d ? { ...d, confirmNoCollateral: e.target.checked } : d))
                    }
                    className="mt-0.5"
                  />
                  <span className="text-amber-900">
                    <strong>Yes — send it without the letter and flyer.</strong> The school gets
                    the &quot;everything&apos;s ready&quot; welcome and the sales link, but NO
                    printable materials in this email.
                  </span>
                </label>
              )}
              {/* PL-449 amendment 2 (the panel contract, confirmed with
                  Scarlett's expectation): the composed preview AND the exact
                  attachments are on screen BEFORE any send — the preview
                  opens expanded, never tucked away. */}
              {csDialog.includeCollateral && (csDialog.attachmentNames?.length ?? 0) > 0 && (
                <p className="text-xs text-gray-600">
                  Will attach (generated fresh at send):{' '}
                  {csDialog.attachmentNames!.map((n) => (
                    <code key={n} className="bg-gray-100 border border-gray-200 rounded px-1 mr-1">
                      {n}
                    </code>
                  ))}
                </p>
              )}
              {csDialog.logoNote && (
                <p className="text-xs text-amber-700">{csDialog.logoNote}</p>
              )}
              {csDialog.previews ? (
                <details open>
                  <summary className="cursor-pointer text-xs text-hgl-blue underline">
                    Preview what they&apos;ll receive ({csDialog.include ? 'with' : 'without'} the announcement)
                  </summary>
                  <iframe
                    title="CS welcome preview"
                    srcDoc={csDialog.include ? csDialog.previews.include : csDialog.previews.exclude}
                    className="w-full h-96 bg-white border border-gray-200 rounded mt-2"
                  />
                </details>
              ) : (
                <p className="text-xs text-red-600">
                  {csDialog.previewsMissingReason ??
                    "Couldn't build the preview — tell Code."}{' '}
                  Sending is blocked until the preview renders.
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  // PL-449: no blind sends — the composed preview must have
                  // rendered before the button arms (the panel contract).
                  disabled={
                    sendingCs ||
                    !csDialog.previews ||
                    (!csDialog.includeCollateral && !csDialog.confirmNoCollateral)
                  }
                  title={
                    !csDialog.previews
                      ? 'The preview must render before sending — fix what it names above'
                      : !csDialog.includeCollateral && !csDialog.confirmNoCollateral
                        ? 'Tick the confirmation above — this send has no letter or flyer'
                        : undefined
                  }
                  onClick={async () => {
                    setSendingCs(true)
                    setMessage('')
                    try {
                      const res = await fetch('/api/admin/class-confirmed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          class_id: classId,
                          include_announcement: csDialog.include,
                          include_collateral: csDialog.includeCollateral,
                        }),
                      })
                      const json = await res.json().catch(() => ({}))
                      setMessage(res.ok ? json.message : 'Error: ' + json.error)
                      if (res.ok) setCsDialog(null)
                    } catch {
                      setMessage("Error: couldn't reach the server — nothing was sent.")
                    } finally {
                      setSendingCs(false)
                    }
                  }}
                  className="text-xs font-bold bg-hgl-blue text-white rounded px-3 py-1.5 disabled:opacity-50"
                >
                  {sendingCs ? 'Sending…' : 'Send it'}
                </button>
                <button
                  type="button"
                  onClick={() => setCsDialog(null)}
                  className="text-xs text-gray-500 underline"
                >
                  cancel
                </button>
              </div>
              {/* PL-237: the collateral-only follow-up — the welcome already
                  went out without the materials; this delivers JUST the
                  letter + flyer, no class-is-ready repeat. */}
              {csDialog.ncSendOnRecord && (
                <div className="pt-2 border-t border-gray-200">
                  <p className="text-xs text-gray-600 mb-1.5">
                    This class&apos;s welcome went out <strong>without</strong> the letter and
                    flyer. When the school wants the materials, send just those — no repeat of
                    the welcome:
                  </p>
                  <button
                    type="button"
                    disabled={sendingFollowup}
                    onClick={async () => {
                      setSendingFollowup(true)
                      setMessage('')
                      try {
                        const res = await fetch('/api/admin/class-confirmed', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ class_id: classId, mode: 'collateral_followup' }),
                        })
                        const json = await res.json().catch(() => ({}))
                        setMessage(res.ok ? json.message : 'Error: ' + json.error)
                        if (res.ok) setCsDialog(null)
                      } catch {
                        setMessage("Error: couldn't reach the server — nothing was sent.")
                      } finally {
                        setSendingFollowup(false)
                      }
                    }}
                    className="text-xs font-bold bg-hgl-slate text-white rounded px-3 py-1.5 disabled:opacity-50"
                  >
                    {sendingFollowup ? 'Sending…' : 'Send the letter + flyer follow-up'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* PL-15: the urgency date on the printed pieces is deliberately the
          EARLY commit-by date, not when registration actually closes. */}
      <p className="text-xs text-gray-500 mb-3">
        The flyer prints the <strong>enrollment deadline</strong>{' '}(your commit-by date, set on the
        class), not the registration close date — registration can stay open later.
      </p>

      {showPreviews && (
        <div className="flex flex-wrap gap-3 mb-4">
          {langs.flatMap((lang) =>
            (['flyer.jpg', 'letter.jpg'] as const).map((artifact) => (
              <PreviewThumb
                key={artifact + lang}
                url={artifactUrl(artifact, lang, true)}
                label={`${artifact} ${lang} preview`}
              />
            ))
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-sm items-end">
        <div>
          <label className="block text-xs text-gray-600">
            Printed &ldquo;more info &amp; registration&rdquo; link
          </label>
          {/* PL-450 (PL-436's read-only pattern): the value composes from the
              evergreen code when it currently serves this class — edits live
              in ONE place, Classes → Short links. */}
          {pageFacts?.code && pageFacts.servesThisClass ? (
            <p className="mt-1 text-sm py-1.5">
              <span className="font-mono"><span className="text-gray-400">hgl.co/</span>{pageFacts.code}</span>{' '}
              <span className="text-xs text-gray-400">— set in Classes → Short links</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-500 py-1.5 italic">
              full registration URL (no short code serving this class)
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-600">
            Language of the generated files
          </label>
          <select
            value={form.collateral_language}
            onChange={(e) => set('collateral_language', e.target.value)}
            className="mt-1 w-full border rounded p-1.5 bg-white"
          >
            <option value="">School default ({schoolDefault})</option>
            <option value="en">English only</option>
            <option value="es">Spanish only</option>
            <option value="both">Both (separate EN + ES files)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600">
            Practice tests — the &ldquo;{form.practice_test_count || '2'} full-length tests&rdquo; bullet
          </label>
          <input
            type="number"
            min="0"
            value={form.practice_test_count}
            onChange={(e) => set('practice_test_count', e.target.value)}
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-gray-600">
            Flyer intro sentence — leave blank to use the standard one (shown grey below)
          </label>
          <textarea
            value={form.flyer_blurb}
            onChange={(e) => set('flyer_blurb', e.target.value)}
            rows={2}
            placeholder={flyerIntroDefault({
              schoolNickname: school?.nickname ?? 'School',
              classType,
              inPerson,
              sessionDates,
              lang: langs[0] === 'es' ? 'es' : 'en',
            })}
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
        {/* PL-351: the class's own hero photo on the public page (optional;
            alt text required). Ship-dark guard like selling_bullets. */}
        {'hero_image' in fields && (
          <div className="col-span-3">
            <label className="block text-xs text-gray-600 mb-1">
              Public page hero photo — shown at the top of the class page (optional)
            </label>
            <HeroImageControl classId={classId} image={fields.hero_image} onChanged={onSaved} />
          </div>
        )}
        {/* PL-348: hero bullets for the public /c/{slug} page. Ship-dark
            guard: the field only renders once the migration has landed
            (the loaded row carries the key), matching the save guard. */}
        {'selling_bullets' in fields && (
          <div className="col-span-3">
            <label className="block text-xs text-gray-600">
              Public page selling bullets (one per line) — the hero list on{' '}
              {slug ? (
                <a href={`/c/${slug}`} target="_blank" rel="noreferrer" className="text-hgl-blue underline">
                  the public class page ↗
                </a>
              ) : (
                'the public class page'
              )}
              ; price and deadline render there automatically
            </label>
            <textarea
              value={form.selling_bullets}
              onChange={(e) => set('selling_bullets', e.target.value)}
              rows={4}
              placeholder={'16 hours of instruction with an expert instructor\nSmall group size\n…'}
              className="mt-1 w-full border rounded p-1.5"
            />
          </div>
        )}
        {/* PL-355 D: the prerequisite line, editable after creation too. */}
        {'prerequisite_note' in fields && (
          <div className="col-span-3">
            <label className="block text-xs text-gray-600">
              Public page prerequisite line — renders as &ldquo;Prerequisite: …&rdquo; under the bullets
            </label>
            <input
              type="text"
              value={form.prerequisite_note}
              onChange={(e) => set('prerequisite_note', e.target.value)}
              placeholder="e.g. For students who've completed an HGL SAT Prep class"
              className="mt-1 w-full border rounded p-1.5"
            />
          </div>
        )}
        <div className={langs.includes('es') ? 'col-span-3 sm:col-span-2' : 'col-span-3'}>
          <label className="block text-xs text-gray-600">
            Extra letter paragraph{langs.includes('es') && langs.includes('en') ? ' (English letter)' : ''} —
            additive, not an override
          </label>
          <textarea
            value={form.letter_blurb}
            onChange={(e) => set('letter_blurb', e.target.value)}
            rows={2}
            placeholder={`Optional extra paragraph, inserted after the standard letter copy. Example: "We're delighted to be returning to ${school?.nickname ?? 'ASF'} for a third year…"`}
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
        {langs.includes('es') && (
          <div className="col-span-3 sm:col-span-1">
            <label className="block text-xs text-gray-600">
              Extra letter paragraph (Spanish letter) — additive, not an override
            </label>
            <textarea
              value={form.letter_blurb_es}
              onChange={(e) => set('letter_blurb_es', e.target.value)}
              rows={2}
              placeholder={`Párrafo adicional opcional, insertado después del texto estándar de la carta. Ejemplo: "¡Nos complace regresar a ${school?.nickname ?? 'ASF'} por tercer año consecutivo…"`}
              className="mt-1 w-full border rounded p-1.5"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-600">
            Promo code — must match a code created in Stripe
          </label>
          <input
            type="text"
            value={form.promo_code}
            onChange={(e) => set('promo_code', e.target.value)}
            placeholder="SAVE50ASF"
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">
            Promo savings (USD) — the &ldquo;SAVE $50&rdquo; number
          </label>
          <input
            type="number"
            min="0"
            value={form.promo_amount}
            onChange={(e) => set('promo_amount', e.target.value)}
            placeholder="50"
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">
            Promo deadline — &ldquo;sign up before&rdquo; date
          </label>
          <input
            type="date"
            value={form.promo_deadline}
            onChange={(e) => set('promo_deadline', e.target.value)}
            className="mt-1 w-full border rounded p-1.5"
          />
          <DateHint value={form.promo_deadline} />
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        The discount itself is a <strong>Stripe promotion code</strong>{' '}— create the matching code
        in the Stripe dashboard (checkout accepts codes automatically). These fields only put the
        offer on the flyer &amp; letter; all three must be set for it to appear.
        {promoPartial && (
          <span className="text-amber-700 font-semibold">
            {' '}
            Promo is incomplete — it won&rsquo;t render until code, amount, and deadline are all set.
          </span>
        )}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-hgl-slate text-white text-sm font-bold py-1.5 px-4 rounded hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save collateral fields'}
        </button>
        {message && (
          <span
            className={`text-sm font-semibold ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
