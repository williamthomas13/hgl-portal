import { createSupabaseServerClient } from './supabase-server'
import { supabaseAdmin } from './supabase-admin'

// Cookie-session tutor gate for API routes (Phase 7b) — the tutor-side
// sibling of staff-gate. Tutors are instructors: identity is the signed-in
// email matching an instructors row (same linkage the RLS helpers use).
// Routes verify row ownership against instructorIds before any write.
export async function sessionTutor(): Promise<{ email: string; instructorIds: string[] } | null> {
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) return null
  const { data } = await supabaseAdmin
    .from('instructors')
    .select('id')
    .ilike('email', user.email)
  if (!data || data.length === 0) return null
  return { email: user.email.toLowerCase(), instructorIds: data.map((r) => r.id) }
}
