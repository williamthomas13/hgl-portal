import type { Metadata } from 'next'
import { cache } from 'react'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { usableAccent } from '../../utils/collateral'
import {
  bySessionStart,
  effectiveStartDate,
  formatDateFull,
  formatDateOnly,
  formatTimeRange,
  publicTimeCityLabel,
  timeRangeLabel,
} from '../../utils/dates'
import { zonedToUtc } from '../../utils/tutoring'
import { DEFAULT_TIMEZONE } from '../../utils/lifecycle'
import { parseFaqItems, plainTextFromMarkdown, renderSiteMarkdown } from '../../utils/site-md'
import { emailBaseUrl } from '../../utils/base-url'
import { examFamilyFor, SCHOOL_BASED_REG_TEXT } from '../../utils/exam-family'
import { ClassStateCard, CONSULT_HREF } from '../../components/ClassStateCard'
import ClassPageAnalytics from './analytics'
import { imageAttrs, parseClassPageImage, type ClassPageImage } from '../../utils/class-page-images'

// PL-348: the public class page — the portal-hosted replacement for the
// per-class Squarespace pages (Option A). Top half is CLASS-SPECIFIC and
// LIVE from the class record (hero + bullets, the real session schedule,
// price and deadline — marketing facts render from the record, never from
// authored copy); bottom half is the EVERGREEN persuasion content from
// site_content_blocks (edit once under Settings → Class pages, every class
// page updates). No auth, no tokens; printed collateral must never land on
// a 404, so every state resolves to an honest page. Mobile-first — most
// parents arrive from email/WhatsApp.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

// PL-367: the admin's "no class exists for this set yet" preview renders the
// REAL page component against a clearly-labeled synthetic class (never a DB
// row). The slug pattern carries the course key so course-scoped blocks
// inherit exactly as they would on a real class.
const SAMPLE_SLUG_RE = /^sample--([a-z0-9-]{2,64})$/

function sampleClass(courseKey: string) {
  // Next four Saturdays starting ~3 weeks out, 10:00–12:00 — plausible,
  // obviously-labeled layout props. Every fact here is synthetic.
  const first = new Date()
  first.setDate(first.getDate() + 21 + ((6 - first.getDay() + 7) % 7))
  const sessions = [0, 1, 2, 3].map((week) => {
    const d = new Date(first)
    d.setDate(d.getDate() + week * 7)
    return {
      id: `sample-session-${week}`,
      session_date: d.toISOString().slice(0, 10),
      start_time: '10:00',
      end_time: '12:00',
      location: null,
    }
  })
  const label = courseKey
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
  return {
    id: 'sample-preview',
    slug: `sample--${courseKey}`,
    class_type: `${label} (sample)`,
    course_key: courseKey,
    schools: null,
    school_id: null,
    sessions,
    start_date: sessions[0].session_date,
    registration_close_date: sessions[0].session_date,
    enrollment_deadline: sessions[0].session_date,
    status: 'open',
    price: 999,
    capacity: 15,
    min_enrollment: null,
    delivery_mode: 'in_person',
    default_location: 'Room 204',
    timezone: DEFAULT_TIMEZONE,
    display_cities: null,
    selling_bullets: null,
    hero_image: null,
    prerequisite_note: null,
    promo_code: null,
    is_follow_on: false,
    has_diagnostics: false,
  }
}

