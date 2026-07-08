import { createSupabaseServerClient } from './supabase-server'

// Cookie-session role gate for API routes (same rule as /admin's layout and
// the cancel-class route). Returns null when the caller isn't signed in or
// doesn't hold a qualifying role — routes turn that into 401/403.
//
// 'admin' is ownership-level (Phase 6 spec §6: QBO connect/disconnect and the
// item mapping are admin-only; managers have no access). 'staff' admits
// admin AND manager (ops actions like retrying a sync).
export async function sessionRole(
  required: 'admin' | 'staff'
): Promise<{ email: string; role: 'admin' | 'manager' } | null> {
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) return null
  const { data: profile } = await session
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = profile?.role
  if (role !== 'admin' && role !== 'manager') return null
  if (required === 'admin' && role !== 'admin') return null
  return { email: user.email, role }
}
