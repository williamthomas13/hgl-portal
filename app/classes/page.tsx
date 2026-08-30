import type { Metadata } from 'next'
import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import { publicTimeCityLabel, formatDateFull, bySessionStart, effectiveStartDate } from '../utils/dates'
import { preferredClassPath } from '../utils/evergreen'
import { DEFAULT_TIMEZONE } from '../utils/lifecycle'
import { imageAttrs } from '../utils/class-page-images'
import { publicSkin, PAGE_HERO } from '../components/public-skin'
import { CONSULT_HREF } from '../components/ClassStateCard'

// PL-378 A: the public /classes browse page — the portal-rendered
// replacement for the Squarespace classes grid (its nav repoints here at
// cutover). Every OPEN, registerable class from the DB: school classes with
// their school's logo, no-school classes with the HGL logo (PL-375
// consistency), city filtering like the sqsp page, and capacity states
// COMPOSED from the record ("Class full" / "Only N spots left") with the
// same spots-taken computation the /c pages use — never hand-typed. Cards
// link to the class's permanent code URL when one resolves (PL-384), else
// /c/{slug}. Wizard drafts (PL-370) have no classes rows, so they
// can never appear here. A modest past-classes list mirrors the sqsp page.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Classes — Higher Ground Learning',
  description:
    'Upcoming SAT, ACT, and PSAT classes from Higher Ground Learning — at partner schools around the world and live online.',
  openGraph: {
    title: 'Classes — Higher Ground Learning',
    description:
      'Upcoming SAT, ACT, and PSAT classes from Higher Ground Learning — at partner schools around the world and live online.',
    siteName: 'Higher Ground Learning',
  },
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

