import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyClassroomRequestToken } from '../../utils/lifecycle'
import RequestForm from './request-form'
import { formatDateOnly } from '../../utils/dates'

// The classroom-request form (PHASE4_SPEC §4b): one question, tokenized, no
// login. Server component validates the token and loads the class; the tiny
// client form posts to /api/classroom-request.
export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-10">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        {children}
      </div>
    </div>
  )
}

export default async function ClassroomRequestPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { id } = await params
  const sp = await searchParams
  const token = first(sp.t) ?? ''
  const counselorEmail = first(sp.ce) ?? ''

  if (!verifyClassroomRequestToken(id, token)) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-hgl-slate mb-2">Link not valid</h1>
        <p className="text-sm text-gray-600">
          This link looks incomplete — try the button in the email again, or just reply to the
          email with the room and we&apos;ll take it from there.
        </p>
      </Shell>
    )
  }

  const { data: cls } = await supabase
    .from('classes')
    .select('id, class_type, start_date, default_location, schools ( name, nickname ), sessions ( session_date )')
    .eq('id', id)
    .single()

  if (!cls) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-hgl-slate mb-2">Class not found</h1>
        <p className="text-sm text-gray-600">This class no longer exists — nothing to do here.</p>
      </Shell>
    )
  }

  const school = Array.isArray(cls.schools) ? cls.schools[0] : cls.schools
  const nickname = (school as { nickname?: string } | null)?.nickname ?? 'HGL'
  const label = `${nickname} ${cls.class_type}`
  const firstSession =
    [...((cls.sessions as { session_date: string }[]) ?? []).map((s) => s.session_date)].sort()[0] ??
    cls.start_date

  return (
    <Shell>
      <h1 className="text-xl font-bold text-hgl-slate mb-1">Where will {label} be held?</h1>
      <p className="text-sm text-gray-500 mb-6">
        First session:{' '}
        {formatDateOnly(firstSession, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
      {cls.default_location ? (
        <p className="text-sm bg-green-50 text-green-800 rounded p-3">
          All set — the location is already recorded as{' '}
          <strong>{cls.default_location}</strong>. If that&apos;s wrong, reply to our email and
          we&apos;ll fix it.
        </p>
      ) : (
        <RequestForm classId={cls.id} token={token} counselorEmail={counselorEmail} />
      )}
    </Shell>
  )
}
