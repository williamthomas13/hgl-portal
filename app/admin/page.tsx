'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import CounselorsPanel from './counselors-panel'
import InstructorsPanel, { type Instructor } from './instructors-panel'
import CancelClassPanel from './cancel-class-panel'

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
  class_cancelled: boolean
  cancellation_outcome: string | null
  enrollment_addons: { hours: number }[] | null
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

type RoomRequest = {
  class_id: string
  status: string
  nudge_count: number
  answer: string | null
  answered_by: string | null
}

type ClassRow = {
  id: string
  slug: string | null
  status: string
  registration_close_date: string | null
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
  delivery_mode: string
  min_enrollment: number | null
  enrollment_deadline: string | null
  schools: { name: string; nickname: string } | null
  enrollments: Enrollment[] | null
  sessions: Session[] | null
}

const CLASS_TYPE_SUGGESTIONS = ['SAT Prep', 'ACT Prep']

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Season+year term from the start date, e.g. "fall26". */
function termFor(startDate: string) {
  const d = new Date(startDate + 'T00:00:00')
  const m = d.getMonth() + 1
  const season = m <= 4 ? 'spring' : m <= 7 ? 'summer' : m <= 10 ? 'fall' : 'winter'
  return `${season}${String(d.getFullYear()).slice(-2)}`
}

