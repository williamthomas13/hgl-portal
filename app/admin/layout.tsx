import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '../utils/supabase-server'

// Server-side staff gate. The proxy already bounced signed-out visitors to
// /login; this adds the role check (needs a DB read) so a signed-in
// non-staff user — a Phase 4 parent, say — can't open /admin.
// Phase 3.1: admits admin AND manager. The manager badge is server-rendered
// so the role can't be trivially toggled client-side (defense in depth — RLS
// is the real barrier: role writes are admin-only, payment-history deletes
// are guarded in policy).
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS lets every user read their own profile row.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && profile?.role !== 'manager') redirect('/')

  return (
    <>
      {profile.role === 'manager' && (
        <div className="bg-hgl-slate text-white text-xs px-4 py-1.5 flex items-center justify-end gap-2">
          <span className="opacity-75">{user.email}</span>
          <span className="bg-white/20 rounded-full px-2 py-0.5 font-bold uppercase tracking-wide">
            Manager
          </span>
        </div>
      )}
      {children}
    </>
  )
}
