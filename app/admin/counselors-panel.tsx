'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { formatDateAdmin } from '../utils/dates'

// School contact management (PHASE4_SPEC §10 + admin UX addendum): a CONTACT
// is the person; a SCHOOL_AFFILIATION is their tenure at a school (null
// ended_at = current). Portal access and digests follow ACTIVE affiliations,
// so turnover is "end the affiliation" — the person and their history stay.
// Digest frequency lives on the affiliation, not the contact.

type School = { id: string; name: string; nickname: string }

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

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default function CounselorsPanel({
  schools,
  onChange,
}: {
  schools: School[]
  onChange?: () => void
}) {
  const [affiliations, setAffiliations] = useState<Affiliation[]>([])
  const [showEnded, setShowEnded] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

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

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const fd = new FormData(e.currentTarget)
    const email = (fd.get('email') as string).trim().toLowerCase()
    const schoolId = fd.get('school_id') as string

    // Find-or-create the contact by email — the person may already exist
    // from another school (that's the point of splitting the tables).
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .ilike('email', email)
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

  const active = affiliations.filter((a) => !a.ended_at)
  const ended = affiliations.filter((a) => a.ended_at)

  return (
    <div>
      <p className="text-sm text-gray-500 mb-6">
        A contact with an active school affiliation is the account — they sign in with their
        email, see that school&apos;s classes and rosters, and get its enrollment digest.
        Turnover = end the affiliation; the person and their history stay.
      </p>

      {active.length > 0 && (
        <table className="min-w-full divide-y divide-gray-200 mb-6">
          <thead className="bg-gray-100">
            <tr>
              {['School', 'Name', 'Email', 'Since', 'Digest', ''].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {active.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50 transition text-sm">
                <td className="px-4 py-2 font-semibold text-hgl-slate">{a.schools?.nickname ?? '—'}</td>
                <td className="px-4 py-2">
                  {a.contacts?.first_name} {a.contacts?.last_name}
                  {a.contacts?.notes && (
                    <span className="block text-xs text-gray-400 max-w-56 truncate" title={a.contacts.notes}>
                      {a.contacts.notes}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-hgl-blue">{a.contacts?.email}</td>
                <td className="px-4 py-2 text-gray-500">{formatDateAdmin(a.started_at)}</td>
                <td className="px-4 py-2">
                  <select
                    value={a.digest_frequency}
                    onChange={(e) => handleFrequency(a.id, e.target.value)}
                    className="border border-gray-300 rounded p-1 text-sm bg-white"
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={() => handleEditContact(a)} className="text-gray-500 text-xs hover:underline mr-3">
                    Edit
                  </button>
                  <button onClick={() => handleMove(a)} className="text-gray-500 text-xs hover:underline mr-3">
                    Move school
                  </button>
                  <button onClick={() => handleEnd(a)} className="text-red-600 text-xs hover:underline">
                    End affiliation
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {ended.length > 0 && (
        <p className="text-xs text-gray-500 mb-6">
          <button onClick={() => setShowEnded((v) => !v)} className="underline hover:text-hgl-blue">
            {showEnded ? 'Hide' : 'Show'} past affiliations ({ended.length})
          </button>
        </p>
      )}
      {showEnded && ended.length > 0 && (
        <table className="min-w-full divide-y divide-gray-200 mb-6 opacity-60">
          <tbody className="divide-y divide-gray-200">
            {ended.map((a) => (
              <tr key={a.id} className="text-sm">
                <td className="px-4 py-2 font-semibold text-hgl-slate">{a.schools?.nickname ?? '—'}</td>
                <td className="px-4 py-2">
                  {a.contacts?.first_name} {a.contacts?.last_name}
                </td>
                <td className="px-4 py-2">{a.contacts?.email}</td>
                <td className="px-4 py-2 text-gray-500">
                  {formatDateAdmin(a.started_at)} – {a.ended_at ? formatDateAdmin(a.ended_at) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={handleAdd} className="grid grid-cols-5 gap-2 items-end text-sm">
        <div>
          <label className="block text-xs text-gray-600">School</label>
          <select name="school_id" required className="mt-1 w-full border rounded p-2 bg-white">
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.nickname}</option>
            ))}
          </select>
        </div>
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
        <button
          type="submit"
          disabled={loading || schools.length === 0}
          className="bg-hgl-slate text-white py-2 px-3 rounded hover:opacity-90 disabled:opacity-60"
        >
          Add contact
        </button>
      </form>

      {message && (
        <div className={`mt-4 p-3 rounded text-center text-sm font-semibold ${
          message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}>
          {message}
        </div>
      )}
    </div>
  )
}
