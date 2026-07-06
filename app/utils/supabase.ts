import { createBrowserClient } from '@supabase/ssr'

// Browser Supabase client (anon key + the signed-in user's cookie session).
// Since Phase 3, anon has no RLS policies — every query through this client
// only returns rows the signed-in user's role is allowed to see. Public pages
// don't use it at all; they fetch sanitized payloads from /api/* routes.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
