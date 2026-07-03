'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'

type School = {
  id: string
  name: string
  nickname: string
}

type Session = {
  id: string
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

type Enrollment = {
  id: string
  enrolled_at: string
  payment_status: string
  students: {
    first_name: string
    last_name: string
    student_email: string | null
    families: {
      parent_email: string
      parent_first_name: string
      parent_last_name: string
    } | null
  } | null
}

type ClassRow = {
  id: string
  school_nickname: string | null
  class_type: string
  instructor_name: string
  instructor_email: string | null
  price: number
  capacity: number
  start_date: string
  default_location: string | null
  synap_group: string | null
  school_id: string | null
  schools: { name: string; nickname: string } | null
  enrollments: Enrollment[] | null
  sessions: Session[] | null
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const [schools, setSchools] = useState<School[]>([])
  const [rosters, setRosters] = useState<ClassRow[]>([])
  const [fetchingRosters, setFetchingRosters] = useState(true)

  const fetchSchools = useCallback(async () => {
    const { data } = await supabase.from('schools').select('*').order('nickname')
    if (data) setSchools(data)
  }, [])

  const fetchRosters = useCallback(async () => {
    setFetchingRosters(true)
    const { data } = await supabase
      .from('classes')
      .select(
        `
        *,
        schools ( name, nickname ),
        sessions ( id, session_date, start_time, end_time, location ),
        enrollments (
          id,
          enrolled_at,
          payment_status,
          students (
            first_name,
            last_name,
            student_email,
            families ( parent_email, parent_first_name, parent_last_name )
          )
        )
      `
      )
      .order('created_at', { ascending: false })

    if (data) setRosters(data as unknown as ClassRow[])
    setFetchingRosters(false)
  }, [])

  useEffect(() => {
    // Initial load — the awaited calls inside these helpers update state
    // on the next tick, not synchronously within this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSchools()
    fetchRosters()
  }, [fetchSchools, fetchRosters])

  // ---------------------------------------------------------------------------
  // Create class
  // ---------------------------------------------------------------------------
  async function handleCreateClass(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const formData = new FormData(e.currentTarget)
    const schoolNickname = (formData.get('school_nickname') as string).trim()

    // Find-or-create the school by nickname so new schools auto-register
    let schoolId: string | null = null
    if (schoolNickname) {
      const existing = schools.find(
        (s) => s.nickname.toLowerCase() === schoolNickname.toLowerCase()
      )
      if (existing) {
        schoolId = existing.id
      } else {
        const { data: newSchool, error: schoolErr } = await supabase
          .from('schools')
          .insert([{ name: schoolNickname, nickname: schoolNickname }])
          .select()
          .single()
        if (schoolErr) {
          setMessage('Error creating school: ' + schoolErr.message)
          setLoading(false)
          return
        }
        schoolId = newSchool.id
        setSchools((prev) => [...prev, newSchool as School])
      }
    }

    const newClass = {
      school_nickname: schoolNickname, // keep for backward compat; to be dropped later
      school_id: schoolId,
      class_type: formData.get('class_type'),
      instructor_name: formData.get('instructor_name'),
      instructor_email: formData.get('instructor_email') || null,
      price: formData.get('price'),
      capacity: formData.get('capacity'),
      start_date: formData.get('start_date'),
      default_location: formData.get('default_location') || null,
      synap_group: formData.get('synap_group') || null,
    }

    const { error } = await supabase.from('classes').insert([newClass])

    if (error) {
      setMessage('Error: ' + error.message)
    } else {
      setMessage('Success — class added. Scroll down to add session dates.')
      ;(e.target as HTMLFormElement).reset()
      fetchRosters()
    }
    setLoading(false)
  }

  // ---------------------------------------------------------------------------
  // Add session to a class
  // ---------------------------------------------------------------------------
  async function handleAddSession(
    classId: string,
    form: HTMLFormElement,
    defaultLocation: string | null
  ) {
    const fd = new FormData(form)
    const payload = {
      class_id: classId,
      session_date: fd.get('session_date'),
      start_time: fd.get('start_time') || null,
      end_time: fd.get('end_time') || null,
      location: (fd.get('location') as string) || defaultLocation || null,
    }
    const { error } = await supabase.from('sessions').insert([payload])
    if (error) {
      alert('Error adding session: ' + error.message)
      return
    }
    form.reset()
    fetchRosters()
  }

  async function handleDeleteSession(sessionId: string) {
    if (!confirm('Remove this session?')) return
    const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
    if (error) {
      alert('Error removing session: ' + error.message)
      return
    }
    fetchRosters()
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-6xl mx-auto space-y-10">

        {/* CREATE CLASS */}
        <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-slate">
          <h1 className="text-2xl font-bold text-hgl-slate mb-6">Admin Command Center</h1>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Create a new group class</h2>

          <form onSubmit={handleCreateClass} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">School</label>
                <input
                  type="text"
                  name="school_nickname"
                  required
                  list="schools-list"
                  placeholder="e.g. Nido"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
                <datalist id="schools-list">
                  {schools.map((s) => (
                    <option key={s.id} value={s.nickname}>
                      {s.name}
                    </option>
                  ))}
                </datalist>
                <p className="text-xs text-gray-500 mt-1">Pick from existing or type a new one.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Class Type</label>
                <input
                  type="text"
                  name="class_type"
                  required
                  placeholder="e.g. SAT Prep"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Instructor Name</label>
                <input
                  type="text"
                  name="instructor_name"
                  required
                  placeholder="e.g. Sarah"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Instructor Email</label>
                <input
                  type="email"
                  name="instructor_email"
                  placeholder="sarah@highergroundlearning.com"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  type="date"
                  name="start_date"
                  required
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Default Location</label>
                <input
                  type="text"
                  name="default_location"
                  placeholder="Library Room B / Zoom"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Price (USD)</label>
                <input
                  type="number"
                  name="price"
                  required
                  placeholder="750"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Student Capacity</label>
                <input
                  type="number"
                  name="capacity"
                  required
                  placeholder="20"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700">Synap Group</label>
                <input
                  type="text"
                  name="synap_group"
                  placeholder="e.g. nido-sat-spring-2026"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
                <p className="text-xs text-gray-500 mt-1">Optional — link to a Synap group for test access.</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition duration-200 disabled:opacity-60"
            >
              {loading ? 'Saving to Database...' : 'Create Class'}
            </button>
          </form>

          {message && (
            <div
              className={`mt-4 p-3 rounded text-center font-semibold ${
                message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
              }`}
            >
              {message}
            </div>
          )}
        </div>

        {/* ROSTERS + SESSIONS */}
        <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
          <h2 className="text-2xl font-bold text-hgl-slate mb-6">Live class rosters</h2>

          {fetchingRosters ? (
            <p className="text-gray-500 animate-pulse">Loading rosters from database...</p>
          ) : (
            <div className="space-y-8">
              {rosters.length === 0 ? (
                <p className="text-gray-500">No classes exist yet.</p>
              ) : (
                rosters.map((c) => {
                  const enrolledCount = c.enrollments?.length ?? 0
                  const schoolLabel = c.schools?.nickname ?? c.school_nickname ?? '—'
                  const sortedSessions = [...(c.sessions ?? [])].sort((a, b) =>
                    a.session_date.localeCompare(b.session_date)
                  )
                  return (
                    <div key={c.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-6">
                        <div>
                          <h3 className="text-lg font-bold text-hgl-slate">
                            {schoolLabel} — {c.class_type}
                          </h3>
                          <p className="text-sm text-gray-600">
                            Instructor: {c.instructor_name}
                            {c.instructor_email ? ` (${c.instructor_email})` : ''} · Starts:{' '}
                            {new Date(c.start_date).toLocaleDateString()}
                          </p>
                          {c.default_location && (
                            <p className="text-sm text-gray-600">Location: {c.default_location}</p>
                          )}
                          {c.synap_group && (
                            <p className="text-sm text-gray-600">Synap group: {c.synap_group}</p>
                          )}
                        </div>
                        <span className="inline-block px-3 py-1 bg-[#00AEEE]/10 text-hgl-blue text-sm font-bold rounded-full whitespace-nowrap">
                          {enrolledCount} / {c.capacity} enrolled
                        </span>
                      </div>

                      {/* SESSIONS */}
                      <div className="p-6 border-b border-gray-200">
                        <h4 className="font-semibold text-hgl-slate mb-3">Sessions</h4>
                        {sortedSessions.length === 0 ? (
                          <p className="text-sm text-gray-500 italic mb-3">No sessions scheduled yet.</p>
                        ) : (
                          <ul className="space-y-2 mb-3">
                            {sortedSessions.map((s) => (
                              <li
                                key={s.id}
                                className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2"
                              >
                                <span>
                                  <strong>{new Date(s.session_date).toLocaleDateString()}</strong>
                                  {s.start_time && ` · ${s.start_time}`}
                                  {s.end_time && ` – ${s.end_time}`}
                                  {s.location && ` · ${s.location}`}
                                </span>
                                <button
                                  onClick={() => handleDeleteSession(s.id)}
                                  className="text-red-600 text-xs hover:underline"
                                >
                                  Remove
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            handleAddSession(c.id, e.currentTarget, c.default_location)
                          }}
                          className="grid grid-cols-4 gap-2 items-end text-sm"
                        >
                          <div>
                            <label className="block text-xs text-gray-600">Date</label>
                            <input type="date" name="session_date" required className="mt-1 w-full border rounded p-1" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600">Start</label>
                            <input type="time" name="start_time" className="mt-1 w-full border rounded p-1" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600">End</label>
                            <input type="time" name="end_time" className="mt-1 w-full border rounded p-1" />
                          </div>
                          <div className="col-span-4 grid grid-cols-4 gap-2 items-end">
                            <div className="col-span-3">
                              <label className="block text-xs text-gray-600">
                                Location (blank = default)
                              </label>
                              <input
                                type="text"
                                name="location"
                                placeholder={c.default_location ?? ''}
                                className="mt-1 w-full border rounded p-1"
                              />
                            </div>
                            <button
                              type="submit"
                              className="bg-hgl-slate text-white py-1 px-3 rounded hover:opacity-90"
                            >
                              Add session
                            </button>
                          </div>
                        </form>
                      </div>

                      {/* ROSTER */}
                      <div className="p-0 overflow-x-auto">
                        {enrolledCount === 0 ? (
                          <p className="text-sm text-gray-500 p-6 text-center italic">
                            No students registered yet.
                          </p>
                        ) : (
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                                  Student
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                                  Student email
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                                  Billing contact
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                                  Parent email
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                                  Status
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                                  Registered
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {c.enrollments?.map((en) => (
                                <tr key={en.id} className="hover:bg-gray-50 transition">
                                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {en.students?.first_name} {en.students?.last_name}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                                    {en.students?.student_email ?? (
                                      <span className="italic text-gray-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                    {en.students?.families?.parent_first_name}{' '}
                                    {en.students?.families?.parent_last_name}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-hgl-blue">
                                    {en.students?.families?.parent_email}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                                    <span
                                      className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                                        en.payment_status === 'Paid'
                                          ? 'bg-green-100 text-green-700'
                                          : 'bg-yellow-100 text-yellow-800'
                                      }`}
                                    >
                                      {en.payment_status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(en.enrolled_at).toLocaleDateString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
