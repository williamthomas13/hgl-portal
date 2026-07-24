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

// ---------------------------------------------------------------------------
// PL-155b — CUTOVER RUNBOOK, READ BEFORE MOVING TO THE CUSTOM DOMAIN
// ---------------------------------------------------------------------------
// The rule below treats EVERY *.vercel.app host as non-production, which is
// correct today only because PRODUCTION_ORIGIN is itself a vercel.app host
// and gets an exact-match pass one line down.
//
// The day the custom domain lands and PRODUCTION_BASE_URL becomes
// https://portal.highergroundlearning.com, the OLD host stops matching and
// every live template that still carries an hgl-portal.vercel.app link —
// registry bodies Scarlett published, stored collateral, anything composed
// before the switch — starts REFUSING TO SEND. Silently, per send, with an
// admin alert each time.
//
// So the cutover is two steps, in this order:
//   1. Set ADDITIONAL_PRODUCTION_HOSTS=hgl-portal.vercel.app in Vercel.
//   2. Then set PRODUCTION_BASE_URL to the custom domain.
// Leave step 1 in place until a sweep of the registry confirms no live
// template body still references the old host; only then remove it.
const EXTRA_PRODUCTION_HOSTS = (process.env.ADDITIONAL_PRODUCTION_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)

function isNonProductionHost(rawHost: string): boolean {
  const h = rawHost.toLowerCase()
  const prodHost = new URL(PRODUCTION_ORIGIN).host.toLowerCase()
  if (h === prodHost) return false
  // PL-155b: hosts explicitly grandfathered in for the domain cutover.
  if (EXTRA_PRODUCTION_HOSTS.includes(h) || EXTRA_PRODUCTION_HOSTS.includes(h.replace(/:\d+$/, '')))
    return false
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
