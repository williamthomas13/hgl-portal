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
//
// CRON CADENCE (Billy, Jul 29 2026 — decided): the hourly sweep's PRIMARY
// home is Supabase pg_cron at :05 (PL-273, Aug 6); the Vercel cron in
// vercel.json is the second layer.
//   3. Flip vercel.json's cron schedule to "0 * * * *".   — DONE Sep 22 2026
//   4. Delete .github/workflows/hourly-sweep.yml (and the   (PL-475, Vercel
//      CRON_SECRET GitHub Actions secret with it).          Pro confirmed)
// The hourly assumption is load-bearing (PL-144 catch-up, failed-send
// flushing, PL-201 campaign resumes) — never relax it; move its home.
// Manual re-run: Vercel → Settings → Cron Jobs → Run, or
// `node scripts/run-sweep.mjs`.
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

// ---------------------------------------------------------------------------
// PL-474 — two hosts, one session (Scarlett's decision, Sep 21):
//   portal.highergroundlearning.com  = signed-in surfaces + every emailed link
//   hgl.co                           = the short PUBLIC front (/{code},
//                                      /{code}/register, /classes, /team,
//                                      /inquire; wildcard → main site)
// Both hosts serve the SAME deployment. What keeps a session on one host:
//   * proxy.ts 308s signed-in / auth / tokenized paths from the short host
//     to the canonical portal host (path + query preserved), so nobody ends
//     up with a session cookie on hgl.co;
//   * public routes on the portal host keep working — no redirect the other
//     way, so no loop;
//   * canonical / OG / sitemap / JSON-LD / embed "More info" URLs use
//     publicSiteOrigin() — hgl.co once PUBLIC_SHORT_ORIGIN is set (cutover
//     day), the portal origin until then (before the DNS flip hgl.co still
//     forwards to Squarespace, so a hgl.co canonical would be a lie).
// ---------------------------------------------------------------------------

/** The canonical portal host (signed-in surfaces). Override with
 *  PORTAL_CANONICAL_HOST; default = PRODUCTION_BASE_URL's host. */
export function canonicalPortalHost(): string {
  const configured = (process.env.PORTAL_CANONICAL_HOST ?? '').trim().toLowerCase()
  if (configured) return configured.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return new URL(PRODUCTION_ORIGIN).host.toLowerCase()
}

/** The short public hosts the proxy redirects signed-in paths AWAY from. */
export const SHORT_PUBLIC_HOSTS = (process.env.PUBLIC_SHORT_HOSTS ?? 'hgl.co,www.hgl.co')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)

/** The origin public pages are canonical on (sitemap, <link rel=canonical>,
 *  OG url, JSON-LD, embed links). PUBLIC_SHORT_ORIGIN (https://hgl.co) once
 *  the DNS flip has happened; the email base until then. */
export function publicSiteOrigin(): string {
  const configured = (process.env.PUBLIC_SHORT_ORIGIN ?? '').trim().replace(/\/+$/, '')
  if (configured) {
    try {
      new URL(configured)
      return configured
    } catch {
      /* malformed → fall through */
    }
  }
  return emailBaseUrl()
}

/** ONE reader for the app's own configured origin (Stripe return URLs, the
 *  QBO redirect URI, portal-internal absolute links). Was
 *  `process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'` in nine
 *  files — the cutover flips it in one place now. */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
}

/** Path prefixes that carry a session or a bearer token and therefore live
 *  ONLY on the canonical portal host. The proxy's matcher and the
 *  canonical-host gate both read this list. */
export const PORTAL_ONLY_PATH_PREFIXES = [
  '/admin',
  '/portal',
  '/login',
  '/auth',
  '/class-report',
  '/tutoring',
  '/intake',
  '/agreements',
  '/availability',
  '/survey',
  '/classroom-request',
  '/class-roster',
  '/addons',
  '/refund',
  '/coverage',
  '/convert',
  '/waitlist',
  '/unsubscribe',
  '/success',
  '/link-help',
  '/api/resume-payment',
  '/api/waitlist',
] as const

export function isPortalOnlyPath(pathname: string): boolean {
  const p = pathname.toLowerCase()
  return PORTAL_ONLY_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`) || (prefix === '/login' && p.startsWith('/login')))
}
