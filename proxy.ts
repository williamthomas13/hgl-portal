import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Session-refreshing auth gate (Next 16 renamed `middleware` to `proxy`).
// Scope is deliberately narrow: only /admin, /portal, and /login carry auth
// sessions. Public pages, API routes, webhooks, and cron are untouched.
//
// This only checks "signed in?" — role checks need DB reads and live in
// app/admin/layout.tsx and app/portal/page.tsx. Signed-out visitors bounce to
// /login carrying the full original URL (path + query) as `next`, so deep
// links like /portal?enrollment=…&pe=…&pt=… survive the round trip.

/** Same-site relative paths only (mirrors portal-auth's safeNextPath). */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null
  return next
}
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the JWT against Supabase (and refreshes expired
  // sessions via the cookie callbacks above) — never trust getSession() here.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  if (!user && (path.startsWith('/admin') || path.startsWith('/portal'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }
  if (user && path === '/login') {
    const url = request.nextUrl.clone()
    const next = safeNext(request.nextUrl.searchParams.get('next'))
    // Staff-only accounts get bounced onward from /portal to /admin by the
    // portal page (it knows the roles; the proxy doesn't).
    url.pathname = '/portal'
    url.search = ''
    if (next) {
      const q = next.indexOf('?')
      url.pathname = q === -1 ? next : next.slice(0, q)
      url.search = q === -1 ? '' : next.slice(q)
    }
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*', '/portal/:path*', '/login'],
}
