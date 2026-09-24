// Smoke test for the public class pages' bad-slug path (portal-fixes
// 2026-07-11 §1): a mistyped or stale link must land on the friendly §12
// "Class not found" card — never a stuck "Loading..." state or a fetch retry
// loop.
//
//   node scripts/smoke-public-pages.mjs [base-url]   (default http://localhost:3000)
//
// The API check needs nothing; the page checks drive a real browser and are
// skipped (with a warning) if no Chrome is found — set CHROME_PATH to point
// at one explicitly.

import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'
import { createClient } from '@supabase/supabase-js'

// PL-470: the in-progress class page needs a real class (registration closed,
// sessions still ahead) — a self-cleaning fixture, never "the newest class".
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const plus = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const IP_SLUG = 'qa-smoke-in-progress'
// PL-489: one class per public STATE (open · full · closed · in-progress ·
// cancelled) + a school with no class (no-upcoming) — so the header/footer
// audit is a gate, not an eye.
// PL-496: + an open-but-ENDED class under the coded second school — the admin registry must say between-classes for it.
const STATE_SLUGS = { open: 'qa-smoke-open', full: 'qa-smoke-full', closed: 'qa-smoke-closed', cancelled: 'qa-smoke-cancelled', ended2: 'qa-smoke-ended2' }
async function cleanupInProgress() {
  const { data: cls } = await db.from('classes').select('id').in('slug', [IP_SLUG, ...Object.values(STATE_SLUGS)])
  for (const c of cls ?? []) {
    await db.from('email_sends').delete().eq('class_id', c.id)
    await db.from('enrollments').delete().eq('class_id', c.id)
    await db.from('sessions').delete().eq('class_id', c.id)
    await db.from('classes').delete().eq('id', c.id)
  }
  const { data: fams } = await db.from('families').select('id').like('parent_email', 'billy+qasmoke%')
  for (const f of fams ?? []) { await db.from('students').delete().eq('family_id', f.id); await db.from('families').delete().eq('id', f.id) }
  await db.from('schools').delete().in('nickname', ['QASMOKE', 'QASMOKE2'])
}
async function createStateFixtures(schoolId) {
  const mk = async (slug, o) => {
    const { data: c } = await db.from('classes').insert([{ class_type: 'SAT Prep', status: o.status ?? 'open', start_date: plus(o.first), price: 749, capacity: o.capacity ?? 20, min_enrollment: 1, school_id: schoolId, slug, delivery_mode: 'online', default_location: 'Live online', timezone: 'Europe/Rome', registration_close_date: plus(o.close), enrollment_deadline: plus(o.close), practice_test_count: 2 }]).select('id').single()
    await db.from('sessions').insert([0, 7].map((n) => ({ class_id: c.id, session_date: plus(o.first + n), start_time: '18:00:00', end_time: '20:00:00' })))
    if (o.paid) {
      const { data: fam } = await db.from('families').insert([{ parent_first_name: 'QA', parent_last_name: 'Smoke', parent_email: `billy+qasmoke-${slug}@highergroundlearning.com` }]).select('id').single()
      const { data: st } = await db.from('students').insert([{ family_id: fam.id, first_name: 'QA', last_name: 'Smoke' }]).select('id').single()
      await db.from('enrollments').insert([{ class_id: c.id, student_id: st.id, payment_status: 'Paid', paid_at: new Date().toISOString(), comms_muted: true }])
    }
    return c.id
  }
  const ids = {}
  ids.open = await mk(STATE_SLUGS.open, { first: 30, close: 25 })
  ids.full = await mk(STATE_SLUGS.full, { first: 30, close: 25, capacity: 1, paid: true })
  ids.closed = await mk(STATE_SLUGS.closed, { first: -30, close: -35 })
  ids.cancelled = await mk(STATE_SLUGS.cancelled, { first: 30, close: 25, status: 'cancelled' })
  const { data: two } = await db.from('schools').insert([{ name: 'QA Smoke School Two', nickname: 'QASMOKE2', timezone: 'Europe/Rome', city: 'Milan', evergreen_code: 'qasmoke2', collateral_language: 'en' }]).select('id').single()
  // PL-496: status open, last session 33 days ago — the public /qasmoke2 must still fall through to the interest page AND the admin registry must not call it "now showing".
  const { data: ended } = await db.from('classes').insert([{ class_type: 'SAT Prep', status: 'open', start_date: plus(-40), price: 749, capacity: 20, min_enrollment: 1, school_id: two.id, slug: STATE_SLUGS.ended2, delivery_mode: 'online', default_location: 'Live online', timezone: 'Europe/Rome', registration_close_date: plus(-45), enrollment_deadline: plus(-45), practice_test_count: 2 }]).select('id').single()
  await db.from('sessions').insert([0, 7].map((n) => ({ class_id: ended.id, session_date: plus(-40 + n), start_time: '18:00:00', end_time: '20:00:00' })))
  ids.ended2 = ended.id
  ids.school2 = two.id
  return ids
}

