// Friendly full-page notices for the public pages (master spec §12). Bad
// slugs, cancelled classes, and closed registration all resolve to one of
// these cards — never a blank page, spinner, or bare error string — and every
// card offers the main site as the way out.

import { publicSkin } from './public-skin'
import BrandLockup from './BrandLockup'

export const MAIN_SITE = 'https://www.highergroundlearning.com'

export function PublicNoticeCard({
  title,
  children,
  schoolLogo = null,
  schoolName = null,
  header = null,
}: {
  title: string
  children: React.ReactNode
  /** PL-483: the school's logo for the HGL × school lockup on the card header. */
  schoolLogo?: string | null
  schoolName?: string | null
  /** PL-478: the site header, passed in as a node (this card renders inside client components). */
  header?: React.ReactNode
}) {
  return (
    <div className={`min-h-screen bg-gray-50 flex flex-col ${publicSkin}`}>
      {header}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
      <div className="max-w-xl w-full mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue text-center">
        {/* PL-415/483: the brand lockup on the notice card — explicit dims, no layout shift. */}
        <BrandLockup schoolLogo={schoolLogo} schoolName={schoolName} className="justify-center mb-4" />
        <h1 className="text-2xl font-bold text-hgl-slate mb-4">{title}</h1>
        <p className="text-gray-600 mb-6">{children}</p>
        <a
          href={MAIN_SITE}
          className="public-cta inline-block bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition"
        >
          Back to Higher Ground Learning
        </a>
      </div>
      </div>
    </div>
  )
}

/** §12 friendly 404 — shared by every public page that loads a class by
 * slug/id (registration, calendar landing). */
export function ClassNotFound() {
  return (
    <PublicNoticeCard title="Class not found">
      We couldn&apos;t find that class — the link may be out of date. Current classes and
      registration links are on our main site.
    </PublicNoticeCard>
  )
}
