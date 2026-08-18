import { classPageMetadata, ClassPageView } from './view'
import type { Metadata } from 'next'

// PL-384: /c/{slug} is the INTERNAL unique address a class keeps for the
// cases the evergreen code can't cover (sibling sections, pinned overlaps,
// past classes). It always serves noindex, canonicalized to the class's
// /{code} URL when one exists — the code URL is the page families and
// Google see. The renderer lives in view.tsx, shared with app/[code].

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  return classPageMetadata(slug, { mode: 'slug' })
}

export default async function PublicClassPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ClassPageView slug={slug} opts={{ mode: 'slug' }} />
}