const loadPage = cache(async (slug: string) => {
  const sampleMatch = SAMPLE_SLUG_RE.exec(slug)
  if (sampleMatch) {
    // Blocks load exactly like a real page (shared + this course key's set);
    // everything class-shaped is synthetic and the page banners it.
    let blocks: any[] = []
    try {
      const { data } = await supabase
        .from('site_content_blocks')
        .select('key, section, heading, body_markdown, sort_order, image, scope, course_key, class_id')
        .order('sort_order')
      blocks = (data as any[]) ?? []
    } catch {
      blocks = []
    }
    let featuredInstructors: any[] = []
    try {
      const { data } = await supabase
        .from('instructors')
        .select('id, name, public_name, credential, headshot, team_order')
        .eq('featured_on_classes', true)
        .order('team_order', { ascending: true, nullsFirst: false })
        .order('name')
      featuredInstructors = ((data as any[]) ?? []).map((p) => ({
        ...p,
        name: (typeof p.public_name === 'string' && p.public_name.trim()) || p.name,
      }))
    } catch {
      featuredInstructors = []
    }
    return {
      cls: sampleClass(sampleMatch[1]) as any,
      spotsTaken: 3,
      blocks,
      feeders: [] as any[],
      siblings: [] as any[],
      featuredInstructors,
    }
  }

  // '*' on purpose: the page keeps rendering even before the
  // selling_bullets migration lands (the column just won't be there).
  const { data: cls } = await supabase
    .from('classes')
    .select('*, schools ( name, nickname, timezone, city, logo_url, accent_color ), sessions ( id, session_date, start_time, end_time, location )')
    .eq('slug', slug)
    .maybeSingle()

  let spotsTaken = 0
  if (cls) {
    const { data: enr } = await supabase
      .from('enrollments')
      .select('payment_status, waitlist_offer_expires_at')
      .eq('class_id', cls.id)
    const now = Date.now()
    spotsTaken = ((enr as any[]) ?? []).filter(
      (e) =>
        e.payment_status === 'Pending' ||
        e.payment_status === 'Paid' ||
        (e.payment_status === 'Waitlisted' &&
          e.waitlist_offer_expires_at != null &&
          new Date(e.waitlist_offer_expires_at).getTime() > now)
    ).length
  }

  // The evergreen blocks — tolerate the table not existing yet (the page
  // ships dark; until the migration is applied the class top renders alone).
  let blocks: any[] = []
  try {
    const { data } = await supabase
      .from('site_content_blocks')
      .select('key, section, heading, body_markdown, sort_order, image, scope, course_key, class_id')
      .order('section')
      .order('sort_order')
    blocks = (data as any[]) ?? []
  } catch {
    blocks = []
  }

  // PL-355 B: a follow-up class's feeder classes (feeder.follow_on_class_id
  // points here) — their schools' city+timezone drive the multi-city times.
  let feeders: any[] = []
  if (cls?.is_follow_on) {
    const { data } = await supabase
      .from('classes')
      .select('id, schools ( nickname, city, timezone )')
      .eq('follow_on_class_id', cls.id)
    feeders = (data as any[]) ?? []
  }

  // PL-355 C: sibling sections = other LIVE classes sharing the course key
  // (sections are separate classes — no section object).
  let siblings: any[] = []
  if (cls?.course_key) {
    const { data } = await supabase
      .from('classes')
      .select(
        'id, slug, class_type, status, timezone, default_location, display_cities, registration_close_date, start_date, schools ( city, timezone ), sessions ( session_date, start_time, end_time )'
      )
      .eq('course_key', cls.course_key)
      .neq('id', cls.id)
      .eq('status', 'open')
    siblings = (data as any[]) ?? []
  }
  // PL-358: the instructors section's cards render from instructor PROFILES
  // (one source — the same rows /team renders), never hand-written copy.
  let featuredInstructors: any[] = []
  try {
    const { data } = await supabase
      .from('instructors')
      .select('id, name, public_name, credential, headshot, team_order')
      .eq('featured_on_classes', true)
      .order('team_order', { ascending: true, nullsFirst: false })
      .order('name')
    // PL-365: public surfaces render public_name when set (internal row
    // name stays authoritative for timecards/QBO).
    featuredInstructors = ((data as any[]) ?? []).map((p) => ({
      ...p,
      name: (typeof p.public_name === 'string' && p.public_name.trim()) || p.name,
    }))
  } catch {
    featuredInstructors = []
  }
  return { cls: cls as any, spotsTaken, blocks, feeders, siblings, featuredInstructors }
})

function heroTitleFor(cls: any): string {
  const school = one<any>(cls.schools)
  return school ? `${school.name} ${cls.class_type} Class` : String(cls.class_type)
}

