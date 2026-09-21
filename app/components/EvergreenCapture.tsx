import InterestCapture from './InterestCapture'
import BrandLockup from './BrandLockup'
import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'
import { publicSkin } from './public-skin'

// PL-378 B/C: the between-classes interest capture behind an evergreen
// link — feeds the existing class_interest machinery. PL-484: the SAME
// capture component as the class states (names + the Compass opt-in).
// PL-489: this render path missed PL-478/483 — it now wears the full site
// header + footer like every other state card, and the brand lockup (HGL +
// the school's logo from tablet up, school only at phone width).
export default function EvergreenCapture({
  schoolId,
  classType,
  heading,
  sub,
  schoolLabel,
  schoolName = null,
  schoolLogo = null,
}: {
  schoolId: string | null
  classType: string
  heading: string
  sub: string
  schoolLabel?: string
  schoolName?: string | null
  schoolLogo?: string | null
}) {
  return (
    <div className={`min-h-screen bg-gray-50 flex flex-col ${publicSkin}`} data-testid="no-upcoming-class">
      <SiteHeader />
      <div className="flex-1 px-4">
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8 my-12">
          <BrandLockup schoolLogo={schoolLogo} schoolName={schoolName} className="mb-4" />
          <h1 className="text-2xl font-bold text-hgl-slate mb-2">{heading}</h1>
          <p className="text-gray-600 mb-3">{sub}</p>
          <InterestCapture evergreen={{ schoolId }} schoolNickname={schoolLabel ?? 'the next'} classType={classType} buttonLabel="Email me when it opens" compact />
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
