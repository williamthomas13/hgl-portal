'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { formatDateAdmin, staffTimeCityLabel } from '../utils/dates'
import { SchoolCommsRow } from './school-comms'
import { escapeLike } from '../utils/like-escape'
import { EmailLink, TimezoneSelect, useDeepLinkFocus } from './ui'
import type { SchoolBranding } from './school-branding-panel'

// PL-242: "School contacts" became SCHOOLS — the school is the entity, the
// contacts are an attribute of it. Each school renders as a card: identity
// (full name, nickname, timezone) + branding (logo, accent, collateral
// language — the SAME records the wizard and the branding-defaults panel
// edit; one source of truth, several entry points) + its contacts with the
// existing affiliation machinery. This is where "ASF – ASF" gets renamed.
//
// The affiliation model is unchanged (PHASE4_SPEC §10): a CONTACT is the
// person; a SCHOOL_AFFILIATION is their tenure (null ended_at = current).
// Portal access and digests follow ACTIVE affiliations; turnover is "end
// the affiliation" — the person and their history stay.

export type Affiliation = {
  id: string
  contact_id: string
  school_id: string
  role: string
  started_at: string
  ended_at: string | null
  digest_frequency: string
  contacts: {
    first_name: string
    last_name: string
    email: string
    phone: string | null
    notes: string | null
  } | null
  schools: { nickname: string } | null
}

const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'paused', label: 'Paused' },
]

const HGL_BLUE = '#00AEEE'

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/** Inline school identity + branding editor — the editable home schools
 *  never had outside the wizard. */
