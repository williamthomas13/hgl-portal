'use client'

import { useState, useEffect } from 'react'
import SessionCalendar from '../../components/SessionCalendar'
import { ClassNotFound, PublicNoticeCard } from '../../components/PublicNotice'
import InterestCapture from '../../components/InterestCapture'
import { bySessionStart, formatDateOnly, publicTimeCityLabel } from '../../utils/dates'
import { renderSiteMarkdown } from '../../utils/site-md'

type SessionRow = {
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

// Payload of GET /api/class-info/{idOrSlug} — the browser no longer talks to
// the database directly (Phase 3: anon has no RLS policies).
type ClassDetails = {
  id: string
  slug: string | null
  class_type: string
  price: number
  start_date: string
  default_location: string | null
  registration_close_date: string | null
  timezone?: string | null
  /** PL-353: an online class's own city list for time labels. */
  display_cities?: string | null
  delivery_mode?: string | null
  schools: { name: string; nickname: string; timezone: string | null; city?: string | null } | null
  sessions: SessionRow[] | null
  isFull: boolean
  /** Cancelled classes render as full with no waitlist (PHASE4_SPEC §12). */
  cancelled?: boolean
  packages: TutoringPackage[]
  /** PL-279: the class has a discount code configured (never the code itself). */
  promoAvailable?: boolean
  /** PL-293: the class's marketing page (Squarespace). */
  /** PL-384: the class's own page (permanent code URL when it resolves). */
  page_path?: string | null
  /** PL-279: the emailed link's auto-applied cohort discount. */
  followOnDiscount?: { amount: number; code: string; endDate: string } | null
  /** PL-279: plain-English note when the link's discount no longer applies. */
  followOnDiscountNote?: string | null
  /** PL-357: the add-1-on-1 step's pitch copy, from the flow-only block. */
  upsellPitchMarkdown?: string | null
  /** PL-364: physical add-on products (offered only when fulfillable). */
  products?: { id: string; name: string; price: number; priceLabel: string }[]
  /** PL-364: Printful's shipping-coverage country list. */
  shipCountries?: { code: string; name: string }[]
}

function fmtTime(t: string | null) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDate(iso: string) {
  return formatDateOnly(iso, { month: 'long', day: 'numeric', year: 'numeric' })
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

// PL-384: the form itself takes idOrSlug as a prop so the evergreen
// /{code}/register route can serve THE SAME registration form in place —
// the /register/{id} page below stays the direct address.
export function RegistrationForm({ idOrSlug }: { idOrSlug: string }) {

  const [notFound, setNotFound] = useState(false)
  // PL-60: an expired resume-payment link redirects here with ?expired=1 —
  // greet it with an explanation instead of a bare form. (Read from
  // window.location rather than useSearchParams to keep the page out of the
  // Suspense-boundary requirement.)
  const [cameFromExpiredLink, setCameFromExpiredLink] = useState(false)
  // PL-279: the emailed auto-apply link (?fo=token&fe=enrollment) + the
  // typed-code fallback — both validated server-side, never trusted here.
  const [foParams, setFoParams] = useState<{ fo: string; fe: string } | null>(null)
  const [typedCode, setTypedCode] = useState('')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setCameFromExpiredLink(q.get('expired') === '1')
    const fo = q.get('fo')
    const fe = q.get('fe')
    if (fo && fe) setFoParams({ fo, fe })
  }, [])
  const [classDetails, setClassDetails] = useState<ClassDetails | null>(null)
  const [isFull, setIsFull] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null)
  // PL-69: live label — "Ana's pronouns" once the name is typed.
  // PL-125: one entry per student block (siblings share the parent block).
  const [studentFirstTyped, setStudentFirstTyped] = useState<string[]>([''])
  const [siblingCount, setSiblingCount] = useState(1)
  // Add-on step: shown between the form and Stripe checkout.
  const [packages, setPackages] = useState<TutoringPackage[]>([])
  const [pendingCheckout, setPendingCheckout] = useState<{
    enrollments: { enrollmentId: string; studentFirst: string }[]
  } | null>(null)
  // PL-125: per-student add-on picks for sibling carts.
  const [addonPicks, setAddonPicks] = useState<Record<string, string | null>>({})
  // PL-364: physical add-on quantities + the shipping address they require.
  const [productQty, setProductQty] = useState<Record<string, number>>({})
  const [ship, setShip] = useState({ name: '', address1: '', address2: '', city: '', state: '', zip: '', country: 'US' })

  useEffect(() => {
    async function fetchClass() {
      try {
        // PL-279: the fo/fe params ride along so the server can validate the
        // auto-apply discount for this visitor's own cohort.
        const q = new URLSearchParams(window.location.search)
        const fo = q.get('fo')
        const fe = q.get('fe')
        const suffix = fo && fe ? `?fo=${encodeURIComponent(fo)}&fe=${encodeURIComponent(fe)}` : ''
        const response = await fetch(`/api/class-info/${idOrSlug}${suffix}`)
        if (!response.ok) {
          setNotFound(true)
          return
        }
        const data: ClassDetails = await response.json().catch(() => ({}))
        setClassDetails(data)
        setIsFull(data.isFull)
        setPackages(data.packages ?? [])
      } catch {
        setNotFound(true)
      }
    }
    if (idOrSlug) fetchClass()
  }, [idOrSlug])

  // -------------------------------------------------------------------------
  // Normal registration → Stripe checkout
  // -------------------------------------------------------------------------
  async function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('Saving family details...')
    const formData = new FormData(e.currentTarget)

    // Family + students + Pending enrollments are created server-side —
    // the browser has no database access (Phase 3 RLS). PL-125: one POST
    // covers every sibling; the parent block is shared.
    let enrollmentIds: string[]
    const studentsPayload = Array.from({ length: siblingCount }).map((_, i) => ({
      studentFirst: formData.get(`studentFirst_${i}`),
      studentLast: formData.get(`studentLast_${i}`),
      studentEmail: formData.get(`studentEmail_${i}`),
      pronouns: formData.get(`pronouns_${i}`),
      graduatingYear: formData.get(`graduatingYear_${i}`),
      accommodations: formData.get(`accommodations_${i}`),
      previousScores: formData.get(`previousScores_${i}`),
      notes: formData.get(`notes_${i}`),
    }))
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: classDetails!.id,
          parentFirst: formData.get('parentFirst'),
          parentLast: formData.get('parentLast'),
          parentEmail: formData.get('parentEmail'),
          students: studentsPayload,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.full) {
          // Someone took the last spot while the form was open.
          setIsFull(true)
          setMessage('Error: this class just filled up — you can join the waitlist below.')
        } else {
          setMessage('Error: ' + (data.error ?? 'registration failed'))
        }
        setLoading(false)
        return
      }
      enrollmentIds = data.enrollmentIds ?? [data.enrollmentId]
    } catch {
      setMessage('Error: failed to save your registration.')
      setLoading(false)
      return
    }

    // Add-on step: offer pre-class tutoring packages before checkout
    // (only available at registration). If none exist, go straight to Stripe.
    if (packages.length > 0 || (classDetails?.products?.length ?? 0) > 0) {
      setPendingCheckout({
        enrollments: enrollmentIds.map((id, i) => ({
          enrollmentId: id,
          studentFirst: String(studentsPayload[i]?.studentFirst ?? '').trim() || `Student ${i + 1}`,
        })),
      })
      setAddonPicks({})
      setMessage('')
      setLoading(false)
    } else {
      await proceedToCheckout(enrollmentIds, {})
    }
  }

  // Stripe handoff — pass enrollment id so the webhook can mark exactly this
  // row paid; packageId adds the tutoring add-on as a second line item.
  // Price, product name, and billing email all come from the DB server-side.
  async function proceedToCheckout(
    enrollmentIds: string[],
    packageSelections: Record<string, string | null>
  ) {
    // PL-364: a physical add-on needs somewhere to ship — enforced here so
    // the button says why, and re-checked server-side.
    const productPicks = Object.entries(productQty)
      .filter(([, q]) => q > 0)
      .map(([productId, quantity]) => ({ productId, quantity }))
    if (productPicks.length > 0 && (!ship.name.trim() || !ship.address1.trim() || !ship.city.trim() || !ship.country)) {
      setMessage('Please fill in the shipping address for the notebook order (name, street, city, country) — or set the quantity back to 0.')
      return
    }
    setLoading(true)
    setMessage('Redirecting to secure checkout...')
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(enrollmentIds.length === 1
            ? { enrollmentId: enrollmentIds[0], packageId: packageSelections[enrollmentIds[0]] ?? null }
            : { enrollmentIds, packageSelections }),
          ...(productPicks.length > 0 ? { products: productPicks, shipping: ship } : {}),
          // PL-279: the discount rides to checkout and is re-validated
          // server-side (token path preferred; typed code as fallback).
          ...(classDetails?.followOnDiscount && foParams
            ? { foToken: foParams.fo, foEnrollmentId: foParams.fe }
            : typedCode.trim()
              ? { discountCode: typedCode.trim() }
              : {}),
        }),
      })

      const data = await response.json().catch(() => ({}))

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
          pronouns: formData.get('pronouns'),
          graduatingYear: formData.get('graduatingYear'),
          accommodations: formData.get('accommodations'),
          previousScores: formData.get('previousScores'),
          notes: formData.get('notes'),
        }),
      })
      const data = await response.json().catch(() => ({}))
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

  if (notFound) return <ClassNotFound />

  if (!classDetails) return <div className="p-10 text-center">Loading class details...</div>

  const sessions = [...(classDetails.sessions ?? [])].sort(bySessionStart)
  const firstSession = sessions[0]?.session_date ?? classDetails.start_date
  const classTime = classTimeOf(sessions)
  const schoolLabel = classDetails.schools?.nickname ?? 'HGL'
  const classLabel = `${schoolLabel} ${classDetails.class_type}`
  const today = new Date().toLocaleDateString('en-CA')

  // Cancelled class: reads as "full", no waitlist form, link to the main
  // site — deliberately not a cancellation notice (PHASE4_SPEC §12).
  if (classDetails.cancelled) {
    return (
      <PublicNoticeCard title="This class is full">
        The {classLabel} class is not accepting new registrations. Upcoming classes are listed
        on our main site.
        {/* PL-54b: demand capture — hear first when the next one opens */}
        <InterestCapture classId={classDetails.id} schoolNickname={schoolLabel} classType={classDetails.class_type} />
      </PublicNoticeCard>
    )
  }

  // Registration closes after the first session by default;
  // registration_close_date overrides per class (e.g. allow joining
  // through session 3).
  const registrationClose = classDetails.registration_close_date ?? firstSession
  if (today > registrationClose) {
    return (
      <PublicNoticeCard title="Registration for this class has closed">
        Registration for the {classLabel} class is no longer open. Upcoming classes are listed
        on our main site.
        {/* PL-54b: demand capture — hear first when the next one opens */}
        <InterestCapture classId={classDetails.id} schoolNickname={schoolLabel} classType={classDetails.class_type} />
      </PublicNoticeCard>
    )
  }

  // Visual session calendar rendered from the sessions table — replaces the
  // old workflow of pasting Google Sheets calendar screenshots into
  // Squarespace pages. Shared with the Phase 4 portal views.
  const sessionCalendar =
    sessions.length > 0 ? (
      <SessionCalendar
        sessions={sessions}
        defaultLocation={classDetails.default_location}
        calendarHref={`/classes/${classDetails.id}/calendar`}
        timezone={classDetails.timezone ?? classDetails.schools?.timezone ?? null}
        cityLabel={publicTimeCityLabel({
          schoolCity: classDetails.schools?.city,
          displayCities: classDetails.display_cities,
          location: classDetails.default_location,
          timezone: classDetails.timezone ?? classDetails.schools?.timezone ?? 'UTC',
          hglInPerson: !classDetails.schools && classDetails.delivery_mode !== 'online',
        })}
      />
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
        {classDetails.followOnDiscount ? (
          <span className="font-semibold">
            <s className="text-gray-400 font-normal">${classDetails.price}</s> $
            {Math.max(0, classDetails.price - classDetails.followOnDiscount.amount)} per student
          </span>
        ) : (
          <span className="font-semibold">${classDetails.price} per student</span>
        )}
      </p>
      {/* PL-279: the emailed link's cohort discount — applied automatically. */}
      {classDetails.followOnDiscount && (
        <p className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-md px-3 py-2 mb-3">
          Your <span className="font-bold">{classDetails.followOnDiscount.code}</span> discount ($
          {classDetails.followOnDiscount.amount.toFixed(0)} off per student) is applied
          automatically — good through {classDetails.followOnDiscount.endDate}.
        </p>
      )}
      {classDetails.followOnDiscountNote && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2 mb-3">
          {classDetails.followOnDiscountNote}
        </p>
      )}
      {/* PL-293: the class-page pointer — full course details live on the
          marketing site; registration stays here. */}
      {classDetails.page_path && (
        <p className="text-sm mb-3">
          <a href={classDetails.page_path} className="text-hgl-blue underline font-semibold">
            More info about the class →
          </a>
        </p>
      )}
      {sessionCalendar}
    </div>
  )

  // Add-on step between the registration form and Stripe checkout.
  if (pendingCheckout) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
          <h1 className="text-2xl font-bold text-hgl-slate mb-4">Add 1-on-1 tutoring?</h1>
          {/* PL-357: the upsell copy renders FROM the flow-only content
              block (ONE source — Settings → Class pages edits reach here).
              The old hardcoded paragraphs were deleted only after verifying
              the block renders text-identical copy. Absent block = no pitch
              paragraphs; the heading and package buttons carry the flow. */}
          {classDetails.upsellPitchMarkdown && (
            <div
              className="text-gray-700 space-y-4 mb-6 [&_p]:text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(classDetails.upsellPitchMarkdown) }}
            />
          )}
          {/* PL-364: physical add-ons (the notebooks) — names and composed
              sale pricing straight from the products table; a quantity > 0
              opens the shipping address (required, coverage from Printful's
              own country list). Class-registration add-ons only. */}
          {(classDetails.products?.length ?? 0) > 0 && (
            <div className="mb-6 border border-gray-200 rounded-lg p-4">
              <h2 className="text-sm font-bold text-hgl-slate mb-2">Add a notebook?</h2>
              <div className="space-y-2">
                {classDetails.products!.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-700">
                      {p.name} — <span className="font-semibold">{p.priceLabel}</span>
                    </span>
                    <select
                      value={productQty[p.id] ?? 0}
                      onChange={(e) =>
                        setProductQty((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))
                      }
                      className="border border-gray-300 rounded p-1.5 bg-white"
                      aria-label={`Quantity for ${p.name}`}
                    >
                      {[0, 1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? 'None' : n}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {Object.values(productQty).some((q) => q > 0) && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-600">
                    Where should we ship it? (Printful prints and ships it to you directly.)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={ship.name} onChange={(e) => setShip((s) => ({ ...s, name: e.target.value }))} placeholder="Full name *" className="border border-gray-300 rounded p-2 text-sm col-span-2" />
                    <input value={ship.address1} onChange={(e) => setShip((s) => ({ ...s, address1: e.target.value }))} placeholder="Street address *" className="border border-gray-300 rounded p-2 text-sm col-span-2" />
                    <input value={ship.address2} onChange={(e) => setShip((s) => ({ ...s, address2: e.target.value }))} placeholder="Apt / unit" className="border border-gray-300 rounded p-2 text-sm" />
                    <input value={ship.city} onChange={(e) => setShip((s) => ({ ...s, city: e.target.value }))} placeholder="City *" className="border border-gray-300 rounded p-2 text-sm" />
                    <input value={ship.state} onChange={(e) => setShip((s) => ({ ...s, state: e.target.value }))} placeholder="State / region" className="border border-gray-300 rounded p-2 text-sm" />
                    <input value={ship.zip} onChange={(e) => setShip((s) => ({ ...s, zip: e.target.value }))} placeholder="Postal code" className="border border-gray-300 rounded p-2 text-sm" />
                    <select value={ship.country} onChange={(e) => setShip((s) => ({ ...s, country: e.target.value }))} className="border border-gray-300 rounded p-2 text-sm bg-white col-span-2" aria-label="Country">
                      {(classDetails.shipCountries ?? []).map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-gray-400">
                    The country list is exactly where our print partner ships — if yours isn&apos;t
                    there, we can&apos;t get the notebook to you yet (registration itself is
                    unaffected).
                  </p>
                </div>
              )}
            </div>
          )}
          {pendingCheckout.enrollments.length === 1 ? (
            <>
              <div className="space-y-3 mb-6">
                {packages.map((p) => (
                  <button
                    key={p.id}
                    disabled={loading}
                    onClick={() =>
                      proceedToCheckout(
                        [pendingCheckout.enrollments[0].enrollmentId],
                        { [pendingCheckout.enrollments[0].enrollmentId]: p.id }
                      )
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
                onClick={() => proceedToCheckout([pendingCheckout.enrollments[0].enrollmentId], {})}
                className="w-full bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-60"
              >
                {loading
                  ? 'Preparing secure checkout...'
                  : Object.values(productQty).some((q) => q > 0)
                    ? 'Continue to payment'
                    : packages.length > 0
                      ? 'No thanks, just the class'
                      : 'Continue to payment'}
              </button>
            </>
          ) : (
            /* PL-125: siblings — one pick per student, one payment. */
            <>
              <div className="space-y-4 mb-6">
                {pendingCheckout.enrollments.map((en) => (
                  <div key={en.enrollmentId}>
                    <label className="block text-sm font-semibold text-hgl-slate mb-1">
                      1-on-1 hours for {en.studentFirst}
                    </label>
                    <select
                      value={addonPicks[en.enrollmentId] ?? ''}
                      onChange={(e) =>
                        setAddonPicks((prev) => ({
                          ...prev,
                          [en.enrollmentId]: e.target.value || null,
                        }))
                      }
                      className="w-full border border-gray-300 rounded p-2 bg-white"
                    >
                      <option value="">No 1-on-1 hours</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {hoursWord(p.hours)} hours @ ${p.hourly_rate}/hr — ${p.package_price.toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <button
                disabled={loading}
                onClick={() =>
                  proceedToCheckout(
                    pendingCheckout.enrollments.map((en) => en.enrollmentId),
                    addonPicks
                  )
                }
                className="w-full bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-60"
              >
                {loading ? 'Preparing secure checkout...' : 'Continue to payment (one checkout for everyone)'}
              </button>
            </>
          )}
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
            You&apos;re <strong>#{waitlistPosition}</strong>{' '}in line for {classLabel}.
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
        {cameFromExpiredLink && (
          <p className="mb-4 text-sm bg-blue-50 text-hgl-slate rounded p-3">
            That registration link had expired, so the spot it was holding went back into the
            pool — no payment was ever taken. No worries: you can register again right here
            while spots remain, and if anything looks off, just reply to any of our emails and
            a real human will sort it out.
          </p>
        )}
        {classHeader}
        {isFull && (
          <>
            <p className="mb-2 text-sm bg-yellow-50 text-yellow-800 rounded p-3">
              This class is currently full. Join the waitlist (no payment now) and we&apos;ll email
              you a payment link if a spot opens — first come, first served.
            </p>
            {/* PL-54b: the lighter option — hear about the NEXT course instead */}
            <div className="mb-6 border border-gray-200 rounded-md p-3">
              <p className="text-xs text-gray-500 mb-1">
                Not in a rush? Skip the waitlist and just hear about the next course:
              </p>
              <InterestCapture
                classId={classDetails.id}
                schoolNickname={schoolLabel}
                classType={classDetails.class_type}
              />
            </div>
          </>
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

          {/* Students — PL-125: siblings repeat this block; the parent
              block above is shared and never re-typed. */}
          {Array.from({ length: siblingCount }).map((_, i) => (
            <div key={i} className="bg-gray-50 p-4 rounded-md border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-hgl-slate">
                  {siblingCount > 1 ? `Student ${i + 1}` : 'Student Information'}
                </h3>
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSiblingCount((n) => n - 1)
                      setStudentFirstTyped((prev) => prev.filter((_, j) => j !== i))
                    }}
                    className="text-xs text-gray-500 underline"
                  >
                    remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600">First Name</label>
                  <input type="text" name={`studentFirst_${i}`} required onChange={(e) => setStudentFirstTyped((prev) => { const next = [...prev]; next[i] = e.target.value; return next })} className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600">Last Name</label>
                  <input type="text" name={`studentLast_${i}`} required className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-600">
                    Student Email <span className="text-gray-500">(for class reminders & Synap access)</span>
                  </label>
                  <input type="email" name={`studentEmail_${i}`} className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
                </div>
                <div className="col-span-2">
                  {/* PL-69: optional, no explanatory text — unset simply keeps
                      the neutral wording in emails. */}
                  <label className="block text-sm text-gray-600">
                    {(studentFirstTyped[i] ?? '').trim() ? `${(studentFirstTyped[i] ?? '').trim()}'s pronouns` : "Student's pronouns"}{' '}
                    <span className="text-gray-500">(optional)</span>
                  </label>
                  <select
                    name={`pronouns_${i}`}
                    defaultValue=""
                    className="mt-1 w-full border border-gray-300 rounded p-2 bg-white focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
                  >
                    <option value=""></option>
                    <option value="she_her">she/her</option>
                    <option value="he_him">he/him</option>
                    <option value="they_them">they/them</option>
                    {/* PL-80: renders the student's name where a pronoun
                        would go — never a wrong pronoun. */}
                    <option value="name_only">Something else / rather not say</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-600">
                    Graduating Year <span className="text-gray-500">(optional)</span>
                  </label>
                  <input type="text" name={`graduatingYear_${i}`} placeholder="e.g. 2027" className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-600">
                    Testing accommodations <span className="text-gray-500">(optional)</span>
                  </label>
                  <input type="text" name={`accommodations_${i}`} placeholder="e.g. extended time" className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-600">
                    Previous test scores <span className="text-gray-500">(optional)</span>
                  </label>
                  <input type="text" name={`previousScores_${i}`} placeholder="e.g. PSAT 1150" className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-600">
                    Anything else we should know? <span className="text-gray-500">(optional)</span>
                  </label>
                  <textarea name={`notes_${i}`} rows={2} className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
                </div>
              </div>
            </div>
          ))}

          {/* PL-125: the sibling path — same parent block, one payment. */}
          {!isFull && siblingCount < 6 && (
            <button
              type="button"
              onClick={() => {
                setSiblingCount((n) => n + 1)
                setStudentFirstTyped((prev) => [...prev, ''])
              }}
              className="w-full border-2 border-dashed border-gray-300 text-gray-600 font-semibold py-2.5 px-4 rounded-md hover:border-hgl-blue hover:text-hgl-blue transition"
            >
              + Add another student (same parent info, one payment)
            </button>
          )}

          {/* PL-279: typed-code fallback — checked server-side at checkout
              (the emailed link applies it automatically instead). */}
          {!isFull && classDetails.promoAvailable && !classDetails.followOnDiscount && (
            <div>
              <label className="block text-sm text-gray-600">
                Discount code <span className="text-gray-500">(optional — from our email)</span>
              </label>
              <input
                type="text"
                value={typedCode}
                onChange={(e) => setTypedCode(e.target.value)}
                placeholder="e.g. DEEPDIVE50"
                className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition uppercase"
              />
              <p className="text-xs text-gray-500 mt-1">
                We&apos;ll check it when you continue to payment — if it doesn&apos;t apply,
                you&apos;ll see why before anything is charged.
              </p>
            </div>
          )}

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
                : `Proceed to payment ($${(
                    Math.max(
                      0,
                      classDetails.price - (classDetails.followOnDiscount?.amount ?? 0)
                    ) * siblingCount
                  ).toLocaleString()}${siblingCount > 1 ? ` — ${siblingCount} students` : ''})`}
          </button>

          {/* PL-124: one calm sentence on what follows payment — standing
              copy rule: "in the days before class starts", never a day count. */}
          {!isFull && (
            <p className="mt-3 text-sm text-gray-500 text-center">
              After payment you&apos;ll get a confirmation email right away, and class details
              arrive in the days before the first session.
            </p>
          )}
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
