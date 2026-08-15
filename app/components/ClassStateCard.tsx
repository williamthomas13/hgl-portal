import { renderSiteMarkdown } from '../utils/site-md'

// PL-348: the honest full-page state card for the public class pages —
// printed collateral and hgl.co shortlinks must NEVER land on a 404, so
// no-class / cancelled / closed all resolve here with a consultation door.
// Shared by /c/{slug} and the PL-349 shortlink fallthrough.

export const CONSULT_HREF = '/inquire?src=class-page'

export function ClassStateCard({
  title,
  body,
  showConsult = true,
}: {
  title: string
  /** Markdown (site-md flavor) — state copy may come from site_content_blocks. */
  body: string
  showConsult?: boolean
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 sm:p-10">
      <div className="max-w-xl w-full bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue text-center">
        <h1 className="text-2xl font-bold text-hgl-slate mb-4">{title}</h1>
        <div
          className="text-gray-600 mb-6 text-left space-y-3"
          dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(body) }}
        />
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {showConsult && (
            <a
              href={CONSULT_HREF}
              className="inline-block bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:opacity-90 transition"
            >
              Talk to us — free consultation
            </a>
          )}
          <a
            href="https://www.highergroundlearning.com"
            className="inline-block bg-gray-100 text-hgl-slate font-bold py-3 px-6 rounded-md hover:bg-gray-200 transition"
          >
            Higher Ground Learning
          </a>
        </div>
      </div>
    </div>
  )
}
