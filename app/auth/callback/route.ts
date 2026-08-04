import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../utils/supabase-server'
import { supabaseAdmin } from '../../utils/supabase-admin'
import { safeNextPath } from '../../utils/portal-auth'
import { escapeLike } from '../../utils/like-escape'

// PL-272: Google Workspace SSO landing (staff + tutors only). The browser's
// signInWithOAuth sends staff through Google and back here with a PKCE code;
// the exchange sets the cookie session, and THEN the gate runs:
//
//   allowed = @highergroundlearning.com email
//             AND (active instructors row OR profiles.role admin/manager)
//
// Anyone else — personal Gmail, a former employee whose Workspace account is
// gone, a Workspace address with no portal record — is signed straight back
// out with a plain-English message. Families and counselors never come
// through here; magic-link stays their only path.
//
// Offboarding: removing someone's Workspace account blocks every FUTURE
// Google sign-in (they can't complete OAuth). Live sessions keep dying the
// way they already do — every staff/instructor surface re-checks
// profiles.role / instructors.active per request (PL-213/PL-208 gates), so
// flipping "active" off in Team access remains the immediate kill switch.

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNextPath(url.searchParams.get('next'))

  const fail = (reason: 'sso' | 'sso_denied') => {
    const login = new URL('/login', url.origin)
    login.searchParams.set('error', reason)
    if (next) login.searchParams.set('next', next)
    return NextResponse.redirect(login)
  }

  if (!code) return fail('sso')

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user?.email) return fail('sso')
  const email = data.user.email.toLowerCase()

  let allowed = false
  let role: string | null = null
  if (email.endsWith('@highergroundlearning.com')) {
    const [{ data: inst }, { data: prof }] = await Promise.all([
      supabaseAdmin
        .from('instructors')
        .select('id')
        .ilike('email', escapeLike(email))
        .eq('active', true)
        .maybeSingle(),
      supabaseAdmin.from('profiles').select('role').eq('id', data.user.id).maybeSingle(),
    ])
    role = prof?.role ?? null
    allowed = Boolean(inst) || role === 'admin' || role === 'manager'
  }

  if (!allowed) {
    await supabase.auth.signOut()
    return fail('sso_denied')
  }

  const dest = next ?? (role === 'admin' || role === 'manager' ? '/admin' : '/portal')
  return NextResponse.redirect(new URL(dest, url.origin))
}
