import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyConvertToken } from '../../utils/lifecycle'
import { availabilityToken } from '../../utils/intake'
import { loadConversionRecord } from '../../utils/convert-tutoring'
import { loadContactInfo } from '../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../components/PublicNotice'
import ConvertConfirm from './convert-confirm'

// PL-86: the self-serve conversion page — CX_FAMILY's tutoring-option button
// lands here. States the persisted PL-84 terms plainly, converts only on a
// JS-executed POST behind one visible tap (a mail prefetcher can never
// convert a family), and on confirm the SAME page becomes the availability
// grid — one continuous flow, no interstitial email. Revisits (and the
// Kelsie-converted-first case) show the friendly already-done state with the
// grid right there.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ConvertPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { id } = await params
  const { t } = await searchParams
  const contact = await loadContactInfo()

  const invalid = (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <PublicNoticeCard title="We couldn't open that link">
          It may be out of date. Email {contact.email}{' or call '}
          {contact.phone}{' and '}we&apos;ll set everything up together — that works exactly as
          well.
        </PublicNoticeCard>
      </div>
    </div>
  )
  if (!id || !t || !verifyConvertToken(id, t)) return invalid

  const record = await loadConversionRecord(id)
  if ('error' in record) return invalid

  // The inline availability grid's data (the existing /availability
  // component, embedded — the confirm swaps straight into it).
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name, student_availability ( weekday, start_time, end_time, timezone )')
    .eq('family_id', record.family.id)
    .order('first_name')
  const grid = ((students as any[]) ?? []).map((s) => ({
    id: s.id,
    firstName: s.first_name,
    ranges: (s.student_availability ?? []).map((r: any) => ({
      weekday: r.weekday,
      start_time: String(r.start_time).slice(0, 5),
      end_time: String(r.end_time).slice(0, 5),
    })),
    timezone: s.student_availability?.[0]?.timezone ?? null,
  }))

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <ConvertConfirm
          enrollmentId={id}
          token={t}
          studentFirst={record.student.first_name}
          classLabel={record.classLabel}
          offerHours={record.offerHours}
          creditAmount={record.creditAmount}
          alreadyConverted={record.alreadyConverted}
          availabilityToken={availabilityToken(record.family.id)}
          students={grid}
        />
        <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-gray-600">
          Prefer to talk it through? Email{' '}
          <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
            {contact.email}
          </a>{' '}
          or call {contact.phone} — replying to the cancellation email works too.
        </div>
      </div>
    </div>
  )
}
