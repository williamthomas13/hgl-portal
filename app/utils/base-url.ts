// PL-87: the one base-URL policy for anything that lands in an email (or
// print collateral). Root cause of the sighting: a dev-machine real send
// composed its links from the dev origin (NEXT_PUBLIC_APP_URL =
// localhost:3000), and the PL-60 dead-href tripwire didn't fire because the
// href wasn't empty — just wrong. Two layers fix it for good:
//
//   1. emailBaseUrl() — composition PINS the production origin whenever the
//      configured origin is non-production, so a dev-machine real send
//      composes correct links before any guard runs. (Dev and prod share
//      one Supabase project and signing secret, so pinned links work.)
//   2. nonProductionOrigins() — sendOnce scans outgoing HTML on every real
//      (non-test) send and REFUSES to ship localhost/127.x/ngrok/preview
//      origins, alerting the Ops Director. ALLOW_REAL_EMAILS does not
//      bypass the refusal.

export const PRODUCTION_ORIGIN = (
  process.env.PRODUCTION_BASE_URL ?? 'https://hgl-portal.vercel.app'
).replace(/\/+$/, '')

function isNonProductionHost(rawHost: string): boolean {
  const h = rawHost.toLowerCase()
  const prodHost = new URL(PRODUCTION_ORIGIN).host.toLowerCase()
  if (h === prodHost) return false
  const bare = h.replace(/:\d+$/, '')
  if (bare === 'localhost' || bare === '0.0.0.0' || bare === '[::1]' || bare === '::1') return true
  if (/^(127\.|10\.\d|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(bare)) return true
  if (bare.includes('ngrok')) return true
  if (bare.endsWith('.local')) return true
  // Any OTHER deployment of this app (vercel preview/branch URLs) is
  // non-production too.
  if (bare.endsWith('.vercel.app')) return true
  return false
}

/** The base URL for composing email/collateral links: the configured origin
 *  when it's a production one, the pinned production origin otherwise. */
export function emailBaseUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  if (configured) {
    try {
      if (!isNonProductionHost(new URL(configured).host)) return configured
    } catch {
      /* malformed configured origin → pin */
    }
  }
  return PRODUCTION_ORIGIN
}

/** Distinct non-production hosts found in absolute URLs inside `html`.
 *  URL-based on purpose: an admin alert can then QUOTE an offending host as
 *  plain text (no scheme) without tripping the guard on itself. */
export function nonProductionOrigins(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
    try {
      const host = new URL(m[0].replace(/&amp;/g, '&')).host
      if (isNonProductionHost(host)) found.add(host)
    } catch {
      /* unparseable pseudo-URL — PL-60's dead-href check owns that class */
    }
  }
  return [...found]
}
