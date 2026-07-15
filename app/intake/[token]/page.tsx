import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyIntakeToken } from '../../utils/intake'
import { loadContactInfo } from '../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../components/PublicNotice'
import IntakeForm, { type IntakePrefill } from './intake-form'

// Public intake form (Phase 7e, docs/PHASE7_SPEC.md §11) — the signed-link
// target of T7. The doctor's-office replacement for the Google Forms blanks:
// open the link, tap through one page, done. No login; the token (HMAC over
// the lead id) is the authentication, and submission goes through the
// service-role /api/intake route.

export const dynamic = 'force-dynamic'

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const leadId = verifyIntakeToken(token)
  const contact = await loadContactInfo()

  const notFound = (
    <PublicNoticeCard title="We couldn't open that form">
      The link may be out of date. Email {contact.email} or call {contact.phone} and we&apos;ll
      send you a fresh one — or just take your answers over the phone.
    </PublicNoticeCard>
  )
  if (!leadId) return notFound

  const { data: lead } = await supabase
    .from('leads')
    .select(
      `id, status, contact_name, contact_email, contact_phone, student_name,
       student_school, student_grade, interest, subjects, test_date, prior_scores,
       availability_text, online_preference, intake_completed_at`
    )
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return notFound

  const alreadyDone = Boolean(lead.intake_completed_at)

  // Prefill from what the Ops Director already captured — the family never
  // re-types what HGL already knows.
  const [studentFirst, ...studentRest] = (lead.student_name ?? '').trim().split(/\s+/)
  const [contactFirst, ...contactRest] = (lead.contact_name ?? '').trim().split(/\s+/)
  const prefill: IntakePrefill = {
    studentFirst: studentFirst ?? '',
    studentLast: studentRest.join(' '),
    school: lead.student_school ?? '',
    grade: lead.student_grade ?? '',
    guardianFirst: contactFirst ?? '',
    guardianLast: contactRest.join(' '),
    guardianEmail: lead.contact_email ?? '',
    guardianPhone: lead.contact_phone ?? '',
    interest: lead.interest === 'subject' ? 'subject' : 'test_prep',
    subjects: lead.subjects ?? '',
    testDate: lead.test_date ?? '',
    priorScores: lead.prior_scores ?? '',
    availabilityText: lead.availability_text ?? '',
    onlinePreference: lead.online_preference ?? '',
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
          <h1 className="text-2xl font-bold text-hgl-slate mb-1">
            Higher Ground Learning — student intake
          </h1>
          {alreadyDone ? (
            <div className="mt-4 p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
              <strong>We already have your answers — thank you!</strong> Nothing more to do
              here. If something has changed, email {contact.email} or call {contact.phone} and
              we&apos;ll update it for you.
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-6">
                About five minutes, all on this page. Skip anything that doesn&apos;t apply —
                and if a phone call is easier, that works exactly as well.
              </p>
              <IntakeForm token={token} prefill={prefill} />
            </>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-gray-600">
          Questions, or prefer to do this by phone? Email{' '}
          <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
            {contact.email}
          </a>{' '}
          or give us a call at <strong>{contact.phone}</strong> — we&apos;ll take your answers
          directly.
        </div>
      </div>
    </div>
  )
}
