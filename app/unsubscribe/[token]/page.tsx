import { verifyUnsubscribeToken, suppressEmail } from '../../utils/campaigns'

// PL-201: the visible unsubscribe page — tokenized, no login, GET-safe (the
// PL-125 lesson: prefetchers follow GETs, so the opt-out itself is a POST via
// server action). Unsubscribing stops OFFERS only; schedules, invoices, and
// receipts are transactional and unaffected — the page says so.

export const dynamic = 'force-dynamic'

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const { token } = await params
  const { done } = await searchParams
  const email = verifyUnsubscribeToken(token)

  async function unsubscribe() {
    'use server'
    const em = verifyUnsubscribeToken(token)
    if (em) await suppressEmail(em, 'unsubscribe page')
    const { redirect } = await import('next/navigation')
    redirect(`/unsubscribe/${token}?done=1`)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full text-center">
        {!email ? (
          <>
            <h1 className="text-xl font-bold text-hgl-slate mb-2">This link isn&apos;t valid</h1>
            <p className="text-sm text-gray-600">
              It may have been trimmed by your email app. Reply to any of our emails and we&apos;ll
              take you off the list by hand.
            </p>
          </>
        ) : done ? (
          <>
            <h1 className="text-xl font-bold text-hgl-slate mb-2">You&apos;re unsubscribed</h1>
            <p className="text-sm text-gray-600">
              {/* PL-215: {' '} — the compiler eats a bare inline-boundary space (batch-16 lesson). */}
              <strong>{email}</strong>{' '}won&apos;t receive offers or announcements from us anymore.
              Emails about your own schedule, invoices, and receipts still arrive — those aren&apos;t
              marketing.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-hgl-slate mb-2">Unsubscribe from offers?</h1>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{email}</strong>{' '}will stop receiving offers and announcements. Emails about
              your own schedule, invoices, and receipts aren&apos;t affected.
            </p>
            <form action={unsubscribe}>
              <button
                type="submit"
                className="bg-hgl-slate text-white font-bold rounded-md px-6 py-2.5 hover:opacity-90"
              >
                Unsubscribe
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
