import { loadContactInfo } from '../utils/tutoring-emails'
import InquiryForm from './inquiry-form'

// PL-38: the public "get started" form — Squarespace stays the marketing
// shell and its buttons point here (optionally with ?src=<which button>).
// Submissions land at the top of the prospective-students pipeline.

export const dynamic = 'force-dynamic'

export default async function InquirePage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>
}) {
  const { src } = await searchParams
  const contact = await loadContactInfo()

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
          <h1 className="text-2xl font-bold text-hgl-slate mb-1">
            Higher Ground Learning — let&apos;s get started
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            Tell us a little about what you&apos;re looking for and we&apos;ll reach out — usually
            the same day. Short and sweet; details come later, in conversation.
          </p>
          <InquiryForm src={src ?? null} />
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
  )
}
