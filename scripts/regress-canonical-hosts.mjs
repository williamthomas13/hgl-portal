#!/usr/bin/env node
// PL-474 gate: two hosts, one session.
//   A. Static: proxy.ts's matcher covers every PORTAL_ONLY_PATH_PREFIXES entry
//      (the matcher must be a literal, so the two lists are checked to agree);
//      no file outside base-url.ts reads NEXT_PUBLIC_APP_URL directly (the
//      dev-detection read in email.ts is the one allowed exception); no code
//      literal of the old host remains outside base-url.ts / comments.
//   B. Against a RUNNING server (arg, default http://localhost:3100): requests
//      with Host: hgl.co for signed-in / auth / tokenized paths 308 to the same
//      path (+ query) on the canonical portal host; public paths on hgl.co
//      serve normally; the portal host never redirects to hgl.co (no loop);
//      /{code} pages carry the PUBLIC-origin canonical; the sitemap lists it.
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
let PORTAL_ONLY_PATH_PREFIXES, canonicalPortalHost, publicSiteOrigin, SHORT_PUBLIC_HOSTS
try {
  execSync(`npx tsc app/utils/base-url.ts --outDir ${JSON.stringify(build)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`, { stdio: 'inherit' })
  ;({ PORTAL_ONLY_PATH_PREFIXES, canonicalPortalHost, publicSiteOrigin, SHORT_PUBLIC_HOSTS } = createRequire(import.meta.url)(path.join(build, 'base-url.js')))
} finally { safeRm(build) }
const proxy = read('proxy.ts')
const matcher = [...proxy.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((p) => /^\/(?!\.)/.test(p))
for (const prefix of PORTAL_ONLY_PATH_PREFIXES) {
  const covered = matcher.some((m) => m === prefix || m === `${prefix}/:path*`)
  check(`proxy matcher covers ${prefix}`, covered)
}
check('proxy 308s short-host requests for portal-only paths', /isPortalOnlyPath\(path\)/.test(proxy) && /NextResponse\.redirect\(target, 308\)/.test(proxy))
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p) } return out }
const files = walk('app').concat(['proxy.ts'])
const rawReads = files.filter((f) => !f.endsWith('base-url.ts') && !f.endsWith('utils/email.ts') && /process\.env\.NEXT_PUBLIC_APP_URL/.test(read(f)))
check('NEXT_PUBLIC_APP_URL is read only through base-url.ts (email.ts dev-detection excepted)', rawReads.length === 0, rawReads.join(', '))
const oldHost = files.filter((f) => !f.endsWith('base-url.ts')).filter((f) => read(f).split('\n').some((l) => /hgl-portal\.vercel\.app/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)))
check('no CODE literal of the old host outside base-url.ts (comments excepted)', oldHost.length === 0, oldHost.join(', '))

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
  for (const p of ['/login', '/portal?enrollment=abc&pe=x%40y.z&pt=123', '/admin/tutoring?family=1', '/auth/confirm?token_hash=t&type=magiclink', '/class-report/abc', '/tutoring/schedule/tok', '/intake/tok', '/survey/tok', '/api/resume-payment?e=1&t=2']) {
    const res = await get(p, shortHost)
    const loc = res.headers.get('location') ?? ''
    check(`Host: ${shortHost} ${p} → 308 to the portal host, path + query intact`, res.status === 308 && loc === `https://${portalHost}${p}`, `${res.status} ${loc}`)
  }
  for (const p of ['/classes', '/team', '/inquire', '/sls', '/sls/register', '/embed/upcoming-classes.js', '/sitemap.xml']) {
    const res = await get(p, shortHost)
    check(`Host: ${shortHost} ${p} serves in place (no redirect off the short host)`, res.status === 200 || (res.status >= 300 && res.status < 400 && !(res.headers.get('location') ?? '').includes(portalHost)), `${res.status} ${res.headers.get('location') ?? ''}`)
  }
  const bare = await get('/', shortHost)
  check(`Host: ${shortHost} / → permanent redirect to the main site (next.config)`, [301, 308].includes(bare.status) && /highergroundlearning\.com/.test(bare.headers.get('location') ?? ''), `${bare.status} ${bare.headers.get('location') ?? ''}`)
  for (const p of ['/login', '/classes', '/sls', '/portal']) {
    const res = await get(p, portalHost)
    const loc = res.headers.get('location') ?? ''
    check(`Host: ${portalHost} ${p} never redirects to the short host`, !loc.includes(`://${shortHost}`), `${res.status} ${loc}`)
  }
  const pub = publicSiteOrigin()
  const codeHtml = await (await get('/sls', shortHost)).text()
  const canon = /<link rel="canonical" href="([^"]+)"/.exec(codeHtml)?.[1] ?? ''
  check(`/{code} canonical uses the public origin (${pub})`, canon === `${pub}/sls`, canon)
  const sm = await (await get('/sitemap.xml', shortHost)).text()
  check('sitemap lists the public origin', sm.includes(`${pub}/classes`), sm.slice(0, 200))
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
