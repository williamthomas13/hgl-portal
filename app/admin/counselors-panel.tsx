'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'

// Counselor management (PHASE4_SPEC §10): add/remove per school, set the
// digest frequency. Counselors log into the portal by proving their email —
// a row here IS the account, no invite step.

type School = { id: string; name: string; nickname: string }

type Counselor = {
  id: string
  school_id: string
  first_name: string
  last_name: string
  email: string
  digest_frequency: string
  schools: { nickname: string } | null
}

const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'paused', label: 'Paused' },
]

export default function CounselorsPanel({ schools }: { schools: School[] }) {
  const [counselors, setCounselors] = useState<Counselor[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchCounselors = useCallback(async () => {
    const { data } = await supabase
      .from('school_counselors')
      .select('id, school_id, first_name, last_name, email, digest_frequency, schools ( nickname )')
      .order('email')
    if (data) setCounselors(data as unknown as Counselor[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCounselors()
  }, [fetchCounselors])

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const fd = new FormData(e.currentTarget)
    const { error } = await supabase.from('school_counselors').insert([
      {
        school_id: fd.get('school_id'),
        first_name: (fd.get('first_name') as string).trim(),
        last_name: (fd.get('last_name') as string).trim(),
        email: (fd.get('email') as string).trim().toLowerCase(),
      },
    ])
    if (error) {
      setMessage(
        'Error: ' + (error.code === '23505' ? 'that email is already a counselor.' : error.message)
      )
    } else {
      setMessage('Counselor added — they can sign in at /login with their email right away.')
      ;(e.target as HTMLFormElement).reset()
      fetchCounselors()
    }
    setLoading(false)
  }

  async function handleFrequency(id: string, frequency: string) {
    const { error } = await supabase
      .from('school_counselors')
      .update({ digest_frequency: frequency })
      .eq('id', id)
    if (error) alert('Error updating frequency: ' + error.message)
    else fetchCounselors()
  }

  async function handleRemove(c: Counselor) {
    if (!confirm(`Remove ${c.first_name} ${c.last_name} (${c.email})?\n\nThey lose portal access and stop receiving digests.`)) return
    const { error } = await supabase.from('school_counselors').delete().eq('id', c.id)
    if (error) alert('Error removing counselor: ' + error.message)
    else fetchCounselors()
  }

  return (
    <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-slate">
      <h2 className="text-2xl font-bold text-hgl-slate mb-1">School counselors</h2>
      <p className="text-sm text-gray-500 mb-6">
        A counselor row is the account — they sign in with their email, see their school&apos;s
        classes and rosters, and get the enrollment digest.
      </p>

      {counselors.length > 0 && (
        <table className="min-w-full divide-y divide-gray-200 mb-6">
          <thead className="bg-gray-100">
            <tr>
              {['School', 'Name', 'Email', 'Digest', ''].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {counselors.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 transition text-sm">
                <td className="px-4 py-2 font-semibold text-hgl-slate">{c.schools?.nickname ?? '—'}</td>
                <td className="px-4 py-2">{c.first_name} {c.last_name}</td>
                <td className="px-4 py-2 text-hgl-blue">{c.email}</td>
                <td className="px-4 py-2">
                  <select
                    value={c.digest_frequency}
                    onChange={(e) => handleFrequency(c.id, e.target.value)}
                    className="border border-gray-300 rounded p-1 text-sm bg-white"
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => handleRemove(c)} className="text-red-600 text-xs hover:underline">
                    Remove
                  </button>
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
          Add counselor
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
