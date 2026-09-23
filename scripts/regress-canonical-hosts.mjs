#!/usr/bin/env node
// PL-474 → PL-498 gate: ONE canonical host; hgl.co is a pure redirector.
//   A. Static: proxy.ts's matcher is a catch-all (every short-host path must
//      hit the redirect rule); no file outside base-url.ts reads
//      NEXT_PUBLIC_APP_URL directly (the dev-detection read in email.ts is
//      the one allowed exception); no code literal of the old host remains
//      outside base-url.ts / comments; PUBLIC_SHORT_ORIGIN is read nowhere
//      but base-url.ts's retirement warning.
//   B. Against a RUNNING server (arg, default http://localhost:3100): with
//      Host: hgl.co every public path 301s and every portal-only path 308s to
//      the same path (+ query) on the canonical portal host; a POST 308s; the
//      root 301s to the main site; an unknown path reaches the main site via
//      the portal host (two permanent hops); NOTHING on hgl.co is ever 200.
//      With the portal host: every public page 200, canonical + OG + JSON-LD
//      url on the portal host (Organization.sameAs = the brand domain), the
//      sitemap + llms.txt list only the portal host, zero hgl.co in any of it.
//   node scripts/regress-canonical-hosts.mjs [base-url]
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

// PL-487: cleanup must never decide the exit code — a sandboxed shell cannot
// delete files (EPERM at the END of an otherwise successful run); warn and go on.
function safeRm(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.warn(`note: could not remove temp dir ${dir} (${e?.code ?? e}) — harmless, delete it by hand`)
  }
}


const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
Object.assign(process.env, env)
const base = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '')
let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }
const read = (f) => readFileSync(f, 'utf8')

// ---- A. static ---------------------------------------------------------------
const build = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-hosts-'))
let PORTAL_ONLY_PATH_PREFIXES, canonicalPortalHost, publicSiteOrigin, emailBaseUrl, SHORT_PUBLIC_HOSTS
try {
  execSync(`npx tsc app/utils/base-url.ts --outDir ${JSON.stringify(build)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`, { stdio: 'inherit' })
  // PUBLIC_SHORT_ORIGIN is set ON PURPOSE for the compile-and-call: the retired
  // variable must be ignored (and logged), never honoured.
  process.env.PUBLIC_SHORT_ORIGIN = 'https://hgl.co'
  ;({ PORTAL_ONLY_PATH_PREFIXES, canonicalPortalHost, publicSiteOrigin, emailBaseUrl, SHORT_PUBLIC_HOSTS } = createRequire(import.meta.url)(path.join(build, 'base-url.js')))
  delete process.env.PUBLIC_SHORT_ORIGIN
} finally { safeRm(build) }
const proxy = read('proxy.ts')
const matcher = [...proxy.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((p) => /^\/(?!\.)/.test(p))
// PL-498: a catch-all matcher covers every portal-only prefix by construction.
const catchAll = matcher.some((m) => /^\/\(\(\?!.*\)\.\*\)$/.test(m))
check('proxy matcher is a catch-all (every short-host path reaches the redirect rule)', catchAll, matcher.join(' '))
for (const prefix of PORTAL_ONLY_PATH_PREFIXES) {
  const covered = catchAll || matcher.some((m) => m === prefix || m === `${prefix}/:path*`)
  check(`proxy matcher covers ${prefix}`, covered)
}
check('proxy redirects EVERY short-host path (301 public GET / 308 portal-only + non-GET), root → main site', /SHORT_PUBLIC_HOSTS\.includes\(host\)\)\s*\{/.test(proxy) && /path === '\/'\) return NextResponse\.redirect\(MAIN_SITE_ORIGIN, 301\)/.test(proxy) && /isPortalOnlyPath\(path\) \|\| !isGet \? 308 : 301/.test(proxy))
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p) } return out }
const files = walk('app').concat(['proxy.ts'])
const rawReads = files.filter((f) => !f.endsWith('base-url.ts') && !f.endsWith('utils/email.ts') && /process\.env\.NEXT_PUBLIC_APP_URL/.test(read(f)))
check('NEXT_PUBLIC_APP_URL is read only through base-url.ts (email.ts dev-detection excepted)', rawReads.length === 0, rawReads.join(', '))
const oldHost = files.filter((f) => !f.endsWith('base-url.ts')).filter((f) => read(f).split('\n').some((l) => /hgl-portal\.vercel\.app/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)))
check('no CODE literal of the old host outside base-url.ts (comments excepted)', oldHost.length === 0, oldHost.join(', '))
const shortOriginReads = files.filter((f) => !f.endsWith('base-url.ts') && /PUBLIC_SHORT_ORIGIN/.test(read(f)))
check('PUBLIC_SHORT_ORIGIN is retired — read nowhere but base-url.ts', shortOriginReads.length === 0, shortOriginReads.join(', '))
check('publicSiteOrigin() = emailBaseUrl() regardless of env (PL-498)', publicSiteOrigin() === emailBaseUrl() && !/hgl\.co/.test(publicSiteOrigin()), publicSiteOrigin())

