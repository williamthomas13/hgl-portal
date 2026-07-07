import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../utils/supabase-server'
import { safeNextPath } from '../../utils/portal-auth'

// Passwordless login, step 2: the magic-link target. Verifies the hashed
// token from the login email and sets the cookie session, then forwards to
// `next` (validated: same-site paths only). Expired/consumed links bounce
// back to /login with a hint to use the 6-digit code instead — that's the
// whole reason the code exists (PHASE4_SPEC §2: district link-scanners).

export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const next = safeNextPath(url.searchParams.get('next')) ?? '/portal'

  if (tokenHash) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash })
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
  }

  const login = new URL('/login', url.origin)
  login.searchParams.set('error', 'link')
  login.searchParams.set('next', next)
  return NextResponse.redirect(login)
}
