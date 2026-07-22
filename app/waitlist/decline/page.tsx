import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyDeclineToken } from '../../utils/lifecycle'
import { loadContactInfo } from '../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../components/PublicNotice'
import DeclineConfirm from './decline-confirm'

// PL-72: the W2 decline link lands HERE — a confirm page, never an action.
// Mail scanners follow GET links, so the release itself is a JS-executed
// POST behind one visible tap (same bot-safety pattern as the PL-62 one-tap
// confirm). Idempotent: a later visit shows the friendly already-done state.

export const dynamic = 'force-dynamic'

export default async function DeclinePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string }>
}) {
  const { e: enrollmentId, t: token } = await searchParams
  const contact = await loadContactInfo()

  if (!enrollmentId || !token || !verifyDeclineToken(enrollmentId, token)) {
    return (
      <PublicNoticeCard title="That link didn't work">
        The link looks incomplete or out of date. Try the button in the email again, or reply to
        the email and we&apos;ll take care of it — {contact.email} or {contact.phone}.
      </PublicNoticeCard>
    )
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select(
      `id, payment_status, waitlist_offer_sent_at, waitlist_declined_at,
       students ( first_name ),
       classes ( class_type, schools ( nickname ) )`
    )
    .eq('id', enrollmentId)
    .maybeSingle()
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const student: any = Array.isArray(enrollment?.students) ? enrollment?.students[0] : enrollment?.students
  const cls: any = Array.isArray(enrollment?.classes) ? enrollment?.classes[0] : enrollment?.classes
  const school: any = Array.isArray(cls?.schools) ? cls?.schools[0] : cls?.schools
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const classLabel = cls ? `${school?.nickname ?? 'HGL'} ${cls.class_type}` : 'the class'
  const studentFirst = student?.first_name ?? 'your student'

  if (!enrollment) {
    return (
      <PublicNoticeCard title="That link didn't work">
        We couldn&apos;t find this waitlist spot. Reply to any of our emails and we&apos;ll sort
        it out for you.
      </PublicNoticeCard>
    )
  }
  if (enrollment.waitlist_declined_at) {
    return (
      <PublicNoticeCard title="All set — the spot was released">
        You already let us know, and the spot passed to the next family. You&apos;re still on our
        list: the moment a new {classLabel} course opens, you&apos;ll be the first to hear.
        Nothing to do on your end.
      </PublicNoticeCard>
    )
  }
  if (enrollment.payment_status === 'Paid' || enrollment.payment_status === 'Completed') {
    return (
      <PublicNoticeCard title={`${studentFirst} is registered!`}>
        This spot was already claimed and paid — {studentFirst} is in the {classLabel} class.
        If your plans have changed, just reply to any of our emails and we&apos;ll help.
      </PublicNoticeCard>
    )
  }
  if (enrollment.payment_status !== 'Waitlisted' || !enrollment.waitlist_offer_sent_at) {
    return (
      <PublicNoticeCard title="This offer has ended">
        The offer window closed and the spot moved on. You&apos;re still on our interest list —
        when a future {classLabel} course opens, you&apos;ll hear from us first.
      </PublicNoticeCard>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        <h1 className="text-2xl font-bold text-hgl-slate mb-3">Release {studentFirst}&apos;s spot?</h1>
        <p className="text-gray-700 mb-2">
          We offered {studentFirst} a spot in the {classLabel} class. If your plans have changed,
          one tap below releases it to the next family in line right away — no charge, no hard
          feelings.
        </p>
        <p className="text-sm text-gray-500 mb-6">
          You&apos;ll stay on our list either way — the moment a new {classLabel} course opens,
          you&apos;ll be the first to hear.
        </p>
        <DeclineConfirm enrollmentId={enrollment.id} token={token} classLabel={classLabel} />
        <p className="text-xs text-gray-400 mt-6">
          Changed your mind about declining? Just close this page — the offer stays yours until
          the deadline in the email.
        </p>
      </div>
    </div>
  )
}
