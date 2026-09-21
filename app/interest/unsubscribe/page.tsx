import { PublicNoticeCard } from '../../components/PublicNotice'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyInterestUnsubscribe } from '../../utils/interest'
import SiteHeader from '../../components/SiteHeader'

// PL-484: "Take me off this list" — the interest-list confirmation email's
// P.S. link. Marks every interest row for that address unsubscribed (the
// notify-on-open pass skips them); the Compass subscription is untouched.
export const dynamic = 'force-dynamic'

export default async function InterestUnsubscribePage({ searchParams }: { searchParams: Promise<{ e?: string; t?: string }> }) {
  const { e, t } = await searchParams
  const email = verifyInterestUnsubscribe(e ?? null, t ?? null)
  if (!email) {
    return (
      <PublicNoticeCard header={<SiteHeader />} title="That link didn't work">
        The link looks incomplete. Reply to the email you received and we will take you off the list by hand.
      </PublicNoticeCard>
    )
  }
  await supabase.from('class_interest').update({ unsubscribed_at: new Date().toISOString() }).eq('email', email).is('unsubscribed_at', null)
  return (
    <PublicNoticeCard header={<SiteHeader />} title="You're off the list">
      We won&apos;t email {email} about the next class. If you change your mind, any class page has the sign-up again.
    </PublicNoticeCard>
  )
}
