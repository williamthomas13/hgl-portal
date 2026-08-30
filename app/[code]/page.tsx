import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'
import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import { ClassStateCard } from '../components/ClassStateCard'
import EvergreenCapture from '../components/EvergreenCapture'
import { publicSkin } from '../components/public-skin'
import { classPageMetadata, ClassPageView } from '../c/[slug]/view'
import { bumpCodeVisit, resolveEvergreen } from '../utils/evergreen'

// PL-384: hgl.co/{code} — THE permanent address. A school/course has exactly
// one code, evergreen; the code SERVES its newest open class's page IN PLACE
// (no redirect, no /c/{slug} flash — hgl.co/sls stays in the address bar),
// carries the class's JSON-LD, and is the CANONICAL page (nothing was
// indexed before this model; a stable per-school URL accumulating authority
// beats fresh per-cohort slugs — Scarlett's call). Nothing open → the
// interest-capture state serves at the SAME URL (one URL, honest states).
// Legacy registrar forwards 301 ahead of everything; unknown codes get the
// honest no-active-class card — printed collateral must never 404.
//
// Root-level dynamic segment: every static route (/admin, /c, /register,
// /classes, …) wins over it, so it only catches the code namespace.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

const CODE_RE = /^[a-z0-9-]{1,32}$/

function normalize(raw: string): string {
  return decodeURIComponent(raw).toLowerCase().trim()
}

async function honestCard() {
  let heading = 'No active class right now'
  let body =
    "There's no class open for registration at this link right now. Talk to us directly and we'll point you toward the right prep option for your student."
  try {
    const { data: blk } = await supabase
      .from('site_content_blocks')
      .select('heading, body_markdown')
      .eq('key', 'no-active-class')
      .maybeSingle()
    if (blk?.heading) heading = blk.heading
    if (blk?.body_markdown) body = blk.body_markdown
  } catch {
    // seeds not applied yet — the fallback copy stands
  }
  return <ClassStateCard title={heading} body={body} />
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
  const code = normalize((await params).code)
  if (!CODE_RE.test(code)) return honestCard()

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

  return honestCard()
}
