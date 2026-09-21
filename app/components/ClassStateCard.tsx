import { renderSiteMarkdown } from '../utils/site-md'
import { publicSkin } from './public-skin'
import InterestCapture from './InterestCapture'
import BrandLockup from './BrandLockup'
import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'

// PL-348: the honest full-page state card for the public class pages —
// printed collateral and hgl.co shortlinks must NEVER land on a 404, so
// no-class / cancelled / closed all resolve here with a consultation door.
// Shared by /c/{slug} and the PL-349 shortlink fallthrough.

export const CONSULT_HREF = '/inquire?src=class-page'
/** PL-485 (Scarlett, Sep 21): THE consultation call-to-action wording on every
 *  public page — closed / in-progress / no-upcoming cards, the class page
 *  footer, /team. The one exception is the /classes button ("Talk to us",
 *  PL-479), which deliberately does not use this constant. */
export const CONSULT_CTA = 'Schedule a free consultation'

/** PL-470: the consultation door carries its context — school + class
 *  pre-filled on /inquire (PL-473 reads source / interest / school). */
export function consultHrefFor(ctx: { source: string; classType?: string | null; schoolNickname?: string | null }): string {
  const q = new URLSearchParams({ source: ctx.source })
  if (ctx.classType) q.set('interest', ctx.classType)
  if (ctx.schoolNickname) q.set('school', ctx.schoolNickname)
  return `/inquire?${q.toString()}`
}

export function ClassStateCard({
  title,
  body,
  showConsult = true,
  consultHref = CONSULT_HREF,
  interest = null,
  schoolLogo = null,
  schoolName = null,
}: {
  title: string
  /** Markdown (site-md flavor) — state copy may come from site_content_blocks. */
  body: string
  showConsult?: boolean
  consultHref?: string
  /** PL-470 (Scarlett, Sep 21): every closed / in-progress / no-class card
   *  must offer an action — the consultation door AND the interest-list
   *  capture inline (email + optional student name → class_interest for
   *  that school), so a visitor who missed this class can ask to hear about
   *  the next one without leaving the page. */
  interest?: { classId: string; schoolNickname: string; classType: string } | null
  /** PL-483: the school's logo for the HGL × school lockup. */
  schoolLogo?: string | null
  schoolName?: string | null
}) {
  return (
    <div className={`min-h-screen bg-gray-50 flex flex-col ${publicSkin}`}>
      <SiteHeader />
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
      <div className="max-w-xl w-full bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue text-center">
        {/* PL-415/483: the brand lockup on the honest-state chrome — explicit dimensions, no layout shift. */}
        <BrandLockup schoolLogo={schoolLogo} schoolName={schoolName} className="justify-center mb-4" />
        <h1 className="text-2xl font-bold text-hgl-slate mb-4">{title}</h1>
        <div
          className="text-gray-600 mb-6 text-left space-y-3"
          dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(body) }}
        />
        {interest && (
          <div className="mb-6" data-testid="state-interest-capture">
            <InterestCapture classId={interest.classId} schoolNickname={interest.schoolNickname} classType={interest.classType} />
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {showConsult && (
            <a
              href={consultHref}
              className="public-cta inline-block bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:opacity-90 transition"
            >
              {CONSULT_CTA}
            </a>
          )}
          <a
            href="https://www.highergroundlearning.com"
            className="public-cta inline-block bg-gray-100 text-hgl-slate font-bold py-3 px-6 rounded-md hover:bg-gray-200 transition"
          >
            Higher Ground Learning
          </a>
        </div>
      </div>
      </div>
      <SiteFooter />
    </div>
  )
}
