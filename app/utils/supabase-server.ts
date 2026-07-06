import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Cookie-session Supabase client for server components and server actions.
// Runs as the signed-in user (RLS applies) — use supabase-admin for
// privileged server work instead.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookie writes are handled by
            // the proxy refreshing sessions, so this is safe to ignore.
          }
        },
      },
    }
  )
}
