import Link from 'next/link'
import type { Metadata } from 'next'
import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import { imageAttrs, parseClassPageImage } from '../utils/class-page-images'
import { plainTextFromMarkdown, renderSiteMarkdown } from '../utils/site-md'
import { CONSULT_CTA } from '../components/ClassStateCard'
import { publicSiteOrigin } from '../utils/base-url'
import { publicSkin, PAGE_HERO, HERO_MIN_H } from '../components/public-skin'
import SiteHeader, { HEADER_CLEARANCE } from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// PL-358: the public team page — GENERATED from instructor profiles (the
// one instructors table; show_on_team + team_order decide who and in what
// order). Same visual family as the /c pages, mobile-first; bios sit behind
// a tap-to-expand instead of a wall of text. Ships DARK like /c — nothing
// links here until the launch-tail cutover swaps the Squarespace nav link.

export const dynamic = 'force-dynamic'

// PL-374: shared public skin.

export const metadata: Metadata = {
  title: 'Our Team — Higher Ground Learning',
  description: 'The instructors and staff behind Higher Ground Learning.',
  openGraph: {
    title: 'Our Team — Higher Ground Learning',
    description: 'The instructors and staff behind Higher Ground Learning.',
    siteName: 'Higher Ground Learning',
  },
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export default async function TeamPage() {
  // PL-481: the editable hero slot — photo (uploaded through the site-content
  // image route, never hot-linked) + the visible tagline. The sentence "the
  // instructors and staff behind Higher Ground Learning" stays in the meta
  // description / OpenGraph / JSON-LD only (what search engines and AI
  // assistants read); the page shows the short tagline.
  const { data: heroBlock } = await supabase.from('site_content_blocks').select('heading, body_markdown, image').eq('key', 'team-hero').maybeSingle()
  const teamPhoto = parseClassPageImage(heroBlock?.image)
  const tagline = (heroBlock?.body_markdown ?? '').trim() || 'Where know-how meets dynamism'
  const { data } = await supabase
    .from('instructors')
    .select('id, name, public_name, credential, bio, headshot, team_order')
    .eq('show_on_team', true)
    .order('team_order', { ascending: true, nullsFirst: false })
    .order('name')
  // PL-365: public surfaces render public_name when set (the internal row
  // name stays authoritative for timecards/QBO — never renamed).
  const people = ((data as any[]) ?? []).map((p) => ({
    ...p,
    name: (typeof p.public_name === 'string' && p.public_name.trim()) || p.name,
  }))

  // PL-359 A: Person markup from the same profile rows the page renders.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://www.highergroundlearning.com/#org',
        name: 'Higher Ground Learning',
        // PL-498: the entity's url is the canonical portal host; sameAs links
        // it back to the brand domain so resolution never splits.
        url: publicSiteOrigin(),
        sameAs: ['https://www.highergroundlearning.com'],
      },
      ...people.map((p) => {
        const shot = parseClassPageImage(p.headshot)
        return {
          '@type': 'Person',
          name: p.name,
          ...(p.credential ? { jobTitle: p.credential } : {}),
          ...(shot ? { image: imageAttrs(shot).src } : {}),
          ...(p.bio ? { description: plainTextFromMarkdown(p.bio) } : {}),
          worksFor: { '@id': 'https://www.highergroundlearning.com/#org' },
          url: `${publicSiteOrigin()}/team`, // PL-474/498: the portal host
        }
      }),
    ],
  }

  return (
    <div className={`relative min-h-screen bg-gray-50 ${publicSkin}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* PL-492: the header sits ON the hero (transparent, white text) like the main site's. */}
      <SiteHeader current="team" tone="overlay" />
      {/* PL-495 (Scarlett, Sep 22): the team photo is the hero — full-bleed
          behind the heading exactly as PAGE_HERO is on /classes (same scrim,
          same height rule), heading + tagline centred over it in the display
          face. PL-481's editable slot + alt text are unchanged; with no photo
          uploaded the brand hero stands in. Text sits over the image now, so
          the PL-453 contrast measurement applies here too (the smoke gate). */}
      <section className="relative overflow-hidden bg-hgl-slate" data-testid="team-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          {...imageAttrs(teamPhoto ?? PAGE_HERO)}
          sizes="100vw"
          className="absolute inset-0 h-full w-full object-cover"
          decoding="async"
          data-testid="team-photo"
        />
        <div aria-hidden className="absolute inset-0 bg-hgl-slate/70" />
        <div className={`relative ${HEADER_CLEARANCE} ${HERO_MIN_H} max-w-4xl mx-auto px-5 py-10 sm:py-14 text-white text-center flex flex-col items-center justify-center`}>
          <h1 className="text-3xl sm:text-5xl font-bold leading-tight">{heroBlock?.heading?.trim() || 'Our team'}</h1>
          <p className="mt-3 text-xl sm:text-2xl text-white/95 [font-family:var(--font-heading-serif),Georgia,serif]" data-testid="team-tagline">{tagline}</p>
        </div>
      </section>

      {/* PL-500 amendment (Scarlett, Sep 24): spaced like the main site's Team
          page. Measured there at 1280: a 1096px-wide row of three 244px
          circles with 182px between them (the circle is ~57% of its column),
          the name ~26px under the circle at 20px serif, role + bio at 15px.
          Same numbers here: max-w-[1136px] (1096 + the 20px side gutters), lg:gap-x-[182px], the circle
          fills its 244px column. Tablet/phone keep proportionate air. */}
      <div className="max-w-[1136px] mx-auto px-5 py-12 sm:py-16 lg:py-20">
        {people.length === 0 ? (
          <p className="text-gray-600 italic">
            Team profiles are being set up — check back soon.
          </p>
        ) : (
          /* PL-495: the main site's grid — portraits filling the column
             (3-up from lg, 2 at tablet, 1 on a phone), name / role / bio
             centred beneath. PL-500 (Scarlett, Sep 24): CIRCULAR, like the
             main site's Team page (measured: its image wrapper carries
             border-radius 50%) — the same box, rounded-full, object-cover
             cropped centre; the initials placeholder is round too. Same
             classes the class page's instructor block already uses. */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-16 md:gap-x-24 lg:gap-x-[182px] gap-y-16 lg:gap-y-24 justify-items-center" data-testid="team-grid">
            {people.map((p) => {
              const shot = parseClassPageImage(p.headshot)
              return (
                <div key={p.id} className="flex flex-col items-center text-center w-full max-w-[244px] sm:max-w-[260px] lg:max-w-none" data-testid="team-member">
                  {shot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      {...imageAttrs(shot)}
                      sizes="(min-width: 1024px) 244px, (min-width: 640px) 260px, 244px"
                      loading="lazy"
                      decoding="async"
                      className="w-full aspect-square rounded-full object-cover bg-gray-100"
                      data-testid="team-portrait"
                    />
                  ) : (
                    // Honest degrade: no photo = an initials tile of the same
                    // shape, never a broken frame.
                    <div
                      aria-hidden
                      className="w-full aspect-square rounded-full bg-hgl-slate/10 text-hgl-slate flex items-center justify-center text-5xl font-bold"
                      data-testid="team-portrait-placeholder"
                    >
                      {initials(p.name)}
                    </div>
                  )}
                  <h2 className="mt-6 text-[20px] leading-tight font-semibold text-black">{p.name}</h2>
                  {p.credential && (
                    <p className="text-[15px] leading-relaxed uppercase text-gray-700 mt-2">
                      {p.credential}
                    </p>
                  )}
                  {p.bio && (
                    <details className="group mt-3 w-full">
                      <summary className="cursor-pointer text-[15px] text-hgl-blue list-none">
                        <span className="group-open:hidden">About {String(p.name).split(' ')[0]} →</span>
                        <span className="hidden group-open:inline">Show less</span>
                      </summary>
                      <div
                        className="mt-3 text-[15px] leading-relaxed space-y-2 [&_p]:text-gray-700 text-center"
                        dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(p.bio) }}
                      />
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-10 text-center">
          <Link
            href="/inquire?source=team"
            className="inline-block bg-hgl-blue text-white font-bold py-3 px-8 rounded-md hover:opacity-90 transition"
          >
            {CONSULT_CTA}
          </Link>
        </div>

      </div>
      <SiteFooter />
    </div>
  )
}
