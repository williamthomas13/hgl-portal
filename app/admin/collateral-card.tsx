'use client'

import { useState } from 'react'
import { supabase } from '../utils/supabase'
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
}

export default function CollateralCard({
  classId,
  fields,
  school,
  onSaved,
}: {
  classId: string
  fields: CollateralFields
  school: (School & { collateral_language?: string | null }) | null
  onSaved: () => void
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
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showPreviews, setShowPreviews] = useState(false)
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
            Short link (printed on flyer &amp; letter)
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
          <label className="block text-xs text-gray-600">Language</label>
          <select
            value={form.collateral_language}
            onChange={(e) => set('collateral_language', e.target.value)}
            className="mt-1 w-full border rounded p-1.5 bg-white"
          >
            <option value="">School default ({schoolDefault})</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="both">Both (EN + ES)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600">Practice tests</label>
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
            Flyer intro override (blank = standard &ldquo;{'{school}'} has partnered…&rdquo; sentence)
          </label>
          <textarea
            value={form.flyer_blurb}
            onChange={(e) => set('flyer_blurb', e.target.value)}
            rows={2}
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
        <div className={langs.includes('es') ? 'col-span-3 sm:col-span-2' : 'col-span-3'}>
          <label className="block text-xs text-gray-600">
            Letter paragraph {langs.includes('es') && langs.includes('en') ? '(EN) ' : ''}— optional,
            inserted after the standard copy (returning-school framing, special notes)
          </label>
          <textarea
            value={form.letter_blurb}
            onChange={(e) => set('letter_blurb', e.target.value)}
            rows={2}
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
        {langs.includes('es') && (
          <div className="col-span-3 sm:col-span-1">
            <label className="block text-xs text-gray-600">Letter paragraph (ES)</label>
            <textarea
              value={form.letter_blurb_es}
              onChange={(e) => set('letter_blurb_es', e.target.value)}
              rows={2}
              className="mt-1 w-full border rounded p-1.5"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-600">Promo code (display only)</label>
          <input
            type="text"
            value={form.promo_code}
            onChange={(e) => set('promo_code', e.target.value)}
            placeholder="SAVE50ASF"
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Promo amount (USD)</label>
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
          <label className="block text-xs text-gray-600">Promo deadline</label>
          <input
            type="date"
            value={form.promo_deadline}
            onChange={(e) => set('promo_deadline', e.target.value)}
            className="mt-1 w-full border rounded p-1.5"
          />
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        The discount itself is a <strong>Stripe promotion code</strong> — create the matching code
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
