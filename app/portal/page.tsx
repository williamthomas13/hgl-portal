import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '../utils/supabase-server'
import ParentView from './parent-view'
import CounselorView from './counselor-view'
import InstructorView from './instructor-view'
import SignOutButton from './signout-button'

// The Phase 4 portal (docs/PHASE4_SPEC.md §3–§5). One route, three views —
// parent / counselor / instructor — picked by the roles this email actually
// holds in the data. RLS scopes every query by the JWT email claim, so a
// multi-role user sees the union of their scopes regardless of which view is
// active: the switcher is pure navigation, not privilege.
export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

type ViewName = 'parent' | 'counselor' | 'instructor'
const VIEW_LABELS: Record<ViewName, string> = {
  parent: 'My students',
  counselor: 'My school',
  instructor: 'My classes',
}

export default async function PortalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login?next=/portal')
  const email = user.email.toLowerCase()

  // Which hats does this email wear? All four lookups run as the signed-in
  // user. Each is filtered by the email linkage explicitly — staff can read
  // every row under RLS, so "any visible row" would misdetect roles for them.
  const [families, counselorRows, taughtClasses, profile] = await Promise.all([
    supabase.from('families').select('id').ilike('parent_email', email).limit(1),
    supabase
      .from('school_affiliations')
      .select('id, contacts!inner(email)')
      .is('ended_at', null)
      .ilike('contacts.email', email)
      .limit(1),
    supabase.from('classes').select('id').ilike('instructor_email', email).limit(1),
    supabase.from('profiles').select('role').eq('id', user.id).single(),
  ])

  const views: ViewName[] = []
  if (taughtClasses.data?.length) views.push('instructor')
  if (counselorRows.data?.length) views.push('counselor')
  if (families.data?.length) views.push('parent')
  const isStaff = profile.data?.role === 'admin' || profile.data?.role === 'manager'

  // Staff with no portal-facing role belong in /admin.
  if (views.length === 0 && isStaff) redirect('/admin')

  const highlightEnrollment = first(sp.enrollment)
  const requested = first(sp.view) as ViewName | undefined
  // A #0 deep link always means the parent view.
  const active: ViewName | undefined =
    requested && views.includes(requested)
      ? requested
      : highlightEnrollment && views.includes('parent')
        ? 'parent'
        : views[0]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-hgl-slate">Higher Ground Learning</h1>
            <p className="text-xs text-gray-400">{email}</p>
          </div>
          <div className="flex items-center gap-3">
            {views.length > 1 && (
              <nav className="flex gap-1 bg-gray-100 rounded-full p-1">
                {views.map((v) => (
                  <Link
                    key={v}
                    href={`/portal?view=${v}`}
                    className={`text-xs font-bold rounded-full px-3 py-1.5 transition ${
                      v === active
                        ? 'bg-hgl-blue text-white'
                        : 'text-gray-500 hover:text-hgl-slate'
                    }`}
                  >
                    {VIEW_LABELS[v]}
                  </Link>
                ))}
              </nav>
            )}
            {isStaff && (
              <Link href="/admin" className="text-xs font-bold text-hgl-blue hover:underline">
                Admin →
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {active === 'parent' && (
          <ParentView supabase={supabase} email={email} highlightEnrollment={highlightEnrollment} />
        )}
        {active === 'counselor' && <CounselorView supabase={supabase} email={email} />}
        {active === 'instructor' && <InstructorView supabase={supabase} email={email} />}
        {!active && (
          <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8 text-center">
            <h2 className="text-lg font-bold text-hgl-slate mb-2">Nothing here yet</h2>
            <p className="text-gray-600 text-sm">
              We couldn&apos;t find any students, classes, or school records linked to{' '}
              <strong>{email}</strong>. If you registered with a different email, sign in with
              that one — or reply to any of our emails and we&apos;ll sort it out.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
