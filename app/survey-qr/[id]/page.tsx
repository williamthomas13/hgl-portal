import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '../../utils/supabase-server'
import { canViewClassReport } from '../../utils/class-report'
import { classSurveyUrl } from '../../utils/survey'
import { qrDataUrl } from '../../utils/collateral-render'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'

// PL-219 v1.5: the projectable survey QR — full-screen, made for the last
// ten minutes of the final session. Instructor (own class) and staff only;
// responses through this code are anonymous by structure.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export default async function SurveyQrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) redirect(`/login?next=/survey-qr/${id}`)
  const viewer = await canViewClassReport(user.email, id)
  if (!viewer || viewer === 'counselor') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <p className="bg-white rounded-lg border p-6 text-gray-600">Not available for this account.</p>
      </div>
    )
  }

  const { data: cls } = await supabase
    .from('classes')
    .select('class_type, schools ( nickname, name )')
    .eq('id', id)
    .maybeSingle()
  const school = one<any>(cls?.schools)
  const label = cls ? `${school?.nickname ?? school?.name ?? 'HGL'} ${cls.class_type}` : 'this class'

  const url = classSurveyUrl(id)
  const qr = await qrDataUrl(url)

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-3xl sm:text-5xl font-bold text-hgl-slate mb-2">
        How was the {label} class?
      </h1>
      <p className="text-lg sm:text-2xl text-gray-500 mb-8">
        Scan to answer — 2 minutes, anonymous.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="Survey QR code" className="w-72 h-72 sm:w-96 sm:h-96" />
      <p className="mt-8 text-base sm:text-xl text-gray-600 break-all max-w-2xl">{url}</p>
    </div>
  )
}
