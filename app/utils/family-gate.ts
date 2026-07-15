import { createSupabaseServerClient } from './supabase-server'
import { supabaseAdmin } from './supabase-admin'

// Cookie-session parent gate for API routes (Phase 7d) — the family-side
// sibling of staff-gate/tutor-gate. Identity is the signed-in email matching
// families.parent_email (the Phase 3 linkage the RLS helpers use). Routes
// verify row ownership against familyIds before any write.
export async function sessionFamily(): Promise<{ email: string; familyIds: string[] } | null> {
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) return null
  const { data } = await supabaseAdmin
    .from('families')
    .select('id')
    .ilike('parent_email', user.email)
  if (!data || data.length === 0) return null
  return { email: user.email.toLowerCase(), familyIds: data.map((r) => r.id) }
}
