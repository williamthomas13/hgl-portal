import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyRefundToken } from '../../utils/lifecycle'
import { loadContactInfo } from '../../utils/tutoring-emails'
import RefundConfirm from './refund-confirm'

// PL-128: the tokenized refund-request page (house HMAC pattern, like
// /convert). GET is side-effect free — the confirm button POSTs the stamp.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export default async function RefundRequestPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { id } = await params
  const sp = await searchParams
  const token = typeof sp.t === 'string' ? sp.t : ''

  const shell = (inner: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-slate">
        <h1 className="text-2xl font-bold text-hgl-slate mb-4">Refund request</h1>
        {inner}
      </div>
    </div>
  )

  if (!token || !verifyRefundToken(id, token)) {
    return shell(
      <p className="text-gray-700">
        This link is no longer valid. If you meant to request a refund, just reply to our
        cancellation email and we&apos;ll take care of it.
      </p>
    )
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select(
      `id, payment_status, class_cancelled, refund_requested_at, converted_to_tutoring_at,
       students ( first_name ),
       classes ( class_type, schools ( nickname ) ),
       enrollment_addons ( hours, source )`
    )
    .eq('id', id)
    .maybeSingle()
  if (!enrollment || !enrollment.class_cancelled) {
    return shell(
      <p className="text-gray-700">
        This link is no longer valid. If you meant to request a refund, just reply to our
        cancellation email and we&apos;ll take care of it.
      </p>
    )
  }

  const student = one<any>(enrollment.students)
  const cls = one<any>(enrollment.classes)
  const addonHours = ((enrollment.enrollment_addons as any[]) ?? [])
    .filter((a) => a.source !== 'cancellation_conversion')
    .reduce((s, a) => s + Number(a.hours ?? 0), 0)
  const contact = await loadContactInfo()
  const initialState =
    enrollment.payment_status === 'Refunded'
      ? ('already_refunded' as const)
      : enrollment.converted_to_tutoring_at
        ? ('already_converted' as const)
        : enrollment.refund_requested_at
          ? ('already_requested' as const)
          : ('ready' as const)

  return shell(
    <RefundConfirm
      enrollmentId={id}
      token={token}
      studentFirst={student?.first_name ?? 'your student'}
      classLabel={`${one<any>(cls?.schools)?.nickname ?? 'HGL'} ${cls?.class_type ?? 'class'}`}
      addonHours={addonHours}
      contactEmail={contact.email}
      initialState={initialState}
    />
  )
}
