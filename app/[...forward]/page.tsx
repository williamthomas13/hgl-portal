import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'
import { wildcardForward } from '../utils/evergreen'

// PL-448: the registrar-parity wildcard for MULTI-segment unknown paths —
// hgl.co/anything/nested 301s to the same path on highergroundlearning.com,
// exactly as the registrar's standing wildcard forward does today. Next's
// route precedence keeps this the LAST resort: every static route, the
// /{code} segment, and /{code}/register all win before a path lands here.

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Higher Ground Learning', robots: { index: false } }
}

export default async function WildcardForwardPage({
  params,
}: {
  params: Promise<{ forward: string[] }>
}) {
  const segments = (await params).forward ?? []
  permanentRedirect(wildcardForward(segments))
}
