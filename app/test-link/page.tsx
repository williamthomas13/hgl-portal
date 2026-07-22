import { PublicNoticeCard } from '../components/PublicNotice'

// PL-70: every SAMPLE_* URL in editor previews and test-sends points here —
// a test-send must never dead-end a human on raw JSON or a 404. Static on
// purpose: nothing to break.

export default function TestLinkPage() {
  return (
    <PublicNoticeCard title="This was a sample link">
      You clicked a link in a <strong>test email</strong> — in a real send, this button links the
      family to their own page (their registration, schedule, invoice, and so on). Nothing has
      happened, and there&apos;s nothing to do here. If you got this from a real email and expected
      it to work, just reply to that email and a real human will sort it out.
    </PublicNoticeCard>
  )
}
