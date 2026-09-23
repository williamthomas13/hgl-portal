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
// PL-498 — ONE canonical host (Scarlett's decision, Sep 23; revises PL-474):
//   portal.highergroundlearning.com  = canonical for EVERYTHING the app
//                                      serves — signed-in surfaces, emailed
//                                      links, AND the public pages (/classes,
//                                      /team, /inquire, /compass, /partner,
//                                      /{code}, /{code}/register, /c/{slug},
//                                      the embeds)
//   hgl.co / www.hgl.co              = a PURE redirector: every path 301/308s
//                                      to the same path on the portal host
//                                      (root → the main site; unknown paths
//                                      end on the main site via the wildcard)
// Why: hgl.co has no domain history — making it the public home would split
// the brand across two domains for search engines and LLM entity resolution,
// and every link that accrued there would have to migrate twice once the
// marketing site moves to the apex (after the Synap replacement). Printed
// codes keep working because hgl.co/{code} redirects. What keeps this honest:
//   * proxy.ts redirects EVERY short-host path (301 public GET, 308 for
//     portal-only / non-GET); the portal host is never redirected — no loop;
//   * canonical / OG / sitemap / JSON-LD / llms.txt / embed "More info" URLs
//     use publicSiteOrigin() = emailBaseUrl() = the portal host;
//     PUBLIC_SHORT_ORIGIN is RETIRED (never set it — if it is set, it is
//     ignored and logged once at boot).
// ---------------------------------------------------------------------------

/** The marketing site (Squarespace) — where the short host's root and every
 *  path the portal does not own end up. */
export const MAIN_SITE_ORIGIN = 'https://www.highergroundlearning.com'

/** The canonical portal host (signed-in surfaces). Override with
 *  PORTAL_CANONICAL_HOST; default = PRODUCTION_BASE_URL's host. */
export function canonicalPortalHost(): string {
  const configured = (process.env.PORTAL_CANONICAL_HOST ?? '').trim().toLowerCase()
  if (configured) return configured.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return new URL(PRODUCTION_ORIGIN).host.toLowerCase()
}

/** The short hosts the proxy redirects EVERY path away from (PL-498). */
export const SHORT_PUBLIC_HOSTS = (process.env.PUBLIC_SHORT_HOSTS ?? 'hgl.co,www.hgl.co')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)

// PL-498: a stale Vercel env can never resurrect hgl.co canonicals — the
// retired variable is ignored, and its presence is logged once per process.
const RETIRED_SHORT_ORIGIN = (process.env.PUBLIC_SHORT_ORIGIN ?? '').trim()
if (RETIRED_SHORT_ORIGIN) {
  console.warn(
    `[base-url] PUBLIC_SHORT_ORIGIN=${RETIRED_SHORT_ORIGIN} is set but was RETIRED by PL-498 — ignored. Public pages are canonical on the portal host (${emailBaseUrl()}). Remove the env var.`
  )
}

/** The origin public pages are canonical on (sitemap, <link rel=canonical>,
 *  OG url, JSON-LD, llms.txt, embed links) — the portal host, always
 *  (PL-498). Kept as its own function so the nine call sites read as what
 *  they are; it is emailBaseUrl() underneath. */
export function publicSiteOrigin(): string {
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
