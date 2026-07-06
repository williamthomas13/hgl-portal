'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../utils/supabase'

type SessionRow = {
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

type ClassDetails = {
  id: string
  slug: string | null
  school_nickname: string | null
  class_type: string
  instructor_name: string
  price: number
  capacity: number
  start_date: string
  default_location: string | null
  school_id: string | null
  registration_close_date: string | null
  schools: { name: string; nickname: string } | null
  sessions: SessionRow[] | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAIN_SITE = 'https://www.highergroundlearning.com'

function fmtTime(t: string | null) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Mirrors the server's {classTime}: uniform session time range or null. */
function classTimeOf(sessions: SessionRow[]) {
  const withTimes = sessions.filter((s) => s.start_time)
  if (withTimes.length === 0 || withTimes.length !== sessions.length) return null
  const key = (s: SessionRow) => `${s.start_time}|${s.end_time ?? ''}`
  if (!withTimes.every((s) => key(s) === key(withTimes[0]))) return null
  const f = withTimes[0]
  return f.end_time ? `${fmtTime(f.start_time)} to ${fmtTime(f.end_time)}` : fmtTime(f.start_time)
}

type EnrollmentSlot = {
  payment_status: string
  waitlist_offer_expires_at: string | null
}

type TutoringPackage = {
  id: string
  name: string
  hours: number
  hourly_rate: number
  package_price: number
  regular_hourly_rate: number
}

/** "5" → "Five" for the add-on button labels; numerals beyond the map. */
function hoursWord(n: number) {
  const words: Record<number, string> = {
    1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five',
    6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten',
    11: 'Eleven', 12: 'Twelve', 15: 'Fifteen', 20: 'Twenty',
  }
  return words[n] ?? String(n)
}

/** Mirrors the server's spot accounting: Pending + Paid + active waitlist offers. */
function takenCount(slots: EnrollmentSlot[]) {
  const now = Date.now()
  return slots.filter(
    (e) =>
      e.payment_status === 'Pending' ||
      e.payment_status === 'Paid' ||
      e.payment_status === 'Completed' ||
      (e.payment_status === 'Waitlisted' &&
        e.waitlist_offer_expires_at != null &&
        new Date(e.waitlist_offer_expires_at).getTime() > now)
  ).length
}

export default function RegistrationPage() {
  const params = useParams()
  // The URL segment is a human-readable slug (Squarespace buttons, print) —
  // raw UUIDs still work for legacy links and Stripe cancel URLs.
  const idOrSlug = params.id as string

  const [notFound, setNotFound] = useState(false)
  const [classDetails, setClassDetails] = useState<ClassDetails | null>(null)
  const [isFull, setIsFull] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null)
  // Add-on step: shown between the form and Stripe checkout.
  const [packages, setPackages] = useState<TutoringPackage[]>([])
  const [pendingCheckout, setPendingCheckout] = useState<{
    enrollmentId: string
    parentEmail: string
  } | null>(null)

  useEffect(() => {
    async function fetchClass() {
      const { data } = await supabase
        .from('classes')
        .select(
          '*, schools(name, nickname), sessions(session_date, start_time, end_time, location), enrollments(payment_status, waitlist_offer_expires_at)'
        )
        .eq(UUID_RE.test(idOrSlug) ? 'id' : 'slug', idOrSlug)
        .single()
      if (data) {
        setClassDetails(data as ClassDetails)
        setIsFull(takenCount(data.enrollments ?? []) >= data.capacity)
      } else {
        setNotFound(true)
      }
    }
    async function fetchPackages() {
      const { data } = await supabase
        .from('tutoring_packages')
        .select('id, name, hours, hourly_rate, package_price, regular_hourly_rate')
        .eq('phase', 'pre_class')
        .eq('active', true)
        .order('hours')
      if (data) setPackages(data as TutoringPackage[])
    }
    if (idOrSlug) {
      fetchClass()
      fetchPackages()
    }
  }, [idOrSlug])

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
          graduating_year: formData.get('graduatingYear') || null,
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
          class_id: classDetails!.id,
          payment_status: 'Pending',
          accommodations: formData.get('accommodations') || null,
          previous_scores: formData.get('previousScores') || null,
          notes: formData.get('notes') || null,
        },
      ])
      .select()
      .single()

    if (enrollmentError || !enrollmentData) {
      setMessage('Error enrolling: ' + (enrollmentError?.message ?? 'unknown'))
      setLoading(false)
      return
    }

    // 4. Add-on step: offer pre-class tutoring packages before checkout
    // (only available at registration). If none exist, go straight to Stripe.
    if (packages.length > 0) {
      setPendingCheckout({ enrollmentId: enrollmentData.id, parentEmail })
      setMessage('')
      setLoading(false)
    } else {
      await proceedToCheckout(enrollmentData.id, parentEmail, null)
    }
  }

  // Stripe handoff — pass enrollment id so the webhook can mark exactly this
  // row paid; packageId adds the tutoring add-on as a second line item.
  async function proceedToCheckout(
    enrollmentId: string,
    parentEmail: string,
    packageId: string | null
  ) {
    setLoading(true)
    setMessage('Redirecting to secure checkout...')
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          className: `${classDetails?.school_nickname ?? 'HGL'} — ${classDetails?.class_type}`,
          price: classDetails?.price,
          customerEmail: parentEmail,
          classId: classDetails?.id,
          enrollmentId,
          packageId,
        }),
      })

      const data = await response.json()

      if (data.url) {
        window.location.assign(data.url)
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
          classId: classDetails?.id,
          parentFirst: formData.get('parentFirst'),
          parentLast: formData.get('parentLast'),
          parentEmail: formData.get('parentEmail'),
          studentFirst: formData.get('studentFirst'),
          studentLast: formData.get('studentLast'),
          studentEmail: formData.get('studentEmail'),
          graduatingYear: formData.get('graduatingYear'),
          accommodations: formData.get('accommodations'),
          previousScores: formData.get('previousScores'),
          notes: formData.get('notes'),
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

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-10">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue text-center">
          <h1 className="text-2xl font-bold text-hgl-slate mb-4">Class not found</h1>
          <p className="text-gray-600 mb-6">
            We couldn&apos;t find that class — the link may be out of date. Current classes and
            registration links are on our main site.
          </p>
          <a
            href={MAIN_SITE}
            className="inline-block bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition"
          >
            Back to Higher Ground Learning
          </a>
        </div>
      </div>
    )
  }

  if (!classDetails) return <div className="p-10 text-center">Loading class details...</div>

  const sessions = [...(classDetails.sessions ?? [])].sort((a, b) =>
    a.session_date.localeCompare(b.session_date)
  )
  const firstSession = sessions[0]?.session_date ?? classDetails.start_date
  const classTime = classTimeOf(sessions)
  const schoolLabel = classDetails.schools?.nickname ?? classDetails.school_nickname ?? 'HGL'
  const classLabel = `${schoolLabel} ${classDetails.class_type}`
  const today = new Date().toLocaleDateString('en-CA')

  // Registration closes after the first session by default;
  // registration_close_date overrides per class (e.g. allow joining
  // through session 3).
  const registrationClose = classDetails.registration_close_date ?? firstSession
  if (today > registrationClose) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-10">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue text-center">
          <h1 className="text-2xl font-bold text-hgl-slate mb-4">
            Registration for this class has closed
          </h1>
          <p className="text-gray-600 mb-6">
            Registration for the {classLabel} class is no longer open. Upcoming classes are listed
            on our main site.
          </p>
          <a
            href={MAIN_SITE}
            className="inline-block bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition"
          >
            Back to Higher Ground Learning
          </a>
        </div>
      </div>
    )
  }

  // Visual session calendar rendered from the sessions table — replaces the
  // old workflow of pasting Google Sheets calendar screenshots into
  // Squarespace pages.
  const sessionCalendar =
    sessions.length > 0 ? (
      <div className="mb-4">
        <div className="grid grid-cols-1 gap-1.5">
          {sessions.map((s, i) => {
            const d = new Date(s.session_date + 'T00:00:00')
            const loc = s.location ?? classDetails.default_location
            return (
              <div
                key={s.session_date + i}
                className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm"
              >
                <div className="w-12 text-center shrink-0 bg-white border border-gray-200 rounded">
                  <div className="text-[10px] font-bold text-hgl-blue uppercase leading-tight pt-0.5">
                    {d.toLocaleDateString('en-US', { month: 'short' })}
                  </div>
                  <div className="text-base font-bold text-hgl-slate leading-tight pb-0.5">
                    {d.getDate()}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-hgl-slate">
                    {d.toLocaleDateString('en-US', { weekday: 'long' })}
                    <span className="text-gray-500 font-normal"> · Session {i + 1}</span>
                  </div>
                  <div className="text-gray-600">
                    {fmtTime(s.start_time)
                      ? `${fmtTime(s.start_time)}${s.end_time ? ` – ${fmtTime(s.end_time)}` : ''}`
                      : 'Time TBD'}
                    {loc ? ` · ${loc}` : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-sm mt-2">
          <a
            href={`/classes/${classDetails.id}/calendar`}
            className="text-hgl-blue underline font-semibold"
          >
            Add to your calendar / subscribe →
          </a>
        </p>
      </div>
    ) : null

  const classHeader = (
    <div className="mb-6 border-b border-gray-200 pb-4">
      <h2 className="text-xl font-bold text-hgl-slate">{classLabel}</h2>
      <p className="text-sm text-gray-600 mt-1 mb-3">
        {classDetails.schools?.name && classDetails.schools.name !== schoolLabel
          ? `${classDetails.schools.name} · `
          : ''}
        Starts {fmtDate(firstSession)}
        {sessions.length > 1 ? ` · ${sessions.length} sessions` : ''}
        {classTime ? ` · ${classTime}` : ''}
        {' · '}
        <span className="font-semibold">${classDetails.price} per student</span>
      </p>
      {sessionCalendar}
    </div>
  )

  // Add-on step between the registration form and Stripe checkout.
  if (pendingCheckout) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
          <h1 className="text-2xl font-bold text-hgl-slate mb-4">Add 1-on-1 tutoring?</h1>
          <div className="text-gray-700 space-y-4 mb-6">
            <p>
              After the group class, the biggest point gains come from regular, individualized
              attention over several weeks. Our 1-on-1 tutoring sessions are tailored to each
              student and designed to overcome their specific weaknesses, exploit their strengths,
              and refine student-specific strategies. These sessions work in tandem with the group
              course, and are perfect for students who are taking the test multiple times, reaching
              for exceptionally high scores, or facing unique challenges. Students receiving 1-on-1
              tutoring also receive unlimited access to online practice materials and extra
              diagnostic tests with score reports.
            </p>
            <p>
              1-on-1 tutoring hours are only discounted when purchased alongside a group class.
              Choose your amount of 1-on-1 hours and we&apos;ll contact you to schedule them
              anytime based on your needs and availability. Hours are transferable and never
              expire.
            </p>
          </div>
          <div className="space-y-3 mb-6">
            {packages.map((p) => (
              <button
                key={p.id}
                disabled={loading}
                onClick={() =>
                  proceedToCheckout(pendingCheckout.enrollmentId, pendingCheckout.parentEmail, p.id)
                }
                className="w-full text-center border-2 border-hgl-blue text-hgl-blue font-bold rounded-lg p-4 hover:bg-hgl-blue hover:text-white transition disabled:opacity-60"
              >
                {hoursWord(p.hours)} 1-on-1 Hours @ ${p.hourly_rate}/hour (regularly $
                {p.regular_hourly_rate}/hour) — ${p.package_price.toLocaleString()}
              </button>
            ))}
          </div>
          <button
            disabled={loading}
            onClick={() =>
              proceedToCheckout(pendingCheckout.enrollmentId, pendingCheckout.parentEmail, null)
            }
            className="w-full bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-60"
          >
            {loading ? 'Preparing secure checkout...' : 'No thanks, just the class'}
          </button>
          {message && (
            <div className="mt-6 p-4 rounded-md text-center font-bold bg-blue-50 text-hgl-blue">
              {message}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (waitlistPosition !== null) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue text-center">
          <h1 className="text-2xl font-bold text-hgl-slate mb-4">You&apos;re on the waitlist</h1>
          <p className="text-gray-700">
            You&apos;re <strong>#{waitlistPosition}</strong> in line for {classLabel}.
            We&apos;ve emailed you a
            confirmation. If a spot opens, you&apos;ll get a payment link with 48 hours to claim it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        <h1 className="text-2xl font-bold text-hgl-slate mb-4">
          {isFull ? 'Join the Waitlist' : 'Registration'}
        </h1>
        {classHeader}
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
                  Graduating Year <span className="text-gray-400">(optional)</span>
                </label>
                <input type="text" name="graduatingYear" placeholder="e.g. 2027" className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600">
                  Testing accommodations <span className="text-gray-400">(optional)</span>
                </label>
                <input type="text" name="accommodations" placeholder="e.g. extended time" className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600">
                  Previous test scores <span className="text-gray-400">(optional)</span>
                </label>
                <input type="text" name="previousScores" placeholder="e.g. PSAT 1150" className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600">
                  Anything else we should know? <span className="text-gray-400">(optional)</span>
                </label>
                <textarea name="notes" rows={2} className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
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
