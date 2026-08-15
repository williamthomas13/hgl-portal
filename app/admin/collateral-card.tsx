'use client'

import { useState } from 'react'
import { supabase } from '../utils/supabase'
import { flyerIntroDefault } from '../utils/collateral-shared'
import { DateHint } from './ui'
import type { School } from './class-wizard'

// Phase 4.5 admin Collateral card (spec §7): download buttons + preview
// thumbnails for the four generated artifacts, plus the class fields that
// drive them. Downloads always render live data, so edits here show up in
// the very next download — nothing is stored.

export type CollateralFields = {
  short_link: string | null
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
}) {
  const [form, setForm] = useState({
    short_link: fields.short_link ?? '',
    collateral_language: fields.collateral_language ?? '',
    flyer_blurb: fields.flyer_blurb ?? '',
    letter_blurb: fields.letter_blurb ?? '',
    letter_blurb_es: fields.letter_blurb_es ?? '',
    practice_test_count: String(fields.practice_test_count ?? 2),
    promo_code: fields.promo_code ?? '',
    promo_amount: fields.promo_amount != null ? String(fields.promo_amount) : '',
    promo_deadline: fields.promo_deadline ?? '',
    selling_bullets: fields.selling_bullets ?? '',
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
        short_link: form.short_link.trim() || null,
        collateral_language: form.collateral_language || null,
        flyer_blurb: form.flyer_blurb.trim() || null,
        letter_blurb: form.letter_blurb.trim() || null,
        letter_blurb_es: form.letter_blurb_es.trim() || null,
        practice_test_count: Math.max(0, parseInt(form.practice_test_count, 10) || 2),
        promo_code: form.promo_code.trim() || null,
        promo_amount: form.promo_amount.trim() ? Number(form.promo_amount) : null,
        promo_deadline: form.promo_deadline || null,
        // PL-348 ship-dark guard: only write the column once the migration
        // has landed (the loaded row carries the key) — otherwise EVERY
        // collateral save would break on the unknown column.
        ...('selling_bullets' in fields ? { selling_bullets: form.selling_bullets.trim() || null } : {}),
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

      {!form.short_link.trim() && (
        <p className="mb-3 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          Flyer will print the full registration URL — add the hgl.co link.
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
                setCsDialog((d) => (d ? { ...d, loading: false, error: json.error ?? 'Failed to load.' } : d))
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
              {csDialog.previews && (
                <details>
                  <summary className="cursor-pointer text-xs text-hgl-blue underline">
                    Preview what they&apos;ll receive ({csDialog.include ? 'with' : 'without'} the announcement)
                  </summary>
                  <iframe
                    title="CS welcome preview"
                    srcDoc={csDialog.include ? csDialog.previews.include : csDialog.previews.exclude}
                    className="w-full h-96 bg-white border border-gray-200 rounded mt-2"
                  />
                </details>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={sendingCs || (!csDialog.includeCollateral && !csDialog.confirmNoCollateral)}
                  title={
                    !csDialog.includeCollateral && !csDialog.confirmNoCollateral
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
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={artifact + lang}
                src={artifactUrl(artifact, lang, true)}
                alt={`${artifact} ${lang} preview`}
                className="w-40 border border-gray-300 rounded shadow-sm"
              />
            ))
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-sm items-end">
        <div>
          <label className="block text-xs text-gray-600">
            hgl.co short link — the &ldquo;more info &amp; registration&rdquo; destination printed
            on both pieces
          </label>
          <input
            type="text"
            value={form.short_link}
            onChange={(e) => set('short_link', e.target.value)}
            placeholder="hgl.co/asf"
            className="mt-1 w-full border rounded p-1.5"
          />
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
