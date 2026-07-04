'use client'

import { useEffect, useState } from 'react'
import { supabase } from './utils/supabase'
import Link from 'next/link'

type ClassCard = {
  id: string
  class_type: string
  instructor_name: string
  price: number
  capacity: number
  start_date: string
  default_location: string | null
  school_nickname: string | null
  schools: { name: string; nickname: string } | null
  sessions: { session_date: string }[] | null
  enrollments: { payment_status: string; waitlist_offer_expires_at: string | null }[] | null
}

/** Mirrors the server's spot accounting: Pending + Paid + active waitlist offers. */
function isFull(c: ClassCard) {
  const now = Date.now()
  const taken = (c.enrollments ?? []).filter(
    (e) =>
      e.payment_status === 'Pending' ||
      e.payment_status === 'Paid' ||
      e.payment_status === 'Completed' ||
      (e.payment_status === 'Waitlisted' &&
        e.waitlist_offer_expires_at != null &&
        new Date(e.waitlist_offer_expires_at).getTime() > now)
  ).length
  return taken >= c.capacity
}

export default function ParentPortal() {
  const [classes, setClasses] = useState<ClassCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchClasses() {
      const { data } = await supabase
        .from('classes')
        .select(
          `
          *,
          schools ( name, nickname ),
          sessions ( session_date ),
          enrollments ( payment_status, waitlist_offer_expires_at )
        `
        )
        .order('created_at', { ascending: false })

      if (data) setClasses(data as unknown as ClassCard[])
      setLoading(false)
    }

    fetchClasses()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-blue-900 mb-2">Higher Ground Learning</h1>
        <h2 className="text-xl font-semibold text-gray-700 mb-8">Available classes &amp; registration</h2>

        {loading ? (
          <p className="text-gray-500 animate-pulse">Loading live classes...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {classes.length === 0 ? (
              <p className="text-gray-500">No classes are currently enrolling.</p>
            ) : (
              classes.map((c) => {
                const schoolLabel = c.schools?.nickname ?? c.school_nickname ?? '—'
                const sessionCount = c.sessions?.length ?? 0
                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-lg shadow-md border border-gray-200 p-6 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full mb-2">
                            {schoolLabel}
                          </span>
                          <h3 className="text-xl font-bold text-gray-900">{c.class_type}</h3>
                        </div>
                        <span className="text-lg font-bold text-green-600">${c.price}</span>
                      </div>

                      <div className="space-y-1 text-sm text-gray-600 mb-6">
                        <p>
                          <strong>Instructor:</strong> {c.instructor_name}
                        </p>
                        <p>
                          <strong>Starts:</strong>{' '}
                          {new Date(c.start_date).toLocaleDateString()}
                        </p>
                        {c.default_location && (
                          <p>
                            <strong>Location:</strong> {c.default_location}
                          </p>
                        )}
                        <p>
                          <strong>Sessions:</strong>{' '}
                          {sessionCount > 0 ? `${sessionCount} scheduled` : 'TBD'}
                        </p>
                        <p>
                          <strong>Capacity:</strong> {c.capacity} students max
                        </p>
                      </div>
                    </div>

                    <Link
                      href={`/register/${c.id}`}
                      className={`block text-center w-full font-bold py-2 px-4 rounded transition text-white ${
                        isFull(c)
                          ? 'bg-amber-500 hover:bg-amber-600'
                          : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {isFull(c) ? 'Class Full — Join Waitlist' : 'Register Now'}
                    </Link>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
