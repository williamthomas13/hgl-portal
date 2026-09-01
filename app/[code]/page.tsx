import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'
import EvergreenCapture from '../components/EvergreenCapture'
import { publicSkin } from '../components/public-skin'
import { classPageMetadata, ClassPageView } from '../c/[slug]/view'
import { bumpCodeVisit, resolveEvergreen, wildcardForward } from '../utils/evergreen'

// PL-384: hgl.co/{code} — THE permanent address. A school/course has exactly
// one code, evergreen; the code SERVES its newest open class's page IN PLACE
// (no redirect, no /c/{slug} flash — hgl.co/sls stays in the address bar),
// carries the class's JSON-LD, and is the CANONICAL page (nothing was
// indexed before this model; a stable per-school URL accumulating authority
// beats fresh per-cohort slugs — Scarlett's call). Nothing open → the
// interest-capture state serves at the SAME URL (one URL, honest states).
//
// PL-448 resolution order (documented): reserved routes (Next's own router
// precedence — every static route wins over this segment) → codes
// (school/course, served in place) → legacy overrides (301 to their stored
// destination) → the WILDCARD 301: any path that is NONE of those forwards
// to the same path on highergroundlearning.com, replicating the registrar's
// standing hgl.co/{anything} forward exactly, forever. The honest
// no-active-class card retired for unknown paths — the main site's own 404
// owns that job, as it does today; KNOWN codes with nothing open still get
// the interest-capture state (a printed code never strands).

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

const CODE_RE = /^[a-z0-9-]{1,32}$/

function normalize(raw: string): string {
  return decodeURIComponent(raw).toLowerCase().trim()
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>
}): Promise<Metadata> {
  const code = normalize((await params).code)
  if (!CODE_RE.test(code)) return { title: 'Higher Ground Learning', robots: { index: false } }
  const res = await resolveEvergreen(code)
  if ((res.kind === 'school' || res.kind === 'course') && res.classSlug) {
    return classPageMetadata(res.classSlug, { mode: 'code', code })
  }
  if (res.kind === 'school' || res.kind === 'course') {
    return {
      title: `${res.label} test prep — Higher Ground Learning`,
      description: `No class is open for registration right now — leave your email and we'll tell you the moment the next ${res.label} class opens.`,
    }
  }
  return { title: 'Higher Ground Learning', robots: { index: false } }
}

export default async function EvergreenCodePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const raw = (await params).code
  const code = normalize(raw)
  // PL-448: malformed = not a code = the wildcard's business (path verbatim).
  if (!CODE_RE.test(code)) permanentRedirect(wildcardForward([raw]))

  const res = await resolveEvergreen(code)

  if (res.kind === 'legacy') permanentRedirect(res.destination)

  if (res.kind === 'school' || res.kind === 'course') {
    await bumpCodeVisit(code)
    if (res.classSlug) {
      // Served IN PLACE — the code URL is the page.
      return <ClassPageView slug={res.classSlug} opts={{ mode: 'code', code }} />
    }
    // Between classes: the SAME URL serves the interest capture — a printed
    // or bookmarked code never strands.
    return (
      <div className={`min-h-screen bg-gray-50 ${publicSkin}`}>
        <EvergreenCapture
          schoolId={res.kind === 'school' ? res.schoolId : null}
          classType={res.classType}
          heading={
            res.kind === 'school'
              ? `No upcoming class at ${res.label} right now`
              : `No upcoming ${res.label} class right now`
          }
          sub="Leave your email and we'll let you know the moment the next class opens for registration — nothing else, no newsletter."
        />
      </div>
    )
  }

  // PL-448: not a code we know → the registrar-parity wildcard 301.
  permanentRedirect(wildcardForward([raw]))
}