// --- staff session cookie (admin magic link → session → @supabase/ssr cookie) — the regress-cancel-class pattern
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
async function staffCookie() {
  const { data: profiles } = await db.from('profiles').select('id').eq('role', 'admin')
  const { data: users } = await db.auth.admin.listUsers()
  const admin = users.users.find((u) => profiles.some((p) => p.id === u.id))
  if (!admin) throw new Error('no admin user found')
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: admin.email })
  if (error) throw error
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const { data: verified, error: vErr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
  if (vErr || !verified.session) throw vErr ?? new Error('no session from verifyOtp')
  const encoded = 'base64-' + Buffer.from(JSON.stringify(verified.session)).toString('base64url')
  const name = `sb-${ref}-auth-token`
  const CHUNK = 3180
  if (encoded.length <= CHUNK) return `${name}=${encoded}`
  const parts = []
  for (let i = 0; i * CHUNK < encoded.length; i++) parts.push(`${name}.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`)
  return parts.join('; ')
}

// PL-492/493: the header/footer shape every public page must carry.
const TOP_LEVEL = ['Tutoring', 'Classes', 'About', 'Team', 'Pricing', 'Contact']
const TUTORING = ['Buy 1-on-1 tutoring hours', 'Academic Support', 'SAT', 'ACT', 'AP/IB', 'University Applications', 'GRE/GMAT']
function navTop(html) {
  const desktop = html.match(/<nav[^>]*data-nav-desktop[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? ''
  return [...desktop.matchAll(/data-nav-top="([^"]+)"/g)].map((m) => m[1])
}
function navChildren(html, scope) {
  const block = scope === 'desktop'
    ? html.match(/<nav[^>]*data-nav-desktop[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? ''
    : html.match(/<nav[^>]*data-nav-mobile[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? ''
  const folder = block.match(/data-nav-folder="Tutoring"[\s\S]*?(?=data-nav-top="Classes"|<\/details>)/)?.[0] ?? ''
  return [...folder.matchAll(/data-nav-child="([^"]+)"/g)].map((m) => m[1])
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
async function createInProgress() {
  await cleanupInProgress()
  const { data: school } = await db.from('schools').insert([{ name: 'QA Smoke School', nickname: 'QASMOKE', timezone: 'Europe/Rome', city: 'Milan', evergreen_code: 'qasmoke', collateral_language: 'en' }]).select('id').single()
  const { data: cls } = await db.from('classes').insert([{ class_type: 'SAT Prep', status: 'open', start_date: plus(-8), price: 749, capacity: 20, min_enrollment: 5, school_id: school.id, slug: IP_SLUG, delivery_mode: 'online', default_location: 'https://zoom.us/j/qa-smoke', timezone: 'Europe/Rome', registration_close_date: plus(-3), enrollment_deadline: plus(-3), practice_test_count: 2 }]).select('id').single()
  await db.from('sessions').insert([[-8], [-1], [2], [6]].map(([n]) => ({ class_id: cls.id, session_date: plus(n), start_time: '18:30:00', end_time: '20:30:00' })))
  return cls.id
}

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')
const BAD_SLUG = 'definitely-not-a-real-slug'
const MAIN_SITE = 'https://www.highergroundlearning.com'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// --- API: bad slug must be a clean 404 with an error body -------------------
const res = await fetch(`${base}/api/class-info/${BAD_SLUG}`)
check('API /class-info bad slug returns 404', res.status === 404, `status ${res.status}`)
const body = await res.json().catch(() => null)
check('API 404 body carries an error message', typeof body?.error === 'string')

// --- PL-348: /c/{bad} is server-rendered and must NEVER 404 — printed
// collateral and hgl.co shortlinks land here, so a stale link gets the
// honest no-active-class page with the consultation door.
const cRes = await fetch(`${base}/c/${BAD_SLUG}`)
check('public class page bad slug returns 200 (never a 404)', cRes.status === 200, `status ${cRes.status}`)
const cHtml = await cRes.text().catch(() => '')
check('public class page bad slug renders the honest state card',
  /No active class|no class open for registration/i.test(cHtml))
check('public class page bad slug offers the consultation door', cHtml.includes('/inquire'))

// --- PL-470: a RUNNING class with registration closed renders the in-progress
// page (hero + calendar, next session highlighted, enrolled sign-in, secondary
// consult + interest capture), never the closed card; /c/{slug} and /{code}.
try {
  await createInProgress()
  for (const [name, path] of [['/c/{slug}', `/c/${IP_SLUG}`], ['/{code}', '/qasmoke']]) {
    const ipRes = await fetch(`${base}${path}`)
    const ipHtml = await ipRes.text().catch(() => '')
    check(`${name} in-progress class returns 200`, ipRes.status === 200, `status ${ipRes.status}`)
    check(`${name} renders the in-progress banner, not the closed card`, /under way — registration closed/.test(ipHtml) && !/Registration for this class has closed/.test(ipHtml))
    check(`${name} highlights the next session`, /data-session-state="next"/.test(ipHtml) && /data-testid="next-session-line"/.test(ipHtml))
    check(`${name} greys past sessions`, /data-session-state="past"/.test(ipHtml))
    check(`${name} hides the register CTA, price and FAQ`, !/data-track="register"/.test(ipHtml) && !/\$749/.test(ipHtml) && !/data-section="faq"/.test(ipHtml))
    check(`${name} offers the enrolled sign-in, the add-to-calendar link, the consult door and the interest capture`, /data-testid="enrolled-signin"/.test(ipHtml) && /\/calendar/.test(ipHtml) && /\/inquire\?source=class-page/.test(ipHtml) && /data-testid="state-interest-capture"/.test(ipHtml))
    check(`${name} JSON-LD states closed registration`, /schema\.org\/SoldOut/.test(ipHtml) && /EventScheduled/.test(ipHtml))
  }
  // PL-479/478: /classes renders the fixture as an in-progress CARD (school
  // tile, state) and every public page carries the shared header + footer.
  const clRes = await fetch(`${base}/classes`)
  const clHtml = await clRes.text().catch(() => '')
  check('/classes renders school cards (in-progress fixture as a card with a tile)', /data-testid="class-card"[^>]*data-state="in-progress"/.test(clHtml) && /data-testid="school-tile(-monogram)?"/.test(clHtml))
  // PL-490: a recent card's date reads "Month YYYY" (the closed fixture is a recent card).
  const months = [...clHtml.matchAll(/data-testid="recent-month">([^<]*)</g)].map((m) => m[1])
  check('/classes recent cards read "Month YYYY" (PL-490)', months.length > 0 && months.every((m) => /^[A-Z][a-z]+ \d{4}$/.test(m)), months.slice(0, 3).join(' | '))
  // PL-491: the overflow line is a real link ("more" → expands in place; /classes?recent=all without JS).
  const recentCount = (clHtml.match(/data-state="recent"/g) ?? []).length
  if (/data-testid="recent-more"/.test(clHtml)) {
    check('/classes "more" is a real link to ?recent=all with the remainder pre-rendered hidden', /href="\/classes\?recent=all"/.test(clHtml) && /id="recent-rest" style="display:none"/.test(clHtml))
    const allHtml = await (await fetch(`${base}/classes?recent=all`)).text().catch(() => '')
    check('/classes?recent=all shows every recent class (no-JS fallback)', !/data-testid="recent-more"/.test(allHtml) && (allHtml.match(/data-state="recent"/g) ?? []).length >= recentCount)
  } else {
    console.log(`note  /classes has ${recentCount} recent card(s) — under the cap, no "more" link to check`)
  }
  check('/classes carries the new intro line + the "Talk to us" button', /Live test-prep classes at partner schools around the world, online, and at our HQ in Salt Lake City, USA\./.test(clHtml) && /data-testid="classes-talk-to-us"/.test(clHtml))
  for (const [name, path] of [['/classes', '/classes'], ['/{code} in progress', '/qasmoke'], ['/team', '/team'], ['/inquire', '/inquire']]) {
    const h = path === '/classes' ? clHtml : await (await fetch(`${base}${path}`)).text().catch(() => '')
    check(`${name} renders the site header + footer (PL-478)`, /data-testid="site-header"/.test(h) && /data-testid="site-footer"/.test(h))
    // PL-492: the main site's menu SHAPE — six top-level items in order, the seven service links under "Tutoring" on desktop AND in the no-JS mobile sheet.
    check(`${name} header reads Tutoring · Classes · About · Team · Pricing · Contact (PL-492)`, eq(navTop(h), TOP_LEVEL), navTop(h).join(' · '))
    check(`${name} "Tutoring" folder holds the seven service links on desktop (PL-492)`, eq(navChildren(h, 'desktop'), TUTORING), navChildren(h, 'desktop').join(' · '))
    check(`${name} every service link is reachable without JS — the <details> sheet (PL-492)`, eq(navChildren(h, 'mobile'), TUTORING) && /<details[^>]*data-nav-folder="Tutoring"/.test(h))
    // PL-493: the main site's footer — newsletter block (the Compass capture), the headed columns, the © line.
    check(`${name} footer carries the newsletter block + Compass form + the headed columns + © line (PL-493)`, /data-testid="footer-newsletter"/.test(h) && /Finally get something useful in your inbox/.test(h) && /data-testid="footer-compass"/.test(h) && /data-nav-group="Questions\?"/.test(h) && /data-nav-group="Support"/.test(h) && /Some rights reserved\./.test(h))
    check(`${name} footer prints the PUBLIC address info@ (PL-493)`, /data-testid="footer-email"[^>]*>info@highergroundlearning\.com</.test(h))
  }
  // PL-492: header tone — transparent over a hero (/classes, /team, the class page), a white bar elsewhere.
  const tHtml = await (await fetch(`${base}/team`)).text().catch(() => '')
  const iHtml = await (await fetch(`${base}/inquire`)).text().catch(() => '')
  check('/classes + /team wear the overlay header over their hero (PL-492)', /data-testid="site-header"[^>]*data-tone="overlay"/.test(clHtml) && /data-testid="site-header"[^>]*data-tone="overlay"/.test(tHtml))
  check('/inquire wears the white header bar (PL-492)', /data-testid="site-header"[^>]*data-tone="white"/.test(iHtml))
  check('/inquire "talk to a person" line prints info@, never the tutoring contact (PL-493)', /data-testid="inquire-email"[^>]*>info@highergroundlearning\.com</.test(iHtml))
  // PL-494: the school helper placeholder is gone; the channel question precedes Email / Phone.
  check('/inquire has no "Homeschooled or graduated" placeholder (PL-494)', !/Homeschooled or graduated/.test(iHtml))
  check('/inquire asks how to connect BEFORE email + phone (PL-494)', iHtml.indexOf('data-testid="inquiry-connect-pref"') > 0 && iHtml.indexOf('data-testid="inquiry-connect-pref"') < iHtml.indexOf('data-testid="inquiry-email"'))
  // PL-489: the header/footer audit — one URL per public state, gated.
  const { data: smokeSchool } = await db.from('schools').select('id').eq('nickname', 'QASMOKE').maybeSingle()
  const fx = await createStateFixtures(smokeSchool.id)
  // PL-493: no public page prints the tutoring contact's inbox.
  for (const path of ['/', '/classes', '/team', '/inquire', '/compass', '/partner', '/qasmoke', '/qasmoke2']) {
    const h = await (await fetch(`${base}${path}`)).text().catch(() => '')
    check(`${path} never contains kelsie@ (PL-493)`, !/kelsie@/i.test(h))
  }
  // PL-496: the admin link registry resolves through the SAME serving rule as the public route.
  try {
    const cookie = await staffCookie()
    const reg = await (await fetch(`${base}/api/admin/evergreen`, { headers: { cookie } })).json()
    const s1 = (reg.schools ?? []).find((s) => s.nickname === 'QASMOKE')
    const s2 = (reg.schools ?? []).find((s) => s.nickname === 'QASMOKE2')
    check('admin registry: the coded school says "now showing" its newest future cohort, never the ended one (PL-496)', [fx.open, fx.full].includes(s1?.serving?.classId), JSON.stringify(s1?.serving))
    check('admin registry: its candidates exclude the ended cohort (PL-496)', Array.isArray(s1?.candidates) && s1.candidates.some((c) => c.id === fx.open) && !s1.candidates.some((c) => c.id === fx.closed), JSON.stringify(s1?.candidates))
    check('admin registry: an open-but-ENDED class reads between-classes, not "now showing" (PL-496)', s2 != null && s2.serving === null && (s2.candidates ?? []).length === 0, JSON.stringify({ serving: s2?.serving, candidates: s2?.candidates }))
    const pin = await fetch(`${base}/api/admin/evergreen`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ action: 'set_school_pin', id: fx.school2, classId: fx.ended2 }) })
    const pj = await pin.json().catch(() => ({}))
    check('admin registry: an ended class cannot be pinned (PL-496)', pin.status === 400 && /finished/.test(pj.error ?? ''), `${pin.status} ${pj.error ?? ''}`)
  } catch (e) {
    check('admin registry reachable with a staff session (PL-496)', false, String(e?.message ?? e))
  }
  for (const [state, path, marker] of [
    // the code URL serves the school's newest OPEN class (the open fixture) — the in-progress class keeps its /c address
    ['open (/{code})', '/qasmoke', 'data-track="register"'],
    ['full', `/c/${STATE_SLUGS.full}`, 'Join the waitlist'],
    ['closed', `/c/${STATE_SLUGS.closed}`, 'Registration for this class has closed'],
    ['in-progress', `/c/${IP_SLUG}`, 'under way — registration closed'],
    ['cancelled', `/c/${STATE_SLUGS.cancelled}`, 'isn’t running'],
    ['no-upcoming', '/qasmoke2', 'No upcoming class at QASMOKE2'],
    ['unknown code (/c/{bad})', `/c/${BAD_SLUG}`, 'No active class'],
  ]) {
    const h = await (await fetch(`${base}${path}`)).text().catch(() => '')
    check(`state "${state}" (${path}) renders its marker`, h.includes(marker), marker)
    check(`state "${state}" carries the site header + footer (PL-478/489)`, /data-testid="site-header"/.test(h) && /data-testid="site-footer"/.test(h))
  }
  const nuHtml = await (await fetch(`${base}/qasmoke2`)).text().catch(() => '')
  check('no-upcoming card carries the brand lockup (PL-483/489)', /data-testid="brand-lockup"/.test(nuHtml))

  // PL-488 → PL-494: the inquiry API's required set is server-side and names the field; Email / Phone are required BY THE CHOSEN CHANNEL (the honeypot is set so no row is written).
  const EMAIL = 'billy+qasmoke-inq@highergroundlearning.com'
  const base94 = { parentFirst: 'QA', parentLast: 'Smoke', studentFirst: 'QA', studentLast: 'Student', studentSchool: 'Homeschooled', subject: 'SAT', other: '', company: 'bot' }
  const post = (b) => fetch(`${base}/api/inquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  const probe = async (b) => { const r = await post(b); const j = await r.json().catch(() => ({})); return { status: r.status, missing: j.missing ?? null, error: j.error ?? '' } }
  for (const ch of ['Phone call', 'Text', 'WhatsApp']) {
    const ok = await probe({ ...base94, connectPref: ch, parentPhoneCountry: '+1', parentPhone: '801 555 0100', parentEmail: '' })
    check(`inquiry API accepts "${ch}" with a phone and NO email (PL-494)`, ok.status === 200, `${ok.status} ${ok.error}`)
    const no = await probe({ ...base94, connectPref: ch, parentEmail: EMAIL, parentPhone: '' })
    check(`inquiry API rejects "${ch}" without a phone, naming Phone only (PL-494)`, no.status === 400 && eq(no.missing, ['Phone']), `${no.status} ${no.error}`)
  }
  const okE = await probe({ ...base94, connectPref: 'Email', parentEmail: EMAIL, parentPhone: '' })
  check('inquiry API accepts "Email" with an email and NO phone (PL-494)', okE.status === 200, `${okE.status} ${okE.error}`)
  const noE = await probe({ ...base94, connectPref: 'Email', parentEmail: '', parentPhoneCountry: '+1', parentPhone: '801 555 0100' })
  check('inquiry API rejects "Email" without an email, naming Email only (PL-494)', noE.status === 400 && eq(noE.missing, ['Email']), `${noE.status} ${noE.error}`)
  const noCh = await probe({ ...base94, connectPref: '', parentEmail: '', parentPhone: '' })
  check('inquiry API with no channel + nothing names the channel (PL-494)', noCh.status === 400 && (noCh.missing ?? []).includes('How you prefer to connect'), `${noCh.status} ${noCh.error}`)
  const blank = await probe({ ...base94, connectPref: 'Email', parentEmail: EMAIL, parentFirst: '' })
  check('inquiry API still rejects a blank fixed field, naming it (PL-488)', blank.status === 400 && eq(blank.missing, ['First name']), `${blank.status} ${blank.error}`)
  const embedJs = await (await fetch(`${base}/embed/inquire.js`)).text().catch(() => '')
  check('inquiry embed carries the same rule: 7 fixed required + Email/Phone by channel, channel before them, no school placeholder (PL-494)', !/data-require/.test(embedJs) && (embedJs.match(/"required":true/g) ?? []).length === 7 && (embedJs.match(/"requiredBy":"channel"/g) ?? []).length === 2 && embedJs.indexOf('"name":"connectPref"') < embedJs.indexOf('"name":"parentEmail"') && !/Homeschooled or graduated/.test(embedJs) && /var channelNeeds = function/.test(embedJs))
  const embedHtml = await (await fetch(`${base}/embed/upcoming-classes.js`)).text().catch(() => '')
  check('/embed/upcoming-classes.js never carries the site header', !/site-header/.test(embedHtml))
  const regRes = await fetch(`${base}/qasmoke/register`)
  const regHtml = await regRes.text().catch(() => '')
  check('/{code}/register while closed still serves the registration route (closed notice is client-rendered)', regRes.status === 200 && !/No upcoming class/.test(regHtml))
} finally {
  await cleanupInProgress()
}

// --- Pages: friendly 404 renders, exactly one class-info fetch --------------
const chromePath =
  process.env.CHROME_PATH ??
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].find(existsSync)

if (!chromePath) {
  console.warn('WARN  no Chrome found — page checks skipped (set CHROME_PATH)')
} else {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true })
  try {
    // PL-470: the in-progress page at 375px — no horizontal overflow, closed
    // notice on /register links back to the class page.
    const ipId = await createInProgress()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 })
      await page.goto(`${base}/c/${IP_SLUG}`, { waitUntil: 'networkidle0', timeout: 30_000 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('in-progress page has no horizontal overflow at 375px', overflow <= 0, `overflow ${overflow}px`)
      const banner = await page.$('[data-testid="in-progress-banner"]')
      check('in-progress banner renders at 375px', banner !== null)
      // PL-491: the school tile is readable — rendered height ≥ 64px on /classes at 375px, no overflow.
      await page.goto(`${base}/classes`, { waitUntil: 'networkidle0', timeout: 30_000 })
      // (visible tiles only — the "more" remainder is display:none until clicked)
      const tileHeights = await page.$$eval('[data-testid="school-tile"], [data-testid="school-tile-monogram"]', (els) => els.filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect().height))
      check('/classes school tiles render ≥ 64px tall at 375px (PL-491)', tileHeights.length > 0 && tileHeights.every((h) => h >= 64), `heights ${[...new Set(tileHeights.map((h) => Math.round(h)))].join(',')}`)
      // PL-491: the remainder is really hidden until "more" is clicked, then shown in place (Tailwind's .grid used to override [hidden]).
      const moreState = await page.evaluate(async () => {
        const more = document.querySelector('[data-testid="recent-more"]')
        if (!more) return null
        const vis = () => [...document.querySelectorAll('[data-state="recent"]')].filter((e) => e.offsetParent !== null).length
        const before = vis()
        more.click()
        await new Promise((r) => setTimeout(r, 300))
        return { before, after: vis(), total: document.querySelectorAll('[data-state="recent"]').length }
      })
      if (moreState) check('/classes "more" expands the hidden remainder in place', moreState.before < moreState.total && moreState.after === moreState.total, JSON.stringify(moreState))
      const tileWidths = await page.$$eval('[data-testid="school-tile"]', (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)))
      check('/classes logo tiles wrap their logo (not stretched to a fixed width)', tileWidths.length === 0 || tileWidths.some((w) => w < 160) || tileWidths.every((w) => w <= 160), `widths ${[...new Set(tileWidths)].join(',')}`)
      const clOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('/classes has no horizontal overflow at 375px with the larger tiles', clOverflow <= 0, `overflow ${clOverflow}px`)
      await page.goto(`${base}/register/${ipId}`, { waitUntil: 'networkidle0', timeout: 30_000 })
      const back = await page.$('[data-testid="back-to-class-page"]')
      check('/register while closed links back to the class page', back !== null)
      // PL-492: at phone width the sheet's "Tutoring" group holds the seven links (no-JS <details>).
      await page.goto(`${base}/classes`, { waitUntil: 'networkidle0', timeout: 30_000 })
      const sheetKids = await page.$$eval('[data-nav-mobile] details[data-nav-folder="Tutoring"] a[data-nav-child]', (els) => els.map((e) => e.textContent.trim()))
      check('/classes mobile sheet: "Tutoring" expands to the seven service links (PL-492)', eq(sheetKids, TUTORING), sheetKids.join(' · '))
      await page.close()

      // PL-492 / PL-495 / PL-453: the desktop checks — the folder opens from the
      // keyboard and Escape closes it; /team portraits are equal squares filling
      // a 3-up grid; the hero photo spans the section; and the white text over
      // the scrim MEASURES: the h1 at ≥3:1 at its worst pixel (large-text AA),
      // the 17px nav links at ≥4.5:1 at the 99th percentile and ≥3:1 worst,
      // sampled with the text layer hidden (the PL-453 technique, now a gate).
      const lum = (r, g, b) => {
        const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      async function contrastUnder(pg, selector, hide) {
        const boxes = await pg.$$eval(selector, (els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }))
        if (!boxes.length) return null
        await pg.evaluate((sels) => { document.querySelectorAll(sels).forEach((e) => { e.setAttribute('data-qa-vis', e.style.visibility); e.style.visibility = 'hidden' }) }, hide)
        const ratios = []
        for (const b of boxes) {
          if (b.w < 2 || b.h < 2) continue
          const png = PNG.sync.read(await pg.screenshot({ clip: { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.ceil(b.w), height: Math.ceil(b.h) }, type: 'png' }))
          for (let i = 0; i < png.data.length; i += 4) ratios.push(1.05 / (lum(png.data[i], png.data[i + 1], png.data[i + 2]) + 0.05))
        }
        await pg.evaluate((sels) => { document.querySelectorAll(sels).forEach((e) => { e.style.visibility = e.getAttribute('data-qa-vis') || '' }) }, hide)
        ratios.sort((a, b) => a - b)
        return { worst: ratios[0], p99: ratios[Math.floor(ratios.length * 0.01)], n: ratios.length }
      }
      const HIDE = '[data-nav-desktop] a, [data-nav-desktop] button, [data-testid="header-consult"], [data-testid="header-signin"], [data-testid="site-header"] img, h1, [data-testid="team-tagline"], [data-testid="classes-intro"], [data-testid="brand-lockup"]'
      const desk = await browser.newPage()
      await desk.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
      for (const [name, path] of [['/classes', '/classes'], ['/team', '/team'], ['class page', `/c/${IP_SLUG}`]]) {
        await desk.goto(`${base}${path}`, { waitUntil: 'networkidle0', timeout: 30_000 })
        const h1 = await contrastUnder(desk, 'h1', HIDE)
        check(`${name} hero headline holds ≥3:1 at its worst pixel over the scrim at 1280 (PL-453/495)`, h1 != null && h1.worst >= 3.0, h1 ? `worst ${h1.worst.toFixed(2)} p99 ${h1.p99.toFixed(2)} (${h1.n}px)` : 'no h1')
        const nav = await contrastUnder(desk, '[data-nav-desktop] a, [data-nav-desktop] button, [data-testid="header-signin"]', HIDE)
        check(`${name} overlay nav links hold ≥4.5:1 (p99) and ≥3:1 (worst) at 1280 (PL-492)`, nav != null && nav.p99 >= 4.5 && nav.worst >= 3.0, nav ? `worst ${nav.worst.toFixed(2)} p99 ${nav.p99.toFixed(2)} (${nav.n}px)` : 'no nav')
      }
      // keyboard: focus the folder button → open; Escape → closed.
      await desk.goto(`${base}/classes`, { waitUntil: 'networkidle0', timeout: 30_000 })
      const kb = await desk.evaluate(async () => {
        const btn = document.querySelector('[data-nav-folder="Tutoring"] button')
        const ul = document.querySelector('[data-nav-folder="Tutoring"] ul')
        if (!btn || !ul) return null
        const vis = () => ul.getBoundingClientRect().height > 0
        btn.focus()
        await new Promise((r) => setTimeout(r, 100))
        const afterFocus = vis()
        btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await new Promise((r) => setTimeout(r, 100))
        return { afterFocus, afterEscape: vis() }
      })
      check('/classes "Tutoring" opens from the keyboard and Escape closes it (PL-492)', kb != null && kb.afterFocus && !kb.afterEscape, JSON.stringify(kb))
      // PL-495: /team portraits + hero.
      await desk.goto(`${base}/team`, { waitUntil: 'networkidle0', timeout: 30_000 })
      const tiles = await desk.$$eval('[data-testid="team-portrait"], [data-testid="team-portrait-placeholder"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return [Math.round(r.width), Math.round(r.height), c.borderRadius, c.objectFit] }))
      // PL-500: circular — a 50% radius resolves to half the box in px (e.g. 153.5px on a 307px tile).
      check('/team portraits render as equal CIRCLES ≥ 240px at 1280, object-cover (PL-495/500)', tiles.length > 0 && tiles.every(([w, h, br, fit]) => Math.abs(w - h) <= 1 && w >= 240 && parseFloat(br) >= w / 2 - 1 && (fit === 'cover' || fit === 'normal')), `${tiles.length} tiles: ${[...new Set(tiles.map((t) => `${t[0]}x${t[1]} r=${t[2]}`))].join(', ')}`)
      const heroFit = await desk.evaluate(() => { const s = document.querySelector('[data-testid="team-hero"]'); const i = document.querySelector('[data-testid="team-photo"]'); if (!s || !i) return null; const a = s.getBoundingClientRect(); const b = i.getBoundingClientRect(); return { section: Math.round(a.width), img: Math.round(b.width), h: Math.round(a.height), ih: Math.round(b.height) } })
      check('/team hero photo covers the section\'s full width (PL-495)', heroFit != null && heroFit.img >= heroFit.section && heroFit.ih >= heroFit.h - 1, JSON.stringify(heroFit))
      const teamH = heroFit?.h ?? 0
      await desk.goto(`${base}/classes`, { waitUntil: 'networkidle0', timeout: 30_000 })
      const classesH = await desk.evaluate(() => Math.round(document.querySelector('[data-testid="page-hero"]')?.getBoundingClientRect().height ?? 0))
      check('/team and /classes heroes match in height at 1280 (PL-495)', teamH > 0 && Math.abs(teamH - classesH) <= 2, `team ${teamH} classes ${classesH}`)
      await desk.close()
    } finally {
      await cleanupInProgress()
    }
    const targets = [
      ['register page', `/register/${BAD_SLUG}`],
      ['calendar page', `/classes/${BAD_SLUG}/calendar`],
    ]
    for (const [name, path] of targets) {
      const page = await browser.newPage()
      let classInfoFetches = 0
      page.on('request', (r) => {
        if (r.url().includes('/api/class-info/')) classInfoFetches++
      })
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle0', timeout: 30_000 })
      // A retry loop reveals itself as extra fetches in this window.
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const h1 = await page.$eval('h1', (el) => el.textContent).catch(() => null)
      check(`${name} renders the friendly 404`, h1 === 'Class not found', `h1: ${JSON.stringify(h1)}`)
      const mainSiteLink = await page.$(`a[href="${MAIN_SITE}"]`)
      check(`${name} links back to the main site`, mainSiteLink !== null)
      check(`${name} fetched class-info exactly once`, classInfoFetches === 1, `${classInfoFetches} fetches`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

process.exit(failures > 0 ? 1 : 0)
