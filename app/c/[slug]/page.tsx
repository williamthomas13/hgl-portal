import type { Metadata } from 'next'
import { cache } from 'react'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { usableAccent } from '../../utils/collateral'
import {
  bySessionStart,
  effectiveStartDate,
  formatDateFull,
  formatDateOnly,
  publicTimeCityLabel,
  timeRangeLabel,
} from '../../utils/dates'
import { DEFAULT_TIMEZONE } from '../../utils/lifecycle'
import { parseFaqItems, renderSiteMarkdown } from '../../utils/site-md'
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

const loadPage = cache(async (slug: string) => {
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
      .select('key, section, heading, body_markdown, sort_order, image')
      .order('section')
      .order('sort_order')
    blocks = (data as any[]) ?? []
  } catch {
    blocks = []
  }
  return { cls: cls as any, spotsTaken, blocks }
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
  const { cls } = await loadPage(slug)
  if (!cls) return { title: 'Classes — Higher Ground Learning', robots: { index: false } }
  return {
    title: `${heroTitleFor(cls)} — Higher Ground Learning`,
    description: `Live ${cls.class_type} class from Higher Ground Learning — schedule, what's included, and registration.`,
  }
}

export default async function PublicClassPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { cls, spotsTaken, blocks } = await loadPage(slug)

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
  const registerHref = `/register/${cls.slug ?? cls.id}`
  // PL-353: the class/school's OWN city, never the IANA zone city.
  const zoneCity = publicTimeCityLabel({
    schoolCity: school?.city,
    displayCities: cls.display_cities,
    location: cls.default_location,
    timezone,
  })
  const online = cls.delivery_mode === 'online'

  const faqBlocks = blocks.filter((b) => b.section === 'faq')
  const includedBlocks = blocks.filter((b) => b.section === 'included')
  const finePrintBlocks = blocks.filter((b) => b.section === 'fine-print')
  // PL-352 (amendment): the 1-on-1 upsell ('one-on-one-pitch') deliberately
  // does NOT render here — it lives on the registration flow's second page.
  const instructors = block('instructors')
  const closing = block('closing-cta')
  const waitlistNote = block('waitlist-note')

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* PL-350: first-party section/click counting (DNT-respecting; the
          fine-print block discloses it). */}
      <ClassPageAnalytics classId={cls.id} />
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
            All times are {zoneCity} time.{' '}
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
                    {start && (
                      <span className="text-gray-600 whitespace-nowrap">
                        {end ? timeRangeLabel(start, end) : start}
                      </span>
                    )}
                    {(s.location || (!online && cls.default_location)) && (
                      <span className="text-sm text-gray-400">{s.location || cls.default_location}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

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
                  <div className="space-y-3 text-sm" dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(b.body_markdown) }} />
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
              <div className="space-y-3" dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(instructors.body_markdown) }} />
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
                        <div className="mt-2 space-y-2 text-sm" dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(item.answerMarkdown) }} />
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
            <div className="mb-4 text-gray-600" dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(closing.body_markdown) }} />
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
                <div className="space-y-2 [&_p]:text-gray-500 [&_a]:text-hgl-blue" dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(b.body_markdown) }} />
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
