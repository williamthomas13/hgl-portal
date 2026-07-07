'use client'

import { useState } from 'react'
import { supabase } from '../utils/supabase'

// Instructor management (PHASE4_SPEC §5/§10). The key field is
// default_meeting_link: creating an ONLINE class with a blank location
// auto-fills it from the instructor's default, and the instructor portal
// shows it as the effective location. Admin can still override per class.

export type Instructor = {
  id: string
  email: string
  name: string | null
  default_meeting_link: string | null
}

export default function InstructorsPanel({
  instructors,
  onChange,
}: {
  instructors: Instructor[]
  onChange: () => void
}) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const fd = new FormData(e.currentTarget)
    const { error } = await supabase.from('instructors').insert([
      {
        email: (fd.get('email') as string).trim().toLowerCase(),
        name: (fd.get('name') as string).trim() || null,
        default_meeting_link: (fd.get('default_meeting_link') as string).trim() || null,
      },
    ])
    if (error) {
      setMessage(
        'Error: ' + (error.code === '23505' ? 'that email is already an instructor.' : error.message)
      )
    } else {
      setMessage('Instructor added.')
      ;(e.target as HTMLFormElement).reset()
      onChange()
    }
    setLoading(false)
  }

  async function handleEditLink(i: Instructor) {
    const next = prompt(
      `Default meeting link for ${i.name ?? i.email} (used for online classes with no per-class location):`,
      i.default_meeting_link ?? ''
    )
    if (next == null) return
    const { error } = await supabase
      .from('instructors')
      .update({ default_meeting_link: next.trim() || null })
      .eq('id', i.id)
    if (error) alert('Error updating link: ' + error.message)
    else onChange()
  }

  async function handleRemove(i: Instructor) {
    if (!confirm(`Remove instructor ${i.name ?? i.email}?\n\nExisting classes keep their own locations; only the stored default link goes away.`)) return
    const { error } = await supabase.from('instructors').delete().eq('id', i.id)
    if (error) alert('Error removing instructor: ' + error.message)
    else onChange()
  }

  return (
    <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-slate">
      <h2 className="text-2xl font-bold text-hgl-slate mb-1">Instructors</h2>
      <p className="text-sm text-gray-500 mb-6">
        Online classes created with a blank location auto-fill the instructor&apos;s default
        meeting link. Instructors sign in at /login with their email to see their classes and
        rosters.
      </p>

      {instructors.length > 0 && (
        <table className="min-w-full divide-y divide-gray-200 mb-6">
          <thead className="bg-gray-100">
            <tr>
              {['Name', 'Email', 'Default meeting link', ''].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {instructors.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50 transition text-sm">
                <td className="px-4 py-2 font-semibold text-hgl-slate">{i.name ?? '—'}</td>
                <td className="px-4 py-2 text-hgl-blue">{i.email}</td>
                <td className="px-4 py-2 text-gray-600">
                  <span className="truncate inline-block max-w-72 align-bottom">
                    {i.default_meeting_link ?? <span className="italic text-gray-400">none</span>}
                  </span>
                  <button
                    onClick={() => handleEditLink(i)}
                    className="ml-2 text-xs text-gray-500 underline hover:text-hgl-blue"
                  >
                    edit
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => handleRemove(i)} className="text-red-600 text-xs hover:underline">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={handleAdd} className="grid grid-cols-4 gap-2 items-end text-sm">
        <div>
          <label className="block text-xs text-gray-600">Name</label>
          <input type="text" name="name" placeholder="e.g. Sarah" className="mt-1 w-full border rounded p-2" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Email</label>
          <input type="email" name="email" required className="mt-1 w-full border rounded p-2" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Default meeting link</label>
          <input type="url" name="default_meeting_link" placeholder="https://zoom.us/j/…" className="mt-1 w-full border rounded p-2" />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-hgl-slate text-white py-2 px-3 rounded hover:opacity-90 disabled:opacity-60"
        >
          Add instructor
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
