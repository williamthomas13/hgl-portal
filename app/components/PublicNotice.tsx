// Friendly full-page notices for the public pages (master spec §12). Bad
// slugs, cancelled classes, and closed registration all resolve to one of
// these cards — never a blank page, spinner, or bare error string — and every
// card offers the main site as the way out.

export const MAIN_SITE = 'https://www.highergroundlearning.com'

export function PublicNoticeCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-10">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue text-center">
        <h1 className="text-2xl font-bold text-hgl-slate mb-4">{title}</h1>
        <p className="text-gray-600 mb-6">{children}</p>
        <a
          href={MAIN_SITE}
          className="inline-block bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition"
        >
          Back to Higher Ground Learning
        </a>
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
