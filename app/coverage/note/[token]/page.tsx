import { coverageNoteContext, verifyCoverageNoteToken } from '../../../utils/coverage'
import { loadContactInfo } from '../../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../../components/PublicNotice'
import CoverageNoteForm from './coverage-note-form'

// PL-156: the tokenized one-box form behind the "Send {subFirstName} a note"
// button in SUB_COVERAGE_RESULT's accepted variant. One text box, one send —
// the note goes to the substitute AND onto the coverage handoff, so context
// said once sits with the handoff it belongs to.
//
// The email carries the BUTTON, never the action: nothing sends on GET, so a
// mail scanner or link prefetcher can never fire a note (the PL-62 rule).

export const dynamic = 'force-dynamic'

export default async function CoverageNotePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const contact = await loadContactInfo()
  const verified = verifyCoverageNoteToken(token)

  // PL-149: an aged-out link says so plainly instead of reading as broken.
  if (verified === 'expired') {
    return (
      <PublicNoticeCard title="This link has aged out">
        Links in our emails retire themselves after a while. If that session is still coming up,
        open your portal and message the team — or write to {contact.email} and we&apos;ll pass
        your note along.
      </PublicNoticeCard>
    )
  }
  if (verified === 'invalid') {
    return (
      <PublicNoticeCard title="We couldn't open that link">
        It may be incomplete — email apps sometimes trim long links. Try the button in the
        original email again, or write to {contact.email} and we&apos;ll take care of it.
      </PublicNoticeCard>
    )
  }

  const context = await coverageNoteContext(verified.id)
  if (!context) {
    return (
      <PublicNoticeCard title="There's nobody to hand this to">
        That coverage request wasn&apos;t accepted, so no substitute is taking the session. If it
        still needs cover, pick another colleague from your portal.
      </PublicNoticeCard>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
        <h1 className="text-2xl font-bold text-hgl-slate mb-1">
          Send {context.subFirstName} a note
        </h1>
        <p className="text-sm text-gray-500 mb-5">
          {context.subFirstName} is covering {context.studentFirst}&apos;s {context.subjectName}{' '}
          session on {context.when}. Anything you write here goes straight to them and is saved
          with the handoff, so they have it when they prepare.
        </p>
        <CoverageNoteForm
          token={token}
          subFirstName={context.subFirstName}
          studentFirst={context.studentFirst}
          alreadySent={context.alreadySent}
        />
      </div>
    </div>
  )
}
