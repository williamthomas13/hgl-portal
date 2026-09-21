import type { Metadata } from 'next'
import { publicSkin } from '../components/public-skin'
import PublicEmbedForm from '../components/PublicEmbedForm'

// PL-477: the College Prep Compass signup (the footer block on every sqsp
// page + /college-prep-compass) → marketing_subscribers. Explicit consent
// text; single opt-in (no double opt-in is specified anywhere in the repo —
// the confirmed_at column exists if Scarlett wants one).
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'College Prep Compass — Higher Ground Learning',
  description: 'Occasional emails on test dates, deadlines and how to prepare — for parents and students.',
}

export default async function CompassPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams
  return (
    <div className={`min-h-screen bg-gray-50 py-10 px-4 ${publicSkin}`}>
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8" data-testid="compass-form">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/collateral/hgl-logo-color.png" alt="Higher Ground Learning" width={71} height={40} className="h-10 w-auto mb-4" />
        <PublicEmbedForm script="/embed/compass.js" mountId="hgl-compass" source={source ?? 'portal:/compass'} interest={null} />
        <noscript>
          <p className="text-sm text-gray-600">This form needs JavaScript — email us and we will add you.</p>
        </noscript>
      </div>
    </div>
  )
}
