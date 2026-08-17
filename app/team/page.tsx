import type { Metadata } from 'next'
import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import { imageAttrs, parseClassPageImage } from '../utils/class-page-images'
import { plainTextFromMarkdown, renderSiteMarkdown } from '../utils/site-md'
import { CONSULT_HREF } from '../components/ClassStateCard'
import { emailBaseUrl } from '../utils/base-url'
import { pontano } from '../components/public-skin'

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
        url: 'https://www.highergroundlearning.com',
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
          url: `${emailBaseUrl()}/team`,
        }
      }),
    ],
  }

  return (
    <div className={`min-h-screen bg-gray-50 ${pontano.className}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="bg-hgl-slate">
        <div className="max-w-4xl mx-auto px-5 py-10 sm:py-14 text-white">
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">Our team</h1>
          <p className="mt-2 text-white/90">
            Where know-how meets dynamism — the instructors and staff behind Higher Ground
            Learning.
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-5 py-10">
        {people.length === 0 ? (
          <p className="text-gray-600 italic">
            Team profiles are being set up — check back soon.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {people.map((p) => {
              const shot = parseClassPageImage(p.headshot)
              return (
                <div key={p.id} className="bg-white rounded-lg shadow-sm p-5 flex flex-col">
                  <div className="flex items-center gap-4">
                    {shot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        {...imageAttrs(shot)}
                        sizes="112px"
                        loading="lazy"
                        decoding="async"
                        className="w-28 h-28 rounded-full object-cover shrink-0 border border-gray-200"
                      />
                    ) : (
                      // Honest degrade: no photo = an initials circle, never
                      // a broken frame.
                      <div
                        aria-hidden
                        className="w-28 h-28 rounded-full bg-hgl-slate/10 text-hgl-slate flex items-center justify-center text-2xl font-bold shrink-0"
                      >
                        {initials(p.name)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-hgl-slate">{p.name}</h2>
                      {p.credential && (
                        <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mt-0.5">
                          {p.credential}
                        </p>
                      )}
                    </div>
                  </div>
                  {p.bio && (
                    <details className="group mt-3">
                      <summary className="cursor-pointer text-sm text-hgl-blue font-semibold list-none">
                        <span className="group-open:hidden">About {String(p.name).split(' ')[0]} →</span>
                        <span className="hidden group-open:inline">Show less</span>
                      </summary>
                      <div
                        className="mt-2 text-sm space-y-2 [&_p]:text-gray-600"
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
          <a
            href={CONSULT_HREF}
            className="inline-block bg-hgl-blue text-white font-bold py-3 px-8 rounded-md hover:opacity-90 transition"
          >
            Work with us — free consultation
          </a>
        </div>

        <footer className="text-center text-sm text-gray-400 mt-10 pb-6">
          <a href="https://www.highergroundlearning.com" className="underline hover:text-gray-600">
            Higher Ground Learning
          </a>
        </footer>
      </div>
    </div>
  )
}
