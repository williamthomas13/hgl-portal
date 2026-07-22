import { PublicNoticeCard } from '../components/PublicNotice'

// PL-70b: the friendly landing for tokenized GET links that fail — humans hit
// invalid links all the time (truncated URLs, forwarded emails), and raw JSON
// is never an acceptable answer. Reason variants keep the copy honest without
// leaking anything.

export default async function LinkHelpPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  if (reason === 'offer-expired') {
    return (
      <PublicNoticeCard title="This offer has ended">
        The spot we offered has been passed to the next family in line — offers hold for 48 hours
        so nobody loses class days waiting. You&apos;re still on our list, and if another spot
        opens you&apos;ll hear from us right away. Questions? Just reply to any of our emails.
      </PublicNoticeCard>
    )
  }
  if (reason === 'addon-ended') {
    return (
      <PublicNoticeCard title="That offer has ended">
        The discounted pre-class tutoring offer closes when class starts. 1-on-1 tutoring is still
        very much available — just reply to any of our emails and we&apos;ll set it up together.
      </PublicNoticeCard>
    )
  }
  return (
    <PublicNoticeCard title="That link didn't work">
      The link looks incomplete or out of date — email apps sometimes trim long links, and
      forwarded emails can break them. Try the button in the original email again, or simply
      reply to any of our emails and a real human will take care of it for you.
    </PublicNoticeCard>
  )
}