const STATUS_STYLES: Record<string, string> = {
  Paid: 'bg-green-100 text-green-700',
  Completed: 'bg-indigo-100 text-indigo-700',
  Pending: 'bg-yellow-100 text-yellow-800',
  Waitlisted: 'bg-blue-100 text-blue-700',
  Expired: 'bg-gray-200 text-gray-500',
  Refunded: 'bg-red-100 text-red-600',
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const [schools, setSchools] = useState<School[]>([])
  const [rosters, setRosters] = useState<ClassRow[]>([])
  const [fetchingRosters, setFetchingRosters] = useState(true)
  const [deliveryMode, setDeliveryMode] = useState<'in_person' | 'online'>('in_person')
  const [minEnrollment, setMinEnrollment] = useState('8')
  const [instructors, setInstructors] = useState<Instructor[]>([])
  const [roomRequests, setRoomRequests] = useState<Record<string, RoomRequest>>({})

  const fetchSchools = useCallback(async () => {
    const { data } = await supabase.from('schools').select('*').order('nickname')
    if (data) setSchools(data)
  }, [])

  const fetchInstructors = useCallback(async () => {
    const { data } = await supabase
      .from('instructors')
      .select('id, email, name, default_meeting_link')
      .order('email')
    if (data) setInstructors(data as Instructor[])
  }, [])

  // Classroom-request status per class (PHASE4_SPEC §4b/§10).
  const fetchRoomRequests = useCallback(async () => {
    const { data } = await supabase
      .from('classroom_requests')
      .select('class_id, status, nudge_count, answer, answered_by')
    if (data) {
      setRoomRequests(Object.fromEntries((data as RoomRequest[]).map((r) => [r.class_id, r])))
    }
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
          class_cancelled,
          cancellation_outcome,
          enrollment_addons ( hours ),
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
    fetchInstructors()
    fetchRoomRequests()
  }, [fetchSchools, fetchRosters, fetchInstructors, fetchRoomRequests])

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

    // Online classes with no explicit location auto-fill the instructor's
    // default meeting link (PHASE4_SPEC §5); admin can still override here or
    // later. In-person classes stay blank → the classroom-request loop asks
    // the counselor at 14 days out.
    const instructorEmail = ((formData.get('instructor_email') as string) || '').trim().toLowerCase()
    let defaultLocation = (formData.get('default_location') as string) || null
    if (!defaultLocation && deliveryMode === 'online' && instructorEmail) {
      defaultLocation =
        instructors.find((i) => i.email === instructorEmail)?.default_meeting_link ?? null
    }

    const newClass = {
      school_nickname: schoolNickname, // keep for backward compat; to be dropped later
      school_id: schoolId,
      class_type: formData.get('class_type'),
      instructor_name: formData.get('instructor_name'),
      instructor_email: instructorEmail || null,
      price: formData.get('price'),
      capacity: formData.get('capacity'),
      start_date: formData.get('start_date'),
      default_location: defaultLocation,
      synap_group: formData.get('synap_group') || null,
      delivery_mode: deliveryMode,
      min_enrollment: Number(minEnrollment) || (deliveryMode === 'online' ? 3 : 8),
      enrollment_deadline: formData.get('enrollment_deadline') || null,
      registration_close_date: formData.get('registration_close_date') || null,
      // Human-readable registration URL segment: nickname-classtype-term.
      slug: slugify(
        `${schoolNickname}-${formData.get('class_type')}-${termFor(formData.get('start_date') as string)}`
      ),
    }

    let { error } = await supabase.from('classes').insert([newClass])
    // Slug collision (same school/type/term): suffix until unique.
    for (let n = 2; error?.code === '23505' && n <= 5; n++) {
      ;({ error } = await supabase
        .from('classes')
        .insert([{ ...newClass, slug: `${newClass.slug}-${n}` }]))
    }

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

  // ---------------------------------------------------------------------------
  // Registration links (pasted into Squarespace "Register" buttons)
  // ---------------------------------------------------------------------------
  const [copiedClassId, setCopiedClassId] = useState<string | null>(null)

  function registrationUrl(c: ClassRow) {
    return `${window.location.origin}/register/${c.slug ?? c.id}`
  }

  async function handleCopyLink(c: ClassRow) {
    await navigator.clipboard.writeText(registrationUrl(c))
    setCopiedClassId(c.id)
    setTimeout(() => setCopiedClassId(null), 2000)
  }

  async function handleEditRegistrationClose(c: ClassRow) {
    const next = prompt(
      'Registration close date (YYYY-MM-DD). Blank = default (first session):',
      c.registration_close_date ?? ''
    )
    if (next == null) return
    const trimmed = next.trim()
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      alert('Use YYYY-MM-DD format, or leave blank for the default.')
      return
    }
    const { error } = await supabase
      .from('classes')
      .update({ registration_close_date: trimmed || null })
      .eq('id', c.id)
    if (error) {
      alert('Error updating close date: ' + error.message)
      return
    }
    fetchRosters()
  }

  async function handleEditSlug(c: ClassRow) {
    const next = prompt(
      'Registration URL slug (lowercase letters, numbers, dashes):',
      c.slug ?? ''
    )
    if (next == null) return
    const cleaned = next
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!cleaned) {
      alert('Slug cannot be empty.')
      return
    }
    const { error } = await supabase.from('classes').update({ slug: cleaned }).eq('id', c.id)
    if (error) {
      alert(
        error.code === '23505'
          ? 'That slug is already used by another class.'
          : 'Error updating slug: ' + error.message
      )
      return
    }
    fetchRosters()
  }

  // Refunds are Option A (SPEC v2.5 §13): money moves in the Stripe dashboard
  // only — this just records the refund. The status change frees the capacity
  // spot (the hourly sweep extends a W2 waitlist offer if anyone is in line),
  // drops the enrollment out of paid counts and post-class emails #7/#8, and
  // stops any still-pending scheduled sends. stripe_payment_intent_id and
  // payment history stay on the row (audit trail for Phase 6 / QuickBooks).
  async function handleMarkRefunded(enrollmentId: string, studentName: string) {
    if (
      !confirm(
        `Mark ${studentName}'s enrollment as Refunded?\n\n` +
          'This records the refund and frees the spot (waitlist offers go out ' +
          'automatically). Issue the actual refund in the Stripe dashboard — ' +
          'the portal moves no money.'
      )
    )
      return
    const { error } = await supabase
      .from('enrollments')
      .update({ payment_status: 'Refunded' })
      .eq('id', enrollmentId)
      .in('payment_status', ['Paid', 'Completed']) // guard: only paid rows
    if (error) {
      alert('Error marking refunded: ' + error.message)
      return
    }
    fetchRosters()
  }

  // Bookkeeping after a cancellation: how each paid family resolved it
  // (refunded / converted / credited) — recorded from the billy@ reply
  // thread, no Stripe automation (PHASE4_SPEC §12).
  async function handleOutcome(enrollmentId: string, outcome: string) {
    const { error } = await supabase
      .from('enrollments')
      .update({ cancellation_outcome: outcome || null })
      .eq('id', enrollmentId)
    if (error) {
      alert('Error recording outcome: ' + error.message)
      return
    }
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
          <div className="flex items-start justify-between mb-6">
            <h1 className="text-2xl font-bold text-hgl-slate">Admin Command Center</h1>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                window.location.assign('/login')
              }}
              className="text-sm text-gray-500 hover:text-hgl-slate underline"
            >
              Sign out
            </button>
          </div>
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
                  list="class-types-list"
                  placeholder="e.g. SAT Prep"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
                <datalist id="class-types-list">
                  {CLASS_TYPE_SUGGESTIONS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <p className="text-xs text-gray-500 mt-1">Pick a suggestion or type anything.</p>
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

              <div>
                <label className="block text-sm font-medium text-gray-700">Delivery Mode</label>
                <select
                  name="delivery_mode"
                  value={deliveryMode}
                  onChange={(e) => {
                    const mode = e.target.value as 'in_person' | 'online'
                    setDeliveryMode(mode)
                    setMinEnrollment(mode === 'online' ? '3' : '8')
                  }}
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition bg-white"
                >
                  <option value="in_person">In person</option>
                  <option value="online">Online</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Minimum Enrollment</label>
                <input
                  type="number"
                  name="min_enrollment"
                  value={minEnrollment}
                  onChange={(e) => setMinEnrollment(e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
                <p className="text-xs text-gray-500 mt-1">Default 8 in person / 3 online — editable.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Enrollment Deadline</label>
                <input
                  type="date"
                  name="enrollment_deadline"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
                <p className="text-xs text-gray-500 mt-1">Optional — min-enrollment check runs here (else 7 days before start).</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Registration Closes</label>
                <input
                  type="date"
                  name="registration_close_date"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                />
                <p className="text-xs text-gray-500 mt-1">Blank = first session. Set later to allow mid-class joins.</p>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700">Synap Group</label>
                <input
                  type="text"
                  name="synap_group"
                  placeholder="https://…  (full Synap group link — used as the button URL in emails)"
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
                  const enrolledCount =
                    c.enrollments?.filter((en) =>
                      ['Paid', 'Pending', 'Completed'].includes(en.payment_status)
                    ).length ?? 0
                  const waitlistCount =
                    c.enrollments?.filter((en) => en.payment_status === 'Waitlisted').length ?? 0
                  const schoolLabel = c.schools?.nickname ?? c.school_nickname ?? '—'
                  const sortedSessions = [...(c.sessions ?? [])].sort((a, b) =>
                    a.session_date.localeCompare(b.session_date)
                  )
                  const isCancelled = c.status === 'cancelled'
                  return (
                    <div key={c.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-6">
                        <div>
                          <h3 className="text-lg font-bold text-hgl-slate">
                            {schoolLabel} — {c.class_type}
                            {isCancelled && (
                              <span className="ml-2 align-middle inline-block px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded uppercase tracking-wide">
                                Cancelled
                              </span>
                            )}
                          </h3>
                          <p className="text-sm text-gray-600">
                            Instructor: {c.instructor_name}
                            {c.instructor_email ? ` (${c.instructor_email})` : ''} · Starts:{' '}
                            {new Date(c.start_date).toLocaleDateString()}
                          </p>
                          {c.default_location && (
                            <p className="text-sm text-gray-600">Location: {c.default_location}</p>
                          )}
                          {c.delivery_mode === 'in_person' && (() => {
                            const rr = roomRequests[c.id]
                            if (!rr && c.default_location) return null
                            const badge = !rr
                              ? { text: 'room not set — counselor gets asked 14 days out', cls: 'bg-gray-100 text-gray-500' }
                              : rr.status === 'pending'
                                ? { text: `room requested from counselor${rr.nudge_count > 0 ? ` · ${rr.nudge_count} nudge${rr.nudge_count > 1 ? 's' : ''}` : ''}`, cls: 'bg-yellow-100 text-yellow-800' }
                                : rr.status === 'answered'
                                  ? { text: `room set by ${rr.answered_by ?? 'counselor'}: ${rr.answer}`, cls: 'bg-green-100 text-green-700' }
                                  : { text: 'room request cancelled (set directly)', cls: 'bg-gray-100 text-gray-500' }
                            return (
                              <p className="text-xs mt-1">
                                <span className={`inline-block px-2 py-0.5 rounded font-semibold ${badge.cls}`}>
                                  {badge.text}
                                </span>
                              </p>
                            )
                          })()}
                          {c.synap_group && (
                            <p className="text-sm text-gray-600">Synap group: {c.synap_group}</p>
                          )}
                          <p className="text-sm text-gray-600 mt-2 flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">Registration link:</span>
                            <code className="bg-gray-100 rounded px-2 py-0.5 text-xs">
                              {registrationUrl(c)}
                            </code>
                            <button
                              onClick={() => handleCopyLink(c)}
                              className="bg-hgl-blue text-white text-xs font-bold px-3 py-1 rounded hover:bg-hgl-blue-hover transition"
                            >
                              {copiedClassId === c.id ? 'Copied!' : 'Copy'}
                            </button>
                            <button
                              onClick={() => handleEditSlug(c)}
                              className="text-xs text-gray-500 underline hover:text-hgl-blue"
                            >
                              edit slug
                            </button>
                          </p>
                          <p className="text-sm text-gray-600 flex items-center gap-2">
                            <span className="font-semibold">Registration closes:</span>
                            {c.registration_close_date
                              ? new Date(c.registration_close_date + 'T00:00:00').toLocaleDateString()
                              : 'first session (default)'}
                            <button
                              onClick={() => handleEditRegistrationClose(c)}
                              className="text-xs text-gray-500 underline hover:text-hgl-blue"
                            >
                              edit
                            </button>
                          </p>
                          {!isCancelled && (
                            <div className="mt-2">
                              <CancelClassPanel
                                classId={c.id}
                                classLabel={`${schoolLabel} ${c.class_type}`}
                                classPrice={Number(c.price)}
                                paid={(c.enrollments ?? [])
                                  .filter((en) => en.payment_status === 'Paid')
                                  .map((en) => ({
                                    enrollmentId: en.id,
                                    studentName: `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim(),
                                    parentName: `${en.students?.families?.parent_first_name ?? ''} ${en.students?.families?.parent_last_name ?? ''}`.trim(),
                                    addonHours: (en.enrollment_addons ?? []).reduce(
                                      (sum, a) => sum + Number(a.hours),
                                      0
                                    ),
                                  }))}
                                pendingCount={(c.enrollments ?? []).filter((en) => en.payment_status === 'Pending').length}
                                waitlistedCount={waitlistCount}
                                onDone={fetchRosters}
                              />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="inline-block px-3 py-1 bg-[#00AEEE]/10 text-hgl-blue text-sm font-bold rounded-full whitespace-nowrap">
                            {enrolledCount} / {c.capacity} enrolled
                          </span>
                          {waitlistCount > 0 && (
                            <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full whitespace-nowrap">
                              {waitlistCount} waitlisted
                            </span>
                          )}
                          {c.min_enrollment != null && (
                            <span className="text-xs text-gray-500 whitespace-nowrap">
                              min {c.min_enrollment} · {c.delivery_mode === 'online' ? 'online' : 'in person'}
                            </span>
                          )}
                        </div>
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
                                        STATUS_STYLES[en.payment_status] ?? 'bg-yellow-100 text-yellow-800'
                                      }`}
                                    >
                                      {en.payment_status}
                                    </span>
                                    {(en.payment_status === 'Paid' ||
                                      en.payment_status === 'Completed') && (
                                      <button
                                        onClick={() =>
                                          handleMarkRefunded(
                                            en.id,
                                            `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim()
                                          )
                                        }
                                        title="Records the refund and frees the spot — issue the actual refund in the Stripe dashboard"
                                        className="ml-2 text-xs text-red-600 underline hover:text-red-800"
                                      >
                                        mark refunded
                                      </button>
                                    )}
                                    {en.class_cancelled &&
                                      (en.payment_status === 'Paid' ||
                                        en.payment_status === 'Completed' ||
                                        en.payment_status === 'Refunded') && (
                                        <select
                                          value={en.cancellation_outcome ?? ''}
                                          onChange={(e) => handleOutcome(en.id, e.target.value)}
                                          title="How this family resolved the cancellation (bookkeeping — from the billy@ reply thread)"
                                          className="ml-2 border border-gray-300 rounded p-0.5 text-xs bg-white"
                                        >
                                          <option value="">outcome…</option>
                                          <option value="refunded">refunded</option>
                                          <option value="converted">converted to tutoring</option>
                                          <option value="credited">credited to next course</option>
                                        </select>
                                      )}
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

        {/* PHASE 4: COUNSELORS + INSTRUCTORS */}
        <CounselorsPanel schools={schools} />
        <InstructorsPanel instructors={instructors} onChange={fetchInstructors} />
      </div>
    </div>
  )
}