/** Calendar-date "days away" for the countdown — both sides are plain dates. */
function daysUntil(dateIso: string, timezone: string): number {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const ms = Date.parse(`${dateIso.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** PL-351: a block/hero image — responsive srcset from the pre-generated
 *  variants, explicit dimensions so text never reflows, lazy below the fold.
 *  A missing or malformed descriptor renders NOTHING (clean text block). */
function BlockImg({
  image,
  sizes,
  eager = false,
  className = '',
}: {
  image: ClassPageImage | null
  sizes: string
  eager?: boolean
  className?: string
}) {
  if (!image) return null
  const attrs = imageAttrs(image)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...attrs}
      sizes={sizes}
      loading={eager ? undefined : 'lazy'}
      decoding="async"
      className={`w-full h-auto ${className}`}
    />
  )
}

/** "16:00[:00]" wall-clock → "4:00 PM". */
function clockLabel(t: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '')
  if (!m) return null
  const h = Number(m[1])
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  // PL-367: synthetic sample previews are never index-worthy.
  if (SAMPLE_SLUG_RE.test(slug)) {
    return { title: 'Sample class page — Higher Ground Learning', robots: { index: false } }
  }
  const { cls } = await loadPage(slug)
  if (!cls) return { title: 'Classes — Higher Ground Learning', robots: { index: false } }
  // PL-359 B/E: only LIVE pages are index-worthy; cancelled/closed states
  // carry noindex (they're honest dead-ends, not content).
  const sessions = ([...(cls.sessions ?? [])] as any[]).sort(bySessionStart)
  const firstSession = effectiveStartDate(cls.start_date, sessions)
  const close = String(cls.registration_close_date ?? firstSession ?? '').slice(0, 10)
  const timezone = cls.timezone ?? one<any>(cls.schools)?.timezone ?? DEFAULT_TIMEZONE
  const todayInZone = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const dead = cls.status === 'cancelled' || !close || todayInZone > close
  const title = `${heroTitleFor(cls)} — Higher Ground Learning`
  const bullets = String(cls.selling_bullets ?? '')
    .split('\n')
    .map((b: string) => b.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
  const description =
    bullets.length > 0
      ? bullets.join(' · ').slice(0, 300)
      : `Live ${cls.class_type} class from Higher Ground Learning — schedule, what's included, and registration.`
  const heroImage = parseClassPageImage(cls.hero_image)
  const ogImage = heroImage
    ? imageAttrs(heroImage).src
    : one<any>(cls.schools)?.logo_url ?? undefined
  return {
    title,
    description,
    ...(dead ? { robots: { index: false } } : {}),
    openGraph: {
      title,
      description,
      url: `${emailBaseUrl()}/c/${cls.slug}`,
      siteName: 'Higher Ground Learning',
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
  }
}

export default async function PublicClassPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { cls, spotsTaken, blocks, feeders, siblings, featuredInstructors } = await loadPage(slug)
  // PL-367: sample mode — the REAL renderer over synthetic class facts,
  // clearly bannered; registration and analytics/JSON-LD are disabled.
  const isSample = SAMPLE_SLUG_RE.test(slug)

  const block = (key: string) => blocks.find((b) => b.key === key) ?? null
  const stateBody = (key: string, fallback: string) => block(key)?.body_markdown ?? fallback

  if (!cls) {
    return (
      <ClassStateCard
        title={block('no-active-class')?.heading || 'No active class right now'}
        body={stateBody(
          'no-active-class',
          "There's no class open for registration at this link right now. Talk to us directly and we'll point you toward the right prep option for your student."
        )}
      />
    )
  }

  const school = one<any>(cls.schools)
  const timezone = cls.timezone ?? school?.timezone ?? DEFAULT_TIMEZONE
  const sessions = ([...(cls.sessions ?? [])] as any[]).sort(bySessionStart)
  const firstSession = effectiveStartDate(cls.start_date, sessions)
  const registrationClose = cls.registration_close_date ?? firstSession
  const todayInZone = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const cancelled = cls.status === 'cancelled'
  const closed = todayInZone > String(registrationClose).slice(0, 10)
  const isFull = cls.capacity != null && spotsTaken >= Number(cls.capacity)

  if (cancelled) {
    return (
      <ClassStateCard
        title="This class isn’t running"
        body={`The ${heroTitleFor(cls)} scheduled here was cancelled. If you'd like help planning your student's test prep — or want to hear when the next class opens — we'd love to talk.`}
      />
    )
  }
  if (closed) {
    return (
      <ClassStateCard
        title="Registration for this class has closed"
        body={`Registration for the ${heroTitleFor(cls)} closed on ${formatDateFull(String(registrationClose).slice(0, 10))}. If you missed it, talk to us — 1-on-1 tutoring is always available, and we can let you know when the next class opens.`}
      />
    )
  }

  const accent = usableAccent(school?.accent_color)
  // PL-351: per-class hero photo (optional; missing = no frame at all).
  const heroImage = parseClassPageImage(cls.hero_image)
  const bullets = String(cls.selling_bullets ?? '')
    .split('\n')
    .map((b: string) => b.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
  const price = Number(cls.price)
  const priceLabel = `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  const closeDays = daysUntil(String(registrationClose).slice(0, 10), timezone)
  const countdown =
    closeDays === 0 ? 'today' : closeDays === 1 ? 'tomorrow' : `in ${closeDays} days`
  // PL-367: a sample page must not lead anywhere real.
  const registerHref = isSample ? '#' : `/register/${cls.slug ?? cls.id}`
  // PL-353: the class/school's OWN city, never the IANA zone city.
  const zoneCity = publicTimeCityLabel({
    schoolCity: school?.city,
    displayCities: cls.display_cities,
    location: cls.default_location,
    timezone,
  })
  const online = cls.delivery_mode === 'online'

  // PL-355: block scopes — shared renders everywhere; course rows render on
  // every class sharing the course key (inheritance IS the render rule);
  // class rows render on that class only. Pre-migration rows carry no scope
  // and count as shared.
  const isShared = (b: any) => !b.scope || b.scope === 'shared'
  // PL-369: shared copy respects the class record (facts from the record,
  // never from copy): strategy sessions exist for SCHOOL classes only;
  // practice exams / diagnostic FAQs only when the class has diagnostics.
  const isSchoolClass = Boolean(cls.school_id)
  const hasDiagnostics = cls.has_diagnostics !== false
  const respectsRecord = (b: any) =>
    b.key === 'included-strategy' || b.key === 'faq-strategy'
      ? isSchoolClass
      : b.key === 'included-exams' || b.key === 'faq-diagnostics'
        ? hasDiagnostics
        : true
  const faqBlocks = blocks.filter((b) => isShared(b) && b.section === 'faq' && respectsRecord(b))
  const includedBlocks = blocks
    .filter((b) => isShared(b) && b.section === 'included' && respectsRecord(b))
    .map((b) =>
      // PL-369 A: mode-aware title, composed from the record — one card, no
      // duplicate for online. Only the untouched default heading transforms;
      // a Scarlett-edited heading always wins.
      b.key === 'included-instruction' && online && b.heading === 'Live class instruction'
        ? { ...b, heading: 'Live online class instruction' }
        : b
    )
  const finePrintBlocks = blocks.filter((b) => isShared(b) && b.section === 'fine-print')
  const courseBlocks = blocks
    .filter(
      (b) =>
        (b.scope === 'course' && cls.course_key && b.course_key === cls.course_key) ||
        (b.scope === 'class' && b.class_id === cls.id)
    )
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const heroBlurb = courseBlocks.find((b) => String(b.key).endsWith(':hero-blurb')) ?? null
  const locationBlock = courseBlocks.find((b) => String(b.key).endsWith(':location')) ?? null
  const courseSections = courseBlocks.filter((b) => b !== heroBlurb && b !== locationBlock)
  // PL-352 (amendment): the 1-on-1 upsell ('one-on-one-pitch') deliberately
  // does NOT render here — it lives on the registration flow's second page.
  const instructors = block('instructors')
  const closing = block('closing-cta')
  const waitlistNote = block('waitlist-note')

  // PL-355 E: block copy may reference the record's facts as variables —
  // the address and the exam name (one shared exam-registration block, no
  // SAT/ACT fork). Substituted BEFORE markdown rendering; never money.
  // PL-368: THE one exam-family switch (exam-family.ts — shared with the
  // email side). PSAT has no public registration link: a markdown link
  // wrapping {examRegistrationLink} collapses to plain school-based wording
  // instead of rendering a wrong College Board URL.
  const fam = examFamilyFor(String(cls.class_type))
  const examName = fam?.examName ?? 'SAT'
  const md = (s: string) =>
    renderSiteMarkdown(
      String(s)
        .replaceAll('{address}', cls.default_location ?? 'our office')
        .replaceAll('{examName}', examName)
        .replace(/\[([^\]]*)\]\(\{examRegistrationLink\}\)/g, (_m, label) =>
          fam?.pageRegUrl ? `[${label}](${fam.pageRegUrl})` : `the ${SCHOOL_BASED_REG_TEXT}`
        )
        .replaceAll('{examRegistrationLink}', fam?.pageRegUrl ?? `the ${SCHOOL_BASED_REG_TEXT}`)
    )

  // PL-355 B: feeder-city time groups. Each feeder school contributes its
  // city + timezone; per session, cities whose local time renders the same
  // (same offset) collapse onto one line. display_cities stays the MANUAL
  // override (label list on the class's own times); no feeders = the class's
  // own city, plainly labeled (the PL-353 behavior).
  const feederCities: { city: string; tz: string }[] = []
  if (!cls.display_cities) {
    for (const f of feeders) {
      const s = one<any>(f.schools)
      if (!s?.timezone) continue
      const city = publicTimeCityLabel({ schoolCity: s.city, timezone: s.timezone })
      if (!feederCities.some((c) => c.city === city)) feederCities.push({ city, tz: s.timezone })
    }
  }
  const feederGroupsFor = (s: any): { range: string; cities: string[] }[] => {
    if (feederCities.length === 0 || !s.start_time) return []
    const startUtc = zonedToUtc(s.session_date, String(s.start_time).slice(0, 5), timezone)
    const endUtc = s.end_time ? zonedToUtc(s.session_date, String(s.end_time).slice(0, 5), timezone) : null
    const groups = new Map<string, string[]>()
    for (const fc of feederCities) {
      const range = formatTimeRange(startUtc, endUtc, fc.tz)
      groups.set(range, [...(groups.get(range) ?? []), fc.city])
    }
    return [...groups.entries()].map(([range, cities]) => ({ range, cities }))
  }

  // PL-355 C: sibling sections still open for registration.
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const liveSiblings = (siblings as any[])
    .map((sib) => {
      const sess = ([...(sib.sessions ?? [])] as any[]).sort(bySessionStart)
      const first = sess[0]
      const close = String(sib.registration_close_date ?? sess[0]?.session_date ?? sib.start_date ?? '').slice(0, 10)
      if (!close || close < todayIso) return null
      const start = clockLabel(first?.start_time)
      const end = clockLabel(first?.end_time)
      const sibSchool = one<any>(sib.schools)
      return {
        slug: sib.slug,
        label: [
          start ? (end ? timeRangeLabel(start, end) : start) : null,
          publicTimeCityLabel({
            schoolCity: sibSchool?.city,
            displayCities: sib.display_cities,
            location: sib.default_location,
            timezone: sib.timezone ?? sibSchool?.timezone ?? DEFAULT_TIMEZONE,
          }),
        ]
          .filter(Boolean)
          .join(' '),
      }
    })
    .filter(Boolean) as { slug: string; label: string }[]

  const registerCta = (extra = '') => (
    <a
      href={registerHref}
      data-track="register"
      className={`inline-block text-white text-center font-bold py-3 px-8 rounded-md hover:opacity-90 transition ${extra}`}
      style={{ background: accent }}
    >
      {isFull ? 'Join the waitlist' : 'Register'}
    </a>
  )

  // PL-359 A: JSON-LD composed FROM THE RECORD (the financial-facts rule
  // applies to markup too — price/availability/dates are never hand-typed).
  // Honest degrade: fields we can't state truthfully are omitted.
  const base = emailBaseUrl()
  const lastSession = sessions[sessions.length - 1]?.session_date ?? cls.start_date
  const org = {
    '@type': 'Organization',
    '@id': 'https://www.highergroundlearning.com/#org',
    name: 'Higher Ground Learning',
    url: 'https://www.highergroundlearning.com',
  }
  const faqItems = faqBlocks.flatMap((b) => parseFaqItems(b.body_markdown))
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      org,
      {
        '@type': 'Course',
        name: heroTitleFor(cls),
        description:
          bullets.length > 0
            ? bullets.join(' · ')
            : `Live ${cls.class_type} class from Higher Ground Learning.`,
        provider: { '@id': org['@id'] },
        offers: {
          '@type': 'Offer',
          price: price,
          priceCurrency: 'USD',
          availability: isFull ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
          validThrough: String(registrationClose).slice(0, 10),
          url: `${base}${registerHref}`,
        },
        hasCourseInstance: {
          '@type': 'CourseInstance',
          courseMode: online ? 'Online' : 'Onsite',
          startDate: firstSession,
          endDate: lastSession,
          ...(online
            ? { location: { '@type': 'VirtualLocation', url: `${base}/c/${cls.slug}` } }
            : cls.default_location
              ? { location: { '@type': 'Place', name: cls.default_location, address: cls.default_location } }
              : {}),
        },
      },
      ...(faqItems.length > 0
        ? [
            {
              '@type': 'FAQPage',
              mainEntity: faqItems.map((f) => ({
                '@type': 'Question',
                name: f.question,
                acceptedAnswer: { '@type': 'Answer', text: plainTextFromMarkdown(f.answerMarkdown) },
              })),
            },
          ]
        : []),
    ],
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {!isSample && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      {/* PL-350: first-party section/click counting (DNT-respecting; the
          fine-print block discloses it). Samples never count. */}
      {!isSample && <ClassPageAnalytics classId={cls.id} />}
      {isSample && (
        <div className="bg-amber-400 text-amber-950 text-center text-sm font-bold px-4 py-2">
          SAMPLE PAGE — layout preview with made-up class facts (dates, price, room). No class
          with this course exists yet; the content blocks below are real and editable in the
          admin. Registration is disabled.
        </div>
      )}
      {/* ── Hero: class-specific, live from the record ──────────────────── */}
      <section id="hero" data-section="hero" style={{ background: accent }}>
        <div className="max-w-3xl mx-auto px-5 py-10 sm:py-14 text-white">
          {school?.logo_url && (
            <div className="inline-block bg-white rounded-lg p-2 mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={school.logo_url} alt={`${school.name} logo`} className="h-14 w-auto" />
            </div>
          )}
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">{heroTitleFor(cls)}</h1>
          <p className="mt-2 text-white/90">
            {online ? 'Live online' : cls.default_location ? `In person · ${cls.default_location}` : 'In person'}
            {' · starts '}
            {formatDateFull(firstSession)}
          </p>
          {bullets.length > 0 && (
            <ul className="mt-5 space-y-2">
              {bullets.map((b: string, i: number) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-0.5">✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {/* PL-355 D: the per-class prerequisite line, near the bullets. */}
          {cls.prerequisite_note && (
            <p className="mt-4 text-sm font-semibold text-white/95">
              Prerequisite: <span className="font-normal">{cls.prerequisite_note}</span>
            </p>
          )}
          {/* PL-355 A/E: the course's hero blurb (course-type block). */}
          {heroBlurb && (
            <div
              className="mt-4 text-white/95 [&_p]:text-white/95 [&_a]:text-white [&_a]:underline space-y-2"
              dangerouslySetInnerHTML={{ __html: md(heroBlurb.body_markdown) }}
            />
          )}
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <span className="text-3xl font-extrabold">{priceLabel}</span>
            <a
              href={registerHref}
              data-track="register"
              className="inline-block bg-white text-center font-bold py-3 px-8 rounded-md hover:opacity-90 transition"
              style={{ color: accent }}
            >
              {isFull ? 'Join the waitlist' : 'Register'}
            </a>
          </div>
          <p className="mt-3 text-sm text-white/90">
            Registration closes {formatDateFull(String(registrationClose).slice(0, 10))} — {countdown}.
          </p>
          {/* PL-351: the class's own photo rides inside the hero, eager (top
              of page) with explicit dimensions — never a reflow. */}
          {heroImage && (
            <BlockImg
              image={heroImage}
              sizes="(min-width: 768px) 688px, 100vw"
              eager
              className="rounded-lg shadow-md mt-6"
            />
          )}
        </div>
      </section>

      {isFull && (
        <div className="bg-yellow-50 border-b border-yellow-200">
          <div className="max-w-3xl mx-auto px-5 py-4 text-sm text-yellow-900">
            <strong>{waitlistNote?.heading || 'This class is currently full.'}</strong>{' '}
            {waitlistNote
              ? waitlistNote.body_markdown
              : "Join the waitlist and we'll notify you if a place opens up."}
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-5 py-10 space-y-12">
        {/* ── Live schedule: same rows the calendar page reads ───────────── */}
        <section id="schedule" data-section="schedule">
          <h2 className="text-2xl font-bold text-hgl-slate mb-1">Class schedule</h2>
          <p className="text-sm text-gray-500 mb-4">
            {/* PL-355 B: with feeder cities, every row speaks each city's
                own local time — the header must not name a zone city. */}
            {feederCities.length > 0
              ? 'Times are shown in each city’s local time.'
              : `All times are ${zoneCity} time.`}{' '}
            <a href={`/classes/${cls.id}/calendar`} className="text-hgl-blue underline">
              Add the schedule to your calendar →
            </a>
          </p>
          {sessions.length === 0 ? (
            <p className="text-gray-600 italic">
              The session schedule is being finalized — check back soon.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 bg-white rounded-lg shadow-sm">
              {sessions.map((s: any, i: number) => {
                const start = clockLabel(s.start_time)
                const end = clockLabel(s.end_time)
                return (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-3">
                    <span className="text-xs font-bold text-gray-400 w-20 shrink-0">Session {i + 1}</span>
                    <span className="font-semibold text-hgl-slate">{formatDateOnly(s.session_date, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                    {/* PL-355 B: a follow-up class shows each feeder city's
                        own local time; same-offset cities share one line. */}
                    {feederGroupsFor(s).length > 0 ? (
                      <span className="text-gray-600">
                        {feederGroupsFor(s).map((g, gi) => (
                          <span key={gi} className="whitespace-nowrap">
                            {gi > 0 && <span className="text-gray-300"> · </span>}
                            {g.range} <span className="text-gray-400">{g.cities.join(', ')}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      start && (
                        <span className="text-gray-600 whitespace-nowrap">
                          {end ? timeRangeLabel(start, end) : start}
                        </span>
                      )
                    )}
                    {(s.location || (!online && cls.default_location)) && (
                      <span className="text-sm text-gray-400">{s.location || cls.default_location}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {/* PL-355 C: sibling sections of the same course — separate
              classes, cross-linked, never a section object. */}
          {liveSiblings.length > 0 && (
            <p className="mt-3 text-sm text-gray-600">
              Can&apos;t make these times?{' '}
              {liveSiblings.map((sib, i) => (
                <span key={sib.slug}>
                  {i > 0 && ' · '}
                  <a href={`/c/${sib.slug}`} className="text-hgl-blue underline">
                    There&apos;s also a section at {sib.label} →
                  </a>
                </span>
              ))}
            </p>
          )}
        </section>

        {/* ── PL-355 A/E: course-type + per-class sections (inherited via
            the course key; edit once per course, every run updates) ──────── */}
        {(courseSections.length > 0 || (locationBlock && !online && !school)) && (
          <section id="course" data-section="course" className="space-y-10">
            {courseSections.map((b) => {
              const img = parseClassPageImage(b.image)
              const beside = img && (img.layout === 'left' || img.layout === 'right')
              const body = (
                <div className="space-y-3" dangerouslySetInnerHTML={{ __html: md(b.body_markdown) }} />
              )
              return (
                <div key={b.key}>
                  {b.heading && <h2 className="text-2xl font-bold text-hgl-slate mb-3">{b.heading}</h2>}
                  {img && img.layout === 'hero' && (
                    <BlockImg image={img} sizes="(min-width: 768px) 736px, 100vw" className="rounded-lg mb-4" />
                  )}
                  {beside ? (
                    <div className="md:grid md:grid-cols-2 md:gap-6 md:items-center">
                      <BlockImg
                        image={img}
                        sizes="(min-width: 768px) 356px, 100vw"
                        className={`rounded-lg mb-4 md:mb-0 ${img.layout === 'right' ? 'md:order-2' : ''}`}
                      />
                      {body}
                    </div>
                  ) : (
                    body
                  )}
                </div>
              )
            })}
            {/* PL-355 E: the at-HGL location block — frame copy from the
                block ({address} substituted), the address itself and the
                map link always from the record. */}
            {locationBlock && !online && !school && cls.default_location && (
              <div id="location" data-section="location">
                <h2 className="text-2xl font-bold text-hgl-slate mb-3">{locationBlock.heading || 'Where we meet'}</h2>
                <div className="space-y-3" dangerouslySetInnerHTML={{ __html: md(locationBlock.body_markdown) }} />
                <p className="mt-2 text-sm">
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(cls.default_location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hgl-blue underline"
                  >
                    Open in Google Maps →
                  </a>
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── Evergreen shared blocks (edit once → every class page) ─────── */}
        {includedBlocks.length > 0 && (
          <section id="whats-included" data-section="whats-included">
            <h2 className="text-2xl font-bold text-hgl-slate mb-4">What&apos;s included in a class?</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {includedBlocks.map((b) => (
                <div
                  key={b.key}
                  className="bg-white rounded-lg shadow-sm p-5"
                  id={b.key === 'included-instruction' ? 'curriculum' : undefined}
                  data-section={b.key === 'included-instruction' ? 'curriculum' : undefined}
                >
                  {/* PL-351: card images sit on top regardless of the
                      layout hint — the two-column card grid has no side. */}
                  <BlockImg
                    image={parseClassPageImage(b.image)}
                    sizes="(min-width: 768px) 322px, calc(100vw - 80px)"
                    className="rounded mb-3"
                  />
                  <h3 className="font-bold text-hgl-slate mb-2">{b.heading}</h3>
                  <div className="space-y-3 text-sm" dangerouslySetInnerHTML={{ __html: md(b.body_markdown) }} />
                </div>
              ))}
            </div>
          </section>
        )}

        {instructors &&
          (() => {
            // PL-351: standalone sections honor the layout hint — image-left,
            // image-right (text beside it from md up; stacked on mobile), or
            // full-width above the text.
            const img = parseClassPageImage(instructors.image)
            const beside = img && (img.layout === 'left' || img.layout === 'right')
            const body = (
              <div className="space-y-3" dangerouslySetInnerHTML={{ __html: md(instructors.body_markdown) }} />
            )
            return (
              <section id="instructors" data-section="instructors">
                <h2 className="text-2xl font-bold text-hgl-slate mb-3">{instructors.heading}</h2>
                {img && img.layout === 'hero' && (
                  <BlockImg image={img} sizes="(min-width: 768px) 736px, 100vw" className="rounded-lg mb-4" />
                )}
                {beside ? (
                  <div className="md:grid md:grid-cols-2 md:gap-6 md:items-center">
                    <BlockImg
                      image={img}
                      sizes="(min-width: 768px) 356px, 100vw"
                      className={`rounded-lg mb-4 md:mb-0 ${img.layout === 'right' ? 'md:order-2' : ''}`}
                    />
                    {body}
                  </div>
                ) : (
                  body
                )}
                {/* PL-358: featured cards render FROM instructor profiles —
                    the same rows /team renders; the block body above is the
                    intro line only. */}
                {featuredInstructors.length > 0 && (
                  <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
                    {featuredInstructors.map((p: any) => {
                      const shot = parseClassPageImage(p.headshot)
                      return (
                        <div key={p.id} className="bg-white rounded-lg shadow-sm p-4 text-center">
                          {shot ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              {...imageAttrs(shot)}
                              sizes="96px"
                              loading="lazy"
                              decoding="async"
                              className="w-24 h-24 rounded-full object-cover mx-auto border border-gray-200"
                            />
                          ) : (
                            <div
                              aria-hidden
                              className="w-24 h-24 rounded-full bg-hgl-slate/10 text-hgl-slate flex items-center justify-center text-xl font-bold mx-auto"
                            >
                              {String(p.name)
                                .split(/\s+/)
                                .map((w: string) => w[0] ?? '')
                                .slice(0, 2)
                                .join('')
                                .toUpperCase()}
                            </div>
                          )}
                          <p className="mt-2 font-bold text-hgl-slate text-sm">{p.name}</p>
                          {p.credential && (
                            <p className="text-xs uppercase tracking-wide text-gray-500 mt-0.5">{p.credential}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })()}

        {faqBlocks.length > 0 && (
          <section id="faq" data-section="faq">
            <h2 className="text-2xl font-bold text-hgl-slate mb-4">FAQs</h2>
            <div className="space-y-6">
              {faqBlocks.map((b) => (
                <div key={b.key}>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">{b.heading}</h3>
                  <div className="bg-white rounded-lg shadow-sm divide-y divide-gray-100">
                    {parseFaqItems(b.body_markdown).map((item, i) => (
                      <details key={i} className="group px-4 py-3">
                        <summary className="cursor-pointer font-medium text-hgl-slate list-none flex justify-between gap-3">
                          {item.question}
                          <span aria-hidden className="text-gray-400 group-open:rotate-45 transition-transform">+</span>
                        </summary>
                        <div className="mt-2 space-y-2 text-sm" dangerouslySetInnerHTML={{ __html: md(item.answerMarkdown) }} />
                      </details>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Closing CTA: price + deadline from the RECORD (financial facts
            never live in authored copy) ─────────────────────────────────── */}
        <section id="closing" data-section="closing" className="text-center bg-white rounded-lg shadow-sm p-8">
          <h2 className="text-2xl font-bold text-hgl-slate mb-2">{closing?.heading || 'Ready to get started?'}</h2>
          {closing && (
            <div className="mb-4 text-gray-600" dangerouslySetInnerHTML={{ __html: md(closing.body_markdown) }} />
          )}
          <p className="text-3xl font-extrabold text-hgl-slate mb-4">{priceLabel}</p>
          {registerCta()}
          <p className="mt-3 text-sm text-gray-500">
            Registration closes {formatDateFull(String(registrationClose).slice(0, 10))} — {countdown}.
          </p>
        </section>

        {(finePrintBlocks.length > 0 || cls.min_enrollment != null) && (
          <section id="fine-print" data-section="fine-print" className="text-xs text-gray-500 space-y-3">
            <h2 className="text-sm font-bold text-gray-600">The fine print</h2>
            {cls.min_enrollment != null && Number(cls.min_enrollment) >= 1 && (
              <p>
                This class runs with a minimum of {Number(cls.min_enrollment)} enrolled student
                {Number(cls.min_enrollment) === 1 ? '' : 's'}.
              </p>
            )}
            {finePrintBlocks.map((b) => (
              <div key={b.key}>
                <h3 className="font-semibold text-gray-600 mb-1">{b.heading}</h3>
                <div className="space-y-2 [&_p]:text-gray-500 [&_a]:text-hgl-blue" dangerouslySetInnerHTML={{ __html: md(b.body_markdown) }} />
              </div>
            ))}
          </section>
        )}

        <footer className="text-center text-sm text-gray-400 pb-6">
          <a href="https://www.highergroundlearning.com" className="underline hover:text-gray-600">
            Higher Ground Learning
          </a>
          {' · '}
          <a href={CONSULT_HREF} className="underline hover:text-gray-600">
            Questions? Talk to us
          </a>
        </footer>
      </div>
    </div>
  )
}