// ---- B. running server ------------------------------------------------------
const portalHost = canonicalPortalHost()
const shortHost = SHORT_PUBLIC_HOSTS[0]
// Node's fetch drops a caller-set Host header (forbidden header per the Fetch
// spec), so the host-conditioned checks go through curl.
const get = (p, host) => {
  const out = execSync(`curl -s -o /tmp/.hosts-body -w "%{http_code}\\n%{redirect_url}" ${host ? `-H "Host: ${host}"` : ''} ${JSON.stringify(`${base}${p}`)}`, { encoding: 'utf8' })
  const [code, redirect] = out.split('\n')
  const body = readFileSync('/tmp/.hosts-body', 'utf8')
  return { status: Number(code), headers: { get: (k) => (k === 'location' ? (redirect || null) : null) }, text: async () => body }
}
let up = false
try { up = (await fetch(`${base}/classes`)).status < 500 } catch { up = false }
check(`server reachable at ${base} (crashed gate ≠ green gate)`, up)
if (up) {
  const MAIN = 'https://www.highergroundlearning.com'
  // PL-498: the short host serves NOTHING — portal-only paths 308, public paths 301, same path + query.
  for (const p of ['/login', '/portal?enrollment=abc&pe=x%40y.z&pt=123', '/admin/tutoring?family=1', '/auth/confirm?token_hash=t&type=magiclink', '/class-report/abc', '/tutoring/schedule/tok', '/intake/tok', '/survey/tok', '/api/resume-payment?e=1&t=2']) {
    const res = await get(p, shortHost)
    const loc = res.headers.get('location') ?? ''
    check(`Host: ${shortHost} ${p} → 308 to the portal host, path + query intact`, res.status === 308 && loc === `https://${portalHost}${p}`, `${res.status} ${loc}`)
  }
  for (const p of ['/sls', '/sls?via=flyer', '/classes', '/team', '/inquire?source=sqsp-home', '/compass', '/partner', '/c/anything', '/sls/register', '/embed/upcoming-classes.js', '/sitemap.xml', '/llms.txt']) {
    const res = await get(p, shortHost)
    const loc = res.headers.get('location') ?? ''
    check(`Host: ${shortHost} ${p} → 301 to the portal host, path + query intact (PL-498)`, res.status === 301 && loc === `https://${portalHost}${p}`, `${res.status} ${loc}`)
  }
  const post = execSync(`curl -s -o /dev/null -w "%{http_code} %{redirect_url}" -X POST -H "Host: ${shortHost}" -H "Content-Type: application/json" -d "{}" ${JSON.stringify(`${base}/api/inquiry`)}`, { encoding: 'utf8' })
  check(`Host: ${shortHost} POST /api/inquiry → 308 (never downgraded to a GET)`, post.startsWith('308 ') && post.includes(`https://${portalHost}/api/inquiry`), post)
  const bare = await get('/', shortHost)
  // next.config's host-conditioned `permanent: true` fires BEFORE the proxy and emits a 308; the proxy's own 301 is the fallback if that order ever changes — either way: permanent, to the main site.
  check(`Host: ${shortHost} / → permanent redirect (301/308) to the main site`, [301, 308].includes(bare.status) && (bare.headers.get('location') ?? '').replace(/\/$/, '') === MAIN, `${bare.status} ${bare.headers.get('location') ?? ''}`)
  // an unknown path: hop 1 to the portal host (301), hop 2 the portal's wildcard to the main site (permanent) — never back to hgl.co
  const hop1 = await get('/sat', shortHost)
  const hop2 = await get('/sat', portalHost)
  const hop2loc = hop2.headers.get('location') ?? ''
  check(`Host: ${shortHost} /sat → 301 portal /sat → permanent → main-site /sat (two hops, both permanent, never back to the short host)`, hop1.status === 301 && hop1.headers.get('location') === `https://${portalHost}/sat` && [301, 308].includes(hop2.status) && /^https:\/\/(www\.)?highergroundlearning\.com\/sat$/.test(hop2loc), `${hop1.status} ${hop1.headers.get('location')} → ${hop2.status} ${hop2loc}`)
  const served = []
  for (const p of ['/', '/sls', '/classes', '/team', '/inquire', '/c/x', '/sls/register', '/embed/upcoming-classes.js', '/sitemap.xml', '/llms.txt', '/login', '/api/class-info/x', '/collateral/hgl-logo-color.png', '/sat', '/a/b/c']) {
    const res = await get(p, shortHost)
    if (res.status === 200) served.push(p)
  }
  check(`Host: ${shortHost} never answers 200 on any path (nothing is served on the short host)`, served.length === 0, served.join(', '))
  for (const p of ['/login', '/classes', '/sls', '/portal', '/sat']) {
    const res = await get(p, portalHost)
    const loc = res.headers.get('location') ?? ''
    check(`Host: ${portalHost} ${p} never redirects to the short host`, !loc.includes(`://${shortHost}`), `${res.status} ${loc}`)
  }
  // the portal host: every public page 200, canonical + OG + JSON-LD on the portal host, zero hgl.co in any of it
  const pub = publicSiteOrigin()
  check('publicSiteOrigin() is the portal host', pub === `https://${portalHost}` || new URL(pub).host === portalHost, pub)
  for (const p of ['/classes', '/team', '/inquire', '/compass', '/partner', '/sls', '/embed/upcoming-classes.js', '/sitemap.xml', '/llms.txt']) {
    const res = await get(p, portalHost)
    check(`Host: ${portalHost} ${p} → 200`, res.status === 200, String(res.status))
  }
  const codeHtml = await (await get('/sls', portalHost)).text()
  const canon = /<link rel="canonical" href="([^"]+)"/.exec(codeHtml)?.[1] ?? ''
  check(`/{code} canonical is on the portal host (${pub}/sls)`, canon === `${pub}/sls`, canon)
  const og = /<meta property="og:url" content="([^"]+)"/.exec(codeHtml)?.[1] ?? ''
  check('/{code} og:url is on the portal host', og === `${pub}/sls`, og)
  const ld = [...codeHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
  check('/{code} JSON-LD Organization url = the portal host + sameAs the brand domain', ld.includes(`"url":"${pub}"`) && ld.includes('"sameAs":["https://www.highergroundlearning.com"]') && !/hgl\.co/.test(ld), ld.slice(0, 160))
  const teamHtml = await (await get('/team', portalHost)).text()
  const teamLd = [...teamHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
  check('/team JSON-LD Organization url = the portal host + sameAs the brand domain', teamLd.includes(`"url":"${pub}"`) && teamLd.includes('"sameAs":["https://www.highergroundlearning.com"]') && !/hgl\.co/.test(teamLd), teamLd.slice(0, 160))
  for (const p of ['/classes', '/team', '/sls']) {
    const h = await (await get(p, portalHost)).text()
    const heads = [/<link rel="canonical" href="[^"]*"/.exec(h)?.[0] ?? '', /<meta property="og:url" content="[^"]*"/.exec(h)?.[0] ?? ''].join(' ')
    check(`${p} canonical/OG never name hgl.co`, !/hgl\.co/.test(heads), heads)
  }
  const sm = await (await get('/sitemap.xml', portalHost)).text()
  const smUrls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  check('sitemap lists only the portal host', smUrls.length > 0 && smUrls.every((u) => u.startsWith(pub + '/')) && sm.includes(`${pub}/classes`), `${smUrls.length} urls; off-host: ${smUrls.filter((u) => !u.startsWith(pub + '/')).slice(0, 3).join(' ')}`)
  const llms = await (await get('/llms.txt', portalHost)).text()
  check('llms.txt links the portal host and never hgl.co', llms.includes(pub) && !/hgl\.co/.test(llms), (llms.match(/hgl\.co[^\s)]*/g) ?? []).slice(0, 3).join(' '))
  const embed = await (await get('/embed/upcoming-classes.js', portalHost)).text()
  check('homepage embed "More info" links use the portal host, never hgl.co', embed.includes(pub) && !/hgl\.co/.test(embed))
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
