import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifySurveyToken } from '../../utils/survey'
import { loadContactInfo } from '../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../components/PublicNotice'
import SurveyForm from './survey-form'

// PL-219 v1.5: the survey page — one form, two entrances.
// Context is NEVER asked: the token identifies the class (and, on the email
// link, the student), so there are no school/instructor/which-class
// questions and no SAT/ACT branching to click through. The in-class token is
// anonymous by structure — no name picking exists on that channel.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const info = verifySurveyToken(token)
  const contact = await loadContactInfo()

  if (info === 'expired') {
    return (
      <PublicNoticeCard title="This survey link has aged out">
        The class wrapped up a while back. If you&apos;d still like to share feedback, just email{' '}
        {contact.email} — we read everything.
      </PublicNoticeCard>
    )
  }
  if (!info) {
    return (
      <PublicNoticeCard title="We couldn't open that link">
        It may have been trimmed by your email app. Email {contact.email} and we&apos;ll take your
        feedback directly.
      </PublicNoticeCard>
    )
  }

  let classId: string
  let studentFirst: string | null = null
  let alreadyResponded = false
  if (info.kind === 'class') {
    classId = info.classId
  } else {
    const { data: enr } = await supabase
      .from('enrollments')
      .select('class_id, survey_responded_at, students ( first_name )')
      .eq('id', info.enrollmentId)
      .maybeSingle()
    if (!enr) {
      return (
        <PublicNoticeCard title="We couldn't open that link">
          Email {contact.email} and we&apos;ll take your feedback directly.
        </PublicNoticeCard>
      )
    }
    classId = enr.class_id
    studentFirst = one<any>(enr.students)?.first_name ?? null
    alreadyResponded = enr.survey_responded_at != null
  }

  const { data: cls } = await supabase
    .from('classes')
    .select('class_type, instructors ( name ), schools ( nickname, name )')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) {
    return (
      <PublicNoticeCard title="We couldn't find that class">
        Email {contact.email} and we&apos;ll sort it out.
      </PublicNoticeCard>
    )
  }
  const school = one<any>(cls.schools)
  const label = `${school?.nickname ?? school?.name ?? 'HGL'} ${cls.class_type}`
  const instructorFirst = (one<any>(cls.instructors)?.name ?? '').split(' ')[0] || 'your instructor'

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8 max-w-lg w-full mt-8">
        <h1 className="text-xl font-bold text-hgl-slate mb-1">
          How was the {label} class{studentFirst ? `, ${studentFirst}` : ''}?
        </h1>
        <p className="text-sm text-gray-500 mb-5">
          Two minutes, four questions.{' '}
          {info.kind === 'class'
            ? 'This form is anonymous — we can’t see who submitted it.'
            : 'Prefer we not know it’s you? There’s an anonymous option at the bottom.'}
        </p>
        {alreadyResponded ? (
          <p className="text-sm text-green-700 font-semibold">
            We already have your feedback — thank you! (If you answered anonymously in class, this
            link stays closed so nobody counts twice.)
          </p>
        ) : (
          <SurveyForm token={token} channel={info.kind === 'class' ? 'in_class' : 'email'} instructorFirst={instructorFirst} />
        )}
      </div>
    </div>
  )
}
