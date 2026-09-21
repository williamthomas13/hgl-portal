import { loadContactInfo } from '../utils/tutoring-emails'
import InquiryForm from './inquiry-form'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// PL-38: the public "get started" form — Squarespace stays the marketing
// shell and its buttons point here (optionally with ?src=<which button>).
// Submissions land at the top of the prospective-students pipeline.

export const dynamic = 'force-dynamic'

export default async function InquirePage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; source?: string; interest?: string; school?: string }>
}) {
  // PL-470/473: plain links carry their context — ?source= (which page/button;
  // the legacy ?src= still works), ?interest= (pre-selects "What would you
  // like help with?") and ?school= (pre-fills the student's school). The
  // same three the /embed/inquire.js snippet sends.
  const sp = await searchParams
  const source = (sp.source ?? sp.src ?? '').trim().slice(0, 100) || null
  const interest = (sp.interest ?? '').trim().slice(0, 100) || null
  const school = (sp.school ?? '').trim().slice(0, 200) || null
  const contact = await loadContactInfo()

  return (
    <div className="min-h-screen bg-gray-50 ">
      <SiteHeader />
      <div className="py-10 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
          <h1 className="text-2xl font-bold text-hgl-slate mb-1">
            Higher Ground Learning — let&apos;s get started
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            Tell us a little about what you&apos;re looking for and we&apos;ll usually be able to
            reach out the same day. We&apos;ll get the rest of the details later when we connect!
          </p>
          <InquiryForm src={source} interest={interest} school={school} />
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-gray-600">
          Rather just talk to a person? Email{' '}
          <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
            {contact.email}
          </a>{' '}
          or give us a call at <strong>{contact.phone}</strong>
          {' — '}we&apos;re happy to take it from there.
        </div>
      </div>
      </div>
      <SiteFooter />
    </div>
  )
}
