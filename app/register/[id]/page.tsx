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

export default function RegistrationPage() {
  const params = useParams()
  const classId = params.id as string

  const [classDetails, setClassDetails] = useState<ClassDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function fetchClass() {
      const { data } = await supabase
        .from('classes')
        .select('*')
        .eq('id', classId)
        .single()
      if (data) setClassDetails(data as ClassDetails)
    }
    if (classId) fetchClass()
  }, [classId])

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

    // 3. Create the Enrollment in "Pending Checkout" state
    const { data: enrollmentData, error: enrollmentError } = await supabase
      .from('enrollments')
      .insert([
        {
          student_id: studentData.id,
          class_id: classId,
          payment_status: 'Pending Checkout',
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

  if (!classDetails) return <div className="p-10 text-center">Loading class details...</div>

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        <h1 className="text-2xl font-bold text-hgl-slate mb-2">Registration</h1>
        <h2 className="text-lg text-gray-600 font-semibold mb-6">
          {classDetails.school_nickname} — {classDetails.class_type}
        </h2>

        <form onSubmit={handleRegister} className="space-y-6">
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
            {loading ? 'Preparing secure checkout...' : `Proceed to payment ($${classDetails.price})`}
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
