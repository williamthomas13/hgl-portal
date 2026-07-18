import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyAvailabilityToken } from '../../utils/intake'
import { loadContactInfo } from '../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../components/PublicNotice'
import AvailabilityShareForm from './availability-share-form'

// PL-53b: the add-on family's "share your availability" page — the
// {availabilityLink} in the #0 confirmation and the #8 scheduling fork.
// Family-scoped signed token, no login; the same grid component used on
// intake and in the wizard. Reusable and idempotent: coming back shows what
// we have, editable; re-submitting replaces it.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const familyId = verifyAvailabilityToken(token)
  const contact = await loadContactInfo()

  const invalid = (
    <PublicNoticeCard title="We couldn't open that link">
      It may be out of date. Email {contact.email}{' or call '}
      {contact.phone}{' and '}we&apos;ll take your availability over the phone — that works
      exactly as well.
    </PublicNoticeCard>
  )
  if (!familyId) return invalid

  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name, student_availability ( weekday, start_time, end_time, timezone )')
    .eq('family_id', familyId)
    .order('first_name')
  if (!students || students.length === 0) return invalid

  const initial = (students as any[]).map((s) => ({
    id: s.id,
    firstName: s.first_name,
    ranges: (s.student_availability ?? []).map((r: any) => ({
      weekday: r.weekday,
      start_time: String(r.start_time).slice(0, 5),
      end_time: String(r.end_time).slice(0, 5),
    })),
    timezone: s.student_availability?.[0]?.timezone ?? null,
  }))
  const anyOnFile = initial.some((s) => s.ranges.length > 0)

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
          <h1 className="text-2xl font-bold text-hgl-slate mb-1">
            When works for 1-on-1 tutoring?
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            {anyOnFile
              ? 'We already have your availability — thank you! Feel free to adjust it below and re-save; we always use the latest version.'
              : 'Rough is fine — tell us the windows that usually work and we’ll propose exact times. Takes about a minute.'}
          </p>
          <AvailabilityShareForm token={token} students={initial} />
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-gray-600">
          Rather just tell a person? Email{' '}
          <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
            {contact.email}
          </a>{' '}
          or give us a call at <strong>{contact.phone}</strong>
          {' — '}we&apos;ll take it from there.
        </div>
      </div>
    </div>
  )
}
