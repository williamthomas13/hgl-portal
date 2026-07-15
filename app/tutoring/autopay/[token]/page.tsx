import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { verifyAutopayToken } from '../../../utils/tutoring-billing'
import { loadContactInfo } from '../../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../../components/PublicNotice'
import AutopayConsent from './autopay-consent'

// Autopay opt-in (Phase 7c, spec §3 families): explicit consent language,
// then a Stripe-hosted setup session collects the card or US bank account —
// card data never touches the portal. The saved method is charged each month
// AFTER the family confirms (or auto-confirms) the schedule.

export const dynamic = 'force-dynamic'

export default async function AutopayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { token } = await params
  const sp = await searchParams
  const familyId = verifyAutopayToken(token)
  const contact = await loadContactInfo()

  if (!familyId) {
    return (
      <PublicNoticeCard title="We couldn't open that link">
        The link may be out of date. Email {contact.email} or call {contact.phone} and we&apos;ll set
        up autopay for you.
      </PublicNoticeCard>
    )
  }

  const { data: family } = await supabase
    .from('families')
    .select('parent_first_name, autopay, stripe_payment_method_id')
    .eq('id', familyId)
    .maybeSingle()
  if (!family) {
    return (
      <PublicNoticeCard title="We couldn't open that link">
        Email {contact.email} or call {contact.phone} and we&apos;ll take care of it.
      </PublicNoticeCard>
    )
  }

  const justFinished = sp.done === '1'
  const active = family.autopay && Boolean(family.stripe_payment_method_id)

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
          <h1 className="text-2xl font-bold text-hgl-slate mb-4">Tutoring autopay</h1>
          {justFinished || active ? (
            <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
              <strong>Autopay is on.</strong> Each month, once you&apos;ve confirmed the schedule
              (or it auto-confirms), the invoice charges your saved payment method automatically and
              you get a receipt by email. To change or remove the saved method, just get in touch.
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                With autopay on, your monthly tutoring invoice is charged automatically to a card or
                US bank account you save with Stripe, our payment processor. Specifically:
              </p>
              <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1 mb-5">
                <li>
                  You&apos;ll still get the schedule to review each month — <strong>nothing is
                  charged before the month is confirmed</strong> (by you, or automatically after the
                  review window).
                </li>
                <li>The charge equals the invoice total, and you get a receipt every time.</li>
                <li>Bank (ACH) payments carry lower fees than cards — either is fine.</li>
                <li>You can turn autopay off any time by emailing or calling us.</li>
              </ul>
              <AutopayConsent token={token} />
            </>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-gray-600">
          Questions? Email{' '}
          <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
            {contact.email}
          </a>{' '}
          or give us a call at <strong>{contact.phone}</strong>.
        </div>
      </div>
    </div>
  )
}
