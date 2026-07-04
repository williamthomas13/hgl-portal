'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../utils/supabase'

type ClassDetails = {
  id: string
  school_nickname: string | null
  class_type: string
  instructor_name: string
  price: number
  capacity: number
  start_date: string
  default_location: string | null
  school_id: string | null
}

type EnrollmentSlot = {
  payment_status: string
  waitlist_offer_expires_at: string | null
}

/** Mirrors the server's spot accounting: Pending + Paid + active waitlist offers. */
function takenCount(slots: EnrollmentSlot[]) {
  const now = Date.now()
  return slots.filter(
    (e) =>
      e.payment_status === 'Pending' ||
      e.payment_status === 'Paid' ||
      (e.payment_status === 'Waitlisted' &&
        e.waitlist_offer_expires_at != null &&
        new Date(e.waitlist_offer_expires_at).getTime() > now)
  ).length
}

export default function RegistrationPage() {
  const params = useParams()
  const classId = params.id as string

  const [classDetails, setClassDetails] = useState<ClassDetails | null>(null)
  const [isFull, setIsFull] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null)

  useEffect(() => {
    async function fetchClass() {
      const { data } = await supabase
        .from('classes')
        .select('*, enrollments(payment_status, waitlist_offer_expires_at)')
        .eq('id', classId)
        .single()
      if (data) {
        setClassDetails(data as ClassDetails)
        setIsFull(takenCount(data.enrollments ?? []) >= data.capacity)
      }
    }
    if (classId) fetchClass()
  }, [classId])

  // -------------------------------------------------------------------------
  // Normal registration → Stripe checkout
  // -------------------------------------------------------------------------
  async function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('Saving family details...')
    const formData = new FormData(e.currentTarget)

    const parentEmail = (formData.get('parentEmail') as string).trim().toLowerCase()
    const studentEmailRaw = formData.get('studentEmail') as string | null
    const studentEmail = studentEmailRaw ? studentEmailRaw.trim().toLowerCase() : null

    // 1. Upsert the Family (billing account, one row per parent email)
    const { data: familyData, error: familyError } = await supabase
      .from('families')
      .upsert(
        [
          {
            parent_first_name: formData.get('parentFirst'),
            parent_last_name: formData.get('parentLast'),
            parent_email: parentEmail,
          },
        ],
        { onConflict: 'parent_email' }
      )
      .select()
      .single()

    if (familyError || !familyData) {
      setMessage('Error saving account: ' + (familyError?.message ?? 'unknown'))
      setLoading(false)
      return
    }

    // 2. Create the Student, link to Family, and capture student_email + school_id
    const { data: studentData, error: studentError } = await supabase
      .from('students')
      .insert([
        {
          family_id: familyData.id,
          first_name: formData.get('studentFirst'),
          last_name: formData.get('studentLast'),
          student_email: studentEmail,
          school_id: classDetails?.school_id ?? null,
          grade_level: formData.get('studentGrade') || null,
        },
      ])
      .select()
      .single()

    if (studentError || !studentData) {
      setMessage('Error saving student: ' + (studentError?.message ?? 'unknown'))
      setLoading(false)
      return
    }

    // 3. Create the Enrollment in "Pending" state (holds a capacity spot)
    const { data: enrollmentData, error: enrollmentError } = await supabase
      .from('enrollments')
      .insert([
        {
          student_id: studentData.id,
          class_id: classId,
          payment_status: 'Pending',
        },
      ])
      .select()
      .single()

    if (enrollmentError || !enrollmentData) {
      setMessage('Error enrolling: ' + (enrollmentError?.message ?? 'unknown'))
      setLoading(false)
      return
    }

    setMessage('Redirecting to secure checkout...')

    // 4. Stripe handoff — pass enrollment id so the webhook can mark exactly this row paid
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          className: `${classDetails?.school_nickname ?? 'HGL'} — ${classDetails?.class_type}`,
          price: classDetails?.price,
          customerEmail: parentEmail,
          classId,
          enrollmentId: enrollmentData.id,
        }),
      })

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        setMessage('Checkout error: ' + data.error)
        setLoading(false)
      }
    } catch {
      setMessage('Failed to connect to checkout engine.')
      setLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // Waitlist join (class is full — no payment)
  // -------------------------------------------------------------------------
  async function handleWaitlist(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('Joining the waitlist...')
    const formData = new FormData(e.currentTarget)

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          parentFirst: formData.get('parentFirst'),
          parentLast: formData.get('parentLast'),
          parentEmail: formData.get('parentEmail'),
          studentFirst: formData.get('studentFirst'),
          studentLast: formData.get('studentLast'),
          studentEmail: formData.get('studentEmail'),
          studentGrade: formData.get('studentGrade'),
        }),
      })
      const data = await response.json()
      if (response.ok) {
        setWaitlistPosition(data.position)
        setMessage('')
      } else {
        setMessage('Error: ' + data.error)
      }
    } catch {
      setMessage('Error: failed to join the waitlist.')
    }
    setLoading(false)
  }

  if (!classDetails) return <div className="p-10 text-center">Loading class details...</div>

  if (waitlistPosition !== null) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue text-center">
          <h1 className="text-2xl font-bold text-hgl-slate mb-4">You&apos;re on the waitlist</h1>
          <p className="text-gray-700">
            You&apos;re <strong>#{waitlistPosition}</strong> in line for{' '}
            {classDetails.school_nickname} — {classDetails.class_type}. We&apos;ve emailed you a
            confirmation. If a spot opens, you&apos;ll get a payment link with 48 hours to claim it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        <h1 className="text-2xl font-bold text-hgl-slate mb-2">
          {isFull ? 'Join the Waitlist' : 'Registration'}
        </h1>
        <h2 className="text-lg text-gray-600 font-semibold mb-2">
          {classDetails.school_nickname} — {classDetails.class_type}
        </h2>
        {isFull && (
          <p className="mb-6 text-sm bg-yellow-50 text-yellow-800 rounded p-3">
            This class is currently full. Join the waitlist (no payment now) and we&apos;ll email
            you a payment link if a spot opens — first come, first served.
          </p>
        )}

        <form onSubmit={isFull ? handleWaitlist : handleRegister} className="space-y-6">
          {/* Parent / Guardian */}
          <div className="bg-gray-50 p-4 rounded-md border">
            <h3 className="font-semibold text-hgl-slate mb-3">Parent / Guardian Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600">First Name</label>
                <input type="text" name="parentFirst" required className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div>
                <label className="block text-sm text-gray-600">Last Name</label>
                <input type="text" name="parentLast" required className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600">Email Address (for billing & parent communications)</label>
                <input type="email" name="parentEmail" required className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
            </div>
          </div>

          {/* Student */}
          <div className="bg-gray-50 p-4 rounded-md border">
            <h3 className="font-semibold text-hgl-slate mb-3">Student Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600">First Name</label>
                <input type="text" name="studentFirst" required className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div>
                <label className="block text-sm text-gray-600">Last Name</label>
                <input type="text" name="studentLast" required className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600">
                  Student Email <span className="text-gray-400">(for class reminders & Synap access)</span>
                </label>
                <input type="email" name="studentEmail" className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600">
                  Grade Level <span className="text-gray-400">(optional)</span>
                </label>
                <input type="text" name="studentGrade" placeholder="e.g. 11th" className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition duration-200 disabled:opacity-60"
          >
            {loading
              ? isFull
                ? 'Joining waitlist...'
                : 'Preparing secure checkout...'
              : isFull
                ? 'Join Waitlist (no payment now)'
                : `Proceed to payment ($${classDetails.price})`}
          </button>
        </form>

        {message && (
          <div
            className={`mt-6 p-4 rounded-md text-center font-bold ${
              message.includes('Error') || message.includes('Failed')
                ? 'bg-red-100 text-red-700'
                : 'bg-blue-50 text-hgl-blue'
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
