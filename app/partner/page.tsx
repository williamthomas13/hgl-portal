import type { Metadata } from 'next'
import { publicSkin } from '../components/public-skin'
import PublicEmbedForm from '../components/PublicEmbedForm'
import { PUBLIC_CONTACT_EMAIL } from '../utils/public-contact'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// PL-477: the school-partnership inquiry (today: the /examzen "Get started
// with Higher Ground" form). Lands as a lead of kind 'school' — its own lane
// in Prospective students, never the family pipeline.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'School partnerships — Higher Ground Learning',
  description: 'Bring Higher Ground Learning test prep to your school — on campus, online, or school-sponsored.',
}

export default async function PartnerPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams
  return (
    <div className={`min-h-screen bg-gray-50  ${publicSkin}`}>
      <SiteHeader />
      <div className="py-10 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8" data-testid="partner-form">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/collateral/hgl-logo-color.png" alt="Higher Ground Learning" width={71} height={40} className="h-10 w-auto mb-4" />
          <PublicEmbedForm script="/embed/partner.js" mountId="hgl-partner" source={source ?? 'portal:/partner'} interest={null} />
          <noscript>
            <p className="text-sm text-gray-600">
              This form needs JavaScript — email us at {PUBLIC_CONTACT_EMAIL} and we will take it from there.
            </p>
          </noscript>
        </div>
        <p className="text-sm text-gray-500 text-center">
          A family looking for tutoring or a class? <a href="/inquire?source=portal:/partner" className="text-hgl-blue underline">Use the inquiry form instead →</a>
        </p>
      </div>
      </div>
      <SiteFooter />
    </div>
  )
}
