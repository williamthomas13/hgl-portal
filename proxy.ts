import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { MAIN_SITE_ORIGIN, SHORT_PUBLIC_HOSTS, canonicalPortalHost, isPortalOnlyPath } from './app/utils/base-url'

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
  // PL-498 (Scarlett, Sep 23 — revises PL-474): hgl.co is a PURE redirector.
  // Nothing is ever served on the short host: every path 301s (public GET —
  // cacheable, passes link equity) or 308s (signed-in / auth / tokenized
  // paths, and any non-GET so a POST is never downgraded) to the SAME path +
  // query on the canonical portal host. The bare root keeps its standing 301
  // to the main site (next.config.ts fires first; this is the belt to that
  // brace). Paths the portal has no route for (hgl.co/sat) take two permanent
  // hops — here to the portal host, then the portal's /{code} → [...forward]
  // wildcard 301s them to the same path on the main site — because telling a
  // code from an unknown path needs a DB read this edge hop does not make.
  // The portal host is never redirected, so there is no loop.
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '')
  const path = request.nextUrl.pathname
  if (SHORT_PUBLIC_HOSTS.includes(host)) {
    if (path === '/') return NextResponse.redirect(MAIN_SITE_ORIGIN, 301)
    const target = `https://${canonicalPortalHost()}${path}${request.nextUrl.search}`
    const isGet = request.method === 'GET' || request.method === 'HEAD'
    return NextResponse.redirect(target, isPortalOnlyPath(path) || !isGet ? 308 : 301)
  }
  // Only the three session-gated prefixes need the auth round-trip; every
  // other matched path (tokenized family links) is here for the host rule
  // above and passes straight through.
  if (!(path.startsWith('/admin') || path.startsWith('/portal') || path === '/login')) {
    return NextResponse.next({ request })
  }
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
  // PL-498: the short-host rule applies to EVERY path, so the matcher is a
  // catch-all (Next's own static assets excepted). On the portal host the
  // early return above keeps every non-session path a no-op; only /admin,
  // /portal and /login pay for the auth round-trip. (PL-474's per-prefix list
  // is retired — the canonical-host gate now checks the catch-all instead.)
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