function SchoolEditor({
  school,
  onClose,
}: {
  school: SchoolBranding
  onClose: (changed: boolean) => void
}) {
  const [name, setName] = useState(school.name ?? '')
  const [nickname, setNickname] = useState(school.nickname ?? '')
  const [timezone, setTimezone] = useState(school.timezone ?? '')
  // PL-353: the city families see on public time labels ("Düsseldorf time").
  const [city, setCity] = useState(school.city ?? '')
  // PL-406: the maps-link target for this school's in-person classes.
  const [address, setAddress] = useState(school.address ?? '')
  const [accent, setAccent] = useState(school.accent_color ?? '')
  const [language, setLanguage] = useState(school.collateral_language ?? 'en')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const nicknameChanged = nickname.trim() !== (school.nickname ?? '')

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    const body = new FormData()
    body.set('schoolId', school.id)
    body.set('file', file)
    const res = await fetch('/api/admin/school-logo', { method: 'POST', body })
    setBusy(false)
    if (!res.ok) setError('Error uploading the logo: ' + (await res.text()))
    else onClose(true)
  }

  async function save() {
    if (!name.trim() || !nickname.trim()) {
      setError('The full name and nickname are both required — the nickname alone is ambiguous internally.')
      return
    }
    if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
      setError('Accent must be a hex color like #7a1f3d (or blank for HGL blue).')
      return
    }
    setBusy(true)
    setError('')
    const { error: e1 } = await supabase
      .from('schools')
      .update({
        name: name.trim(),
        nickname: nickname.trim(),
        timezone: timezone || null,
        city: city.trim() || null,
        address: address.trim() || null,
        accent_color: accent || null,
        collateral_language: language,
      })
      .eq('id', school.id)
    setBusy(false)
    if (e1) {
      setError('Error: ' + e1.message)
      return
    }
    onClose(true)
  }

  return (
    <div className="border border-gray-300 rounded-md p-3 bg-gray-50 space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded p-2" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Nickname</label>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full border rounded p-2" />
          {nicknameChanged && (
            <p className="text-xs text-amber-700 mt-1">
              The nickname feeds NEW classes&apos; registration links and the collateral text.
              Existing classes keep their links exactly as they are (their slugs were minted at
              creation and never change), and hgl.co short links are set per class — untouched.
              Display name changes are always safe.
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Timezone</label>
          <TimezoneSelect value={timezone} onChange={setTimezone} />
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">City</label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Düsseldorf"
            className="w-full border rounded p-2"
          />
          {/* PL-353: public pages label times with THIS, never the zone id's
              city — blank falls back to the zone city (Europe/Berlin would
              read "Berlin"). */}
          <p className="text-xs text-gray-500 mt-1">
            Public pages say &ldquo;times shown in {city.trim() || '…'} time&rdquo; — the city
            families know, not the timezone&apos;s.
          </p>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">
          Street address — used for the map link
        </label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. Niederrheinstraße 336, 40489 Düsseldorf"
          className="w-full border rounded p-2"
        />
        {/* PL-406: room-only class locations ("Room 204") get a useful pin —
            the class page's maps link searches THIS. Blank = no maps link
            (honest absence), exactly as before. */}
        <p className="text-xs text-gray-500 mt-1">
          In-person classes at this school link &ldquo;Open in Google Maps&rdquo; here; leave blank
          and the map link simply doesn&apos;t appear.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
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
            {school.logo_url ? 'replace logo' : 'upload logo'}
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
          <label className="text-xs text-gray-600">Collateral language</label>
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
      </div>
      {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="bg-hgl-slate text-white text-xs font-bold px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
        >
          Save school
        </button>
        <button type="button" onClick={() => onClose(false)} className="text-xs text-gray-500 underline">
          cancel
        </button>
      </div>
    </div>
  )
}

export default function CounselorsPanel({
  schools,
  onChange,
}: {
  schools: SchoolBranding[]
  onChange?: () => void
}) {
  const [affiliations, setAffiliations] = useState<Affiliation[]>([])
  const [showEnded, setShowEnded] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingSchool, setEditingSchool] = useState<string | null>(null)
  const [addingAt, setAddingAt] = useState<string | null>(null)
  // PL-242: names are doors — ?school={id} lands with the card in view.
  const [focusSchool, setFocusSchool] = useState<string | null>(null)
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('school')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s) setFocusSchool(`school-${s}`)
  }, [])
  useDeepLinkFocus(focusSchool)

  const fetchAffiliations = useCallback(async () => {
    const { data } = await supabase
      .from('school_affiliations')
      .select(
        'id, contact_id, school_id, role, started_at, ended_at, digest_frequency, contacts ( first_name, last_name, email, phone, notes ), schools ( nickname )'
      )
      .order('started_at', { ascending: false })
    if (data) {
      setAffiliations(
        (data as unknown as Affiliation[]).map((a) => ({
          ...a,
          contacts: one(a.contacts),
          schools: one(a.schools),
        }))
      )
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAffiliations()
  }, [fetchAffiliations])

  async function handleAdd(e: React.FormEvent<HTMLFormElement>, schoolId: string) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const fd = new FormData(e.currentTarget)
    const email = (fd.get('email') as string).trim().toLowerCase()

    // Find-or-create the contact by email — the person may already exist
    // from another school (that's the point of splitting the tables).
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .ilike('email', escapeLike(email))
      .maybeSingle()
    let contactId = existing?.id as string | undefined
    if (!contactId) {
      const { data: created, error } = await supabase
        .from('contacts')
        .insert([
          {
            first_name: (fd.get('first_name') as string).trim(),
            last_name: (fd.get('last_name') as string).trim(),
            email,
          },
        ])
        .select('id')
        .single()
      if (error || !created) {
        setMessage('Error adding contact: ' + (error?.message ?? 'unknown'))
        setLoading(false)
        return
      }
      contactId = created.id
    }

    const dup = affiliations.find(
      (a) => a.contact_id === contactId && a.school_id === schoolId && !a.ended_at
    )
    if (dup) {
      setMessage('Error: that contact is already active at that school.')
      setLoading(false)
      return
    }

    const { error: affErr } = await supabase
      .from('school_affiliations')
      .insert([{ contact_id: contactId, school_id: schoolId, role: 'counselor' }])
    if (affErr) {
      setMessage('Error adding affiliation: ' + affErr.message)
    } else {
      setMessage('Contact added — they can sign in at /login with their email right away.')
      ;(e.target as HTMLFormElement).reset()
      setAddingAt(null)
      fetchAffiliations()
      onChange?.()
    }
    setLoading(false)
  }

  async function handleFrequency(id: string, frequency: string) {
    const { error } = await supabase
      .from('school_affiliations')
      .update({ digest_frequency: frequency })
      .eq('id', id)
    if (error) alert('Error updating frequency: ' + error.message)
    else fetchAffiliations()
  }

  // Edit the PERSON (name/email/phone/notes) — school-independent, so the
  // change shows up on every affiliation. Sequential prompts, matching the
  // slug/close-date edit pattern; cancel at any step keeps the current value.
  async function handleEditContact(a: Affiliation) {
    const ct = a.contacts
    if (!ct) return
    const first = prompt('First name:', ct.first_name) ?? ct.first_name
    const last = prompt('Last name:', ct.last_name) ?? ct.last_name
    const email = prompt('Email (their portal login):', ct.email) ?? ct.email
    const phone = prompt('Phone (blank = none):', ct.phone ?? '') ?? (ct.phone ?? '')
    const notes = prompt('Notes (blank = none):', ct.notes ?? '') ?? (ct.notes ?? '')
    const { error } = await supabase
      .from('contacts')
      .update({
        first_name: first.trim() || ct.first_name,
        last_name: last.trim() || ct.last_name,
        email: email.trim().toLowerCase() || ct.email,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
      })
      .eq('id', a.contact_id)
    if (error) {
      alert(
        'Error updating contact: ' +
          (error.code === '23505' ? 'that email belongs to another contact.' : error.message)
      )
      return
    }
    fetchAffiliations()
    onChange?.()
  }

  // "Move to another school" = end + create in one action (addendum §6).
  // The new affiliation keeps the digest frequency; history stays anchored
  // to the old school through the ended row.
  async function handleMove(a: Affiliation) {
    const name = `${a.contacts?.first_name ?? ''} ${a.contacts?.last_name ?? ''}`.trim()
    const options = schools.filter((s) => s.id !== a.school_id)
    if (options.length === 0) {
      alert('No other school to move to — add the school first.')
      return
    }
    const nickname = prompt(
      `Move ${name} from ${a.schools?.nickname ?? 'this school'} to which school?\n\n` +
        `Options: ${options.map((s) => s.nickname).join(' · ')}`
    )
    if (nickname == null) return
    const target = options.find((s) => s.nickname.toLowerCase() === nickname.trim().toLowerCase())
    if (!target) {
      alert(`No school named "${nickname.trim()}" — copy one of the options exactly.`)
      return
    }
    const { error: newErr } = await supabase.from('school_affiliations').insert([
      {
        contact_id: a.contact_id,
        school_id: target.id,
        role: a.role,
        digest_frequency: a.digest_frequency,
      },
    ])
    if (newErr) {
      alert('Error opening the new affiliation (nothing was ended): ' + newErr.message)
      return
    }
    const { error: endErr } = await supabase
      .from('school_affiliations')
      .update({ ended_at: new Date().toLocaleDateString('en-CA') })
      .eq('id', a.id)
    if (endErr) {
      alert(
        'New affiliation created, but ending the old one failed — end it manually: ' +
          endErr.message
      )
    }
    fetchAffiliations()
    onChange?.()
  }

  async function handleEnd(a: Affiliation) {
    const name = `${a.contacts?.first_name ?? ''} ${a.contacts?.last_name ?? ''}`.trim()
    if (
      !confirm(
        `End ${name}'s affiliation with ${a.schools?.nickname ?? 'this school'}?\n\n` +
          'They lose portal access to this school and stop receiving its digests. ' +
          'The contact and their history are kept — you can re-add them later.'
      )
    )
      return
    const { error } = await supabase
      .from('school_affiliations')
      .update({ ended_at: new Date().toLocaleDateString('en-CA') })
      .eq('id', a.id)
    if (error) alert('Error ending affiliation: ' + error.message)
    else {
      fetchAffiliations()
      onChange?.()
    }
  }

  const ended = affiliations.filter((a) => a.ended_at)

  return (
    <div>
      <p className="text-sm text-gray-500 mb-6">
        Each school is a record you can edit here — identity, timezone, and the branding the
        flyers and letters use. Its contacts live on the card: a contact with an active
        affiliation is the account — they sign in with their email, see that school&apos;s
        classes and rosters, and get its enrollment digest. Turnover = end the affiliation; the
        person and their history stay.
      </p>

      <div className="space-y-4 mb-6">
        {schools.map((school) => {
          const rows = affiliations.filter((a) => a.school_id === school.id && !a.ended_at)
          return (
            <div key={school.id} id={`school-${school.id}`} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  {school.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={school.logo_url}
                      alt=""
                      className="h-8 max-w-20 object-contain"
                    />
                  )}
                  <div>
                    <span className="font-bold text-hgl-slate">{school.nickname}</span>
                    <span className="block text-xs text-gray-500">
                      {school.name}
                      {/* PL-398 sweep leftover (caught in batch 42): the
                          card subtitle is a DISPLAY — city time, id hoverable. */}
                      {school.timezone ? (
                        <span title={school.timezone}> · {staffTimeCityLabel(school.timezone)} time</span>
                      ) : (
                        ''
                      )}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setEditingSchool(editingSchool === school.id ? null : school.id)}
                  className="text-xs text-hgl-blue underline"
                >
                  {editingSchool === school.id ? 'close' : 'edit school'}
                </button>
              </div>

              {editingSchool === school.id && (
                <div className="mt-3">
                  <SchoolEditor
                    school={school}
                    onClose={(changed) => {
                      setEditingSchool(null)
                      if (changed) onChange?.()
                    }}
                  />
                </div>
              )}

              {rows.length > 0 ? (
                <div className="overflow-x-auto mt-3">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-100">
                      <tr>
                        {['Name', 'Email', 'Since', 'Digest', ''].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {rows.map((a) => (
                        <SchoolContactRows
                          key={a.id}
                          a={a}
                          onFrequency={handleFrequency}
                          onEdit={handleEditContact}
                          onMove={handleMove}
                          onEnd={handleEnd}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-gray-500 italic mt-3">
                  No active contact — the school gets no digests and nobody can open its portal.
                </p>
              )}

              {addingAt === school.id ? (
                <form
                  onSubmit={(e) => handleAdd(e, school.id)}
                  className="grid grid-cols-4 gap-2 items-end text-sm mt-3"
                >
                  <div>
                    <label className="block text-xs text-gray-600">First name</label>
                    <input type="text" name="first_name" required className="mt-1 w-full border rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600">Last name</label>
                    <input type="text" name="last_name" required className="mt-1 w-full border rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600">Email</label>
                    <input type="email" name="email" required className="mt-1 w-full border rounded p-2" />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-hgl-slate text-white py-2 px-3 rounded hover:opacity-90 disabled:opacity-60"
                    >
                      Add contact
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingAt(null)}
                      className="text-xs text-gray-500 underline"
                    >
                      cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setAddingAt(school.id)}
                  className="text-xs text-hgl-blue underline mt-3"
                >
                  + add a contact at {school.nickname}
                </button>
              )}
            </div>
          )
        })}
        {schools.length === 0 && (
          <p className="text-sm text-gray-500 italic">No schools yet — add one via the class wizard.</p>
        )}
      </div>

      {ended.length > 0 && (
        <p className="text-xs text-gray-500 mb-6">
          <button onClick={() => setShowEnded((v) => !v)} className="underline hover:text-hgl-blue">
            {showEnded ? 'Hide' : 'Show'} past affiliations ({ended.length})
          </button>
        </p>
      )}
      {showEnded && ended.length > 0 && (
        <div className="overflow-x-auto mb-6">
        <table className="min-w-full divide-y divide-gray-200 opacity-60">
          <tbody className="divide-y divide-gray-200">
            {ended.map((a) => (
              <tr key={a.id} className="text-sm">
                <td className="px-4 py-2 font-semibold text-hgl-slate">{a.schools?.nickname ?? '—'}</td>
                <td className="px-4 py-2">
                  {a.contacts?.first_name} {a.contacts?.last_name}
                </td>
                <td className="px-4 py-2">
                  {a.contacts?.email && <EmailLink email={a.contacts.email} />}
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {formatDateAdmin(a.started_at)} – {a.ended_at ? formatDateAdmin(a.ended_at) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {message && (
        <div
          className={`mt-4 p-3 rounded text-center text-sm font-semibold ${
            message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}

/** One active contact: the main row + the expandable emails row underneath
 *  (the PL-137 comms timeline machinery, unchanged). */
function SchoolContactRows({
  a,
  onFrequency,
  onEdit,
  onMove,
  onEnd,
}: {
  a: Affiliation
  onFrequency: (id: string, f: string) => void
  onEdit: (a: Affiliation) => void
  onMove: (a: Affiliation) => void
  onEnd: (a: Affiliation) => void
}) {
  return (
    <>
      <tr className="hover:bg-gray-50 transition text-sm">
        <td className="px-4 py-2 font-semibold text-hgl-slate">
          {a.contacts?.first_name} {a.contacts?.last_name}
        </td>
        <td className="px-4 py-2">
          {a.contacts?.email && <EmailLink email={a.contacts.email} />}
        </td>
        <td className="px-4 py-2 text-gray-500">{formatDateAdmin(a.started_at)}</td>
        <td className="px-4 py-2">
          <select
            value={a.digest_frequency}
            onChange={(e) => onFrequency(a.id, e.target.value)}
            className="border border-gray-300 rounded p-1 text-sm bg-white"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </td>
        {/* PL-240 (PL-228 defect class): no nowrap — actions wrap in place. */}
        <td className="px-4 py-2 text-right">
          <button onClick={() => onEdit(a)} className="text-gray-500 text-xs hover:underline mr-3">
            Edit
          </button>
          <button onClick={() => onMove(a)} className="text-gray-500 text-xs hover:underline mr-3">
            Move school
          </button>
          <button onClick={() => onEnd(a)} className="text-red-600 text-xs hover:underline">
            End affiliation
          </button>
        </td>
      </tr>
      {a.contacts?.email && (
        <SchoolCommsRow schoolId={a.school_id} email={a.contacts.email} colSpan={5} />
      )}
    </>
  )
}
