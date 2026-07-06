import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '../utils/supabase-server'

// Server-side admin gate. The proxy already bounced signed-out visitors to
// /login; this adds the role check (needs a DB read) so a signed-in
// non-admin — a Phase 4 parent, say — can't open /admin.
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
  if (profile?.role !== 'admin') redirect('/')

  return <>{children}</>
}
