import {
  loadApprovalEngagement,
  scheduleSummaryText,
  verifyScheduleApproveToken,
} from '../../../utils/schedule-approval'
import { loadContactInfo } from '../../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../../components/PublicNotice'
import ConfirmActions from './confirm-actions'

// PL-41: the signed-link target of T_SCHEDULE_CONFIRM — one tap to lock in
// the proposed schedule, or a note asking for different times. No login; the
// token is the authentication (house pattern).

export const dynamic = 'force-dynamic'

export default async function ConfirmSchedulePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const engagementId = verifyScheduleApproveToken(token)
  const contact = await loadContactInfo()

  const invalid = (
    <PublicNoticeCard title="We couldn't open that link">
      It may be out of date. Email {contact.email}{' or call '}
      {contact.phone}{' and '}we&apos;ll sort out the schedule together.
    </PublicNoticeCard>
  )
  if (!engagementId) return invalid

  const e = await loadApprovalEngagement(engagementId)
  if (!e) return invalid

  const alreadyActive = e.status === 'active'
  const summary = scheduleSummaryText(e)

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
          <h1 className="text-2xl font-bold text-hgl-slate mb-1">
            {e.studentFirst}&apos;s tutoring schedule
          </h1>
          <p className="text-sm text-gray-500 mb-5">
            1-on-1 {e.subjectName} with {e.tutorName}
          </p>
          <div className="border border-gray-200 bg-gray-50 rounded-lg p-4 text-hgl-slate font-semibold mb-6">
            {summary}
          </div>
          {alreadyActive ? (
            <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
              <strong>This schedule is confirmed — you&apos;re all set.</strong> The details and
              calendar links are in your welcome email, and everything is in your parent portal.
            </div>
          ) : e.status !== 'pending_parent_confirmation' ? (
            <div className="p-4 rounded bg-gray-50 border border-gray-200 text-gray-700 text-sm">
              This schedule isn&apos;t awaiting confirmation anymore — if anything looks off,
              just reach out and we&apos;ll straighten it out.
            </div>
          ) : (
            <ConfirmActions token={token} studentFirst={e.studentFirst} />
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-gray-600">
          Questions, or want different times? Email{' '}
          <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
            {contact.email}
          </a>{' '}
          or give us a call at <strong>{contact.phone}</strong>
          {' — '}we&apos;re happy to adjust before anything&apos;s set.
        </div>
      </div>
    </div>
  )
}