type Slot = { payment_status: string; waitlist_offer_expires_at: string | null }
function spotsTakenRaw(slots: Slot[]): number {
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

export default async function ClassesBrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const cityFilter = typeof sp.city === 'string' ? sp.city : null

  const { data } = await supabase
    .from('classes')
    .select(
      `id, slug, class_type, status, price, capacity, delivery_mode, default_location, timezone,
       display_cities, registration_close_date, start_date, course_key, school_id,
       schools ( name, nickname, city, timezone, logo_url ),
       sessions ( session_date, start_time, end_time ),
       enrollments ( payment_status, waitlist_offer_expires_at )`
    )
    .eq('status', 'open')
    .not('slug', 'is', null)
  const rows = ((data as any[]) ?? []).map((c) => {
    const school = one<any>(c.schools)
    const timezone = c.timezone ?? school?.timezone ?? DEFAULT_TIMEZONE
    const sessions = [...(c.sessions ?? [])].sort(bySessionStart)
    const firstSession = effectiveStartDate(c.start_date, sessions)
    const lastSession = sessions[sessions.length - 1]?.session_date ?? c.start_date
    const close = String(c.registration_close_date ?? firstSession ?? '').slice(0, 10)
    const todayInZone = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    const city = publicTimeCityLabel({
      schoolCity: school?.city,
      displayCities: c.display_cities,
      location: c.default_location,
      timezone,
      hglInPerson: !school && c.delivery_mode !== 'online',
    })
    const taken = spotsTakenRaw((c.enrollments as Slot[]) ?? [])
    const seatsLeft = c.capacity != null ? Math.max(0, Number(c.capacity) - taken) : null
    return {
      id: c.id,
      slug: c.slug,
      schoolId: c.school_id ?? null,
      courseKey: c.course_key ?? null,
      label: school ? `${school.name} ${c.class_type} Class` : String(c.class_type),
      school,
      online: c.delivery_mode === 'online',
      city,
      firstSession,
      registerable: Boolean(close) && todayInZone <= close,
      past: todayInZone > String(lastSession ?? '').slice(0, 10),
      full: seatsLeft != null && seatsLeft <= 0,
      seatsLeft,
    }
  })
  // PL-384: cards link to the PERMANENT code URL when the class's
  // school/course code currently resolves to it; /c/{slug} only for the rest.
  const rowsWithHrefs = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      pageHref: await preferredClassPath({ id: r.id, slug: r.slug, school_id: r.schoolId, course_key: r.courseKey }),
    }))
  )

  const upcoming = rowsWithHrefs
    .filter((c) => c.registerable && !c.past)
    .sort((a, b) => String(a.firstSession).localeCompare(String(b.firstSession)))
  const past = rowsWithHrefs
    .filter((c) => c.past || !c.registerable)
    .sort((a, b) => String(b.firstSession).localeCompare(String(a.firstSession)))
    .slice(0, 6)

  const cities = [...new Set(upcoming.map((c) => c.city).filter(Boolean))].sort()
  const visible = cityFilter ? upcoming.filter((c) => c.city === cityFilter) : upcoming

  return (
    <div className={`min-h-screen bg-gray-50 ${publicSkin}`}>
      {/* the PL-374 skin: brand hero + scrim */}
      <section className="relative overflow-hidden bg-hgl-slate">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          {...imageAttrs(PAGE_HERO)}
          sizes="100vw"
          className="absolute inset-0 h-full w-full object-cover"
          decoding="async"
        />
        <div aria-hidden className="absolute inset-0 bg-hgl-slate/80" />
        <div className="relative max-w-4xl mx-auto px-5 py-10 sm:py-14 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/collateral/hgl-logo-white.png" alt="Higher Ground Learning logo" className="h-14 w-auto mb-4" />
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">Classes</h1>
          <p className="mt-2 text-white/90">
            Live test-prep classes — at partner schools around the world and online.
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-5 py-10">
        {cities.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-6" aria-label="Filter classes by city">
            <a
              href="/classes"
              className={`px-3 py-1 rounded-full text-sm font-semibold border ${!cityFilter ? 'bg-hgl-slate text-white border-hgl-slate' : 'bg-white text-gray-600 border-gray-300 hover:border-hgl-blue'}`}
            >
              Everywhere
            </a>
            {cities.map((city) => (
              <a
                key={city}
                href={`/classes?city=${encodeURIComponent(city)}`}
                className={`px-3 py-1 rounded-full text-sm font-semibold border ${cityFilter === city ? 'bg-hgl-slate text-white border-hgl-slate' : 'bg-white text-gray-600 border-gray-300 hover:border-hgl-blue'}`}
              >
                {city}
              </a>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-gray-600 italic">
            No classes are open for registration{cityFilter ? ` in ${cityFilter}` : ''} right now —
            check back soon, or{' '}
            <a href={CONSULT_HREF} className="text-hgl-blue underline">
              talk to us
            </a>{' '}
            about 1-on-1 tutoring.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {visible.map((c) => (
              <a
                key={c.id}
                href={c.pageHref}
                className="bg-white rounded-lg shadow-sm p-5 flex flex-col gap-3 border border-transparent hover:border-hgl-blue transition"
              >
                <div className="flex items-center gap-3">
                  {c.school?.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.school.logo_url} alt={`${c.school.name} logo`} className="h-12 w-auto" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/collateral/hgl-logo-color.png" alt="Higher Ground Learning logo" className="h-12 w-auto" />
                  )}
                </div>
                <div>
                  <h2 className="font-bold text-hgl-slate leading-snug">{c.label}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {c.online ? 'Live online' : 'In person'}
                    {c.city ? ` · ${c.city}` : ''} · starts {formatDateFull(String(c.firstSession))}
                  </p>
                </div>
                <p className="text-sm mt-auto">
                  {c.full ? (
                    <span className="font-bold text-red-600">Class full — waitlist open</span>
                  ) : c.seatsLeft != null && c.seatsLeft <= 5 ? (
                    <span className="font-bold text-amber-700">
                      Only {c.seatsLeft} spot{c.seatsLeft === 1 ? '' : 's'} left
                    </span>
                  ) : (
                    <span className="font-semibold text-hgl-blue">Open for registration →</span>
                  )}
                </p>
              </a>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <div className="mt-12">
            <h2 className="text-lg font-bold text-hgl-slate mb-3">Recent classes</h2>
            <ul className="space-y-1 text-sm text-gray-500">
              {past.map((c) => (
                <li key={c.id}>
                  {c.label}
                  {c.city ? ` — ${c.city}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-12 text-center">
          <a
            href={CONSULT_HREF}
            className="inline-block bg-hgl-blue text-white font-bold py-3 px-8 rounded-md hover:opacity-90 transition"
          >
            Not sure which class fits? Talk to us
          </a>
        </div>
      </div>
    </div>
  )
}
