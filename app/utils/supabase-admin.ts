import { createClient } from '@supabase/supabase-js'

// Server-only Supabase client using the service-role key, which bypasses RLS.
// Phase 3 locked every table down (anon has no policies), so all server code
// — API routes, webhooks, cron, email/lifecycle utils — must go through this.
// Never import from a client component: the key must not reach the browser.
if (typeof window !== 'undefined') {
  throw new Error('supabase-admin was imported in browser code')
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
