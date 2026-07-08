'use client'

import { useState } from 'react'
import { supabase } from '../utils/supabase'
import type { School } from './class-wizard'

// Phase 4.5 school collateral branding (spec §7): crest/logo upload (renders
// top-right on the flyer), accent color (flyer burst + CTA circles), and the
// school's default collateral language. Logos live in the public
// school-assets bucket; staff-only writes are enforced by storage RLS.

export type SchoolBranding = School & {
  logo_url?: string | null
  accent_color?: string | null
  collateral_language?: string | null
}

const HGL_BLUE = '#00AEEE'

function SchoolRow({ school, onChange }: { school: SchoolBranding; onChange: () => void }) {
  const [accent, setAccent] = useState(school.accent_color ?? '')
  const [language, setLanguage] = useState(school.collateral_language ?? 'en')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save(fields: Partial<Pick<SchoolBranding, 'logo_url' | 'accent_color' | 'collateral_language'>>) {
    setBusy(true)
    setMessage('')
    const { error } = await supabase.from('schools').update(fields).eq('id', school.id)
    setBusy(false)
    if (error) {
      setMessage('Error: ' + error.message)
      return false
    }
    onChange()
    return true
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setMessage('')
    // Server-side route: flood-fills the white background to transparency and
    // trims before storing, so crests never render as a box on the flyer.
    const body = new FormData()
    body.set('schoolId', school.id)
    body.set('file', file)
    const res = await fetch('/api/admin/school-logo', { method: 'POST', body })
    setBusy(false)
    if (!res.ok) {
      setMessage('Error uploading: ' + (await res.text()))
      return
    }
    setMessage('Logo updated (background removed automatically).')
    onChange()
  }

  async function handleSave() {
    if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
      setMessage('Error: accent must be a hex color like #7a1f3d (or blank for HGL blue).')
      return
    }
    if (
      await save({
        accent_color: accent || null,
        collateral_language: language,
      })
    ) {
      setMessage('Saved.')
    }
  }

  return (
    <li className="flex items-center gap-4 px-4 py-3 text-sm flex-wrap">
      <div className="w-56">
        <span className="font-semibold text-hgl-slate">{school.nickname}</span>
        <span className="block text-xs text-gray-500 truncate" title={school.name}>
          {school.name}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {school.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={school.logo_url}
            alt={`${school.nickname} logo`}
            className="h-9 max-w-24 object-contain border border-gray-200 rounded bg-white"
          />
        ) : (
          <span className="text-xs text-gray-400 italic">no logo — flyer omits it</span>
        )}
        <label className="text-xs text-hgl-blue underline cursor-pointer">
          {school.logo_url ? 'replace' : 'upload'}
          <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-600">Accent</label>
        <input
          type="color"
          value={accent || HGL_BLUE}
          onChange={(e) => setAccent(e.target.value)}
          className="h-7 w-9 border border-gray-300 rounded cursor-pointer"
        />
        <input
          type="text"
          value={accent}
          onChange={(e) => setAccent(e.target.value)}
          placeholder="HGL blue"
          className="w-24 border rounded p-1 text-xs"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-600">Language</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="border rounded p-1 text-xs bg-white"
        >
          <option value="en">English</option>
          <option value="es">Spanish</option>
          <option value="both">Both</option>
        </select>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="bg-hgl-slate text-white text-xs font-bold px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
      >
        Save
      </button>
      {message && (
        <span
          className={`text-xs font-semibold ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}
        >
          {message}
        </span>
      )}
    </li>
  )
}

export default function SchoolBrandingPanel({
  schools,
  onChange,
}: {
  schools: SchoolBranding[]
  onChange: () => void
}) {
  if (schools.length === 0) {
    return <p className="text-sm text-gray-500">No schools yet — add one via the class wizard.</p>
  }
  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">
        Logo renders top-right on the flyer (omitted if blank). Accent colors the flyer&rsquo;s
        promo burst and CTA circle — blank uses HGL blue. Language is the school&rsquo;s default;
        each class can override it on its Collateral card.
      </p>
      <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
        {schools.map((s) => (
          <SchoolRow key={s.id} school={s} onChange={onChange} />
        ))}
      </ul>
    </div>
  )
}
