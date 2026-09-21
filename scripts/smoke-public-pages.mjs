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
const STATE_SLUGS = { open: 'qa-smoke-open', full: 'qa-smoke-full', closed: 'qa-smoke-closed', cancelled: 'qa-smoke-cancelled' }
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
  await mk(STATE_SLUGS.open, { first: 30, close: 25 })
  await mk(STATE_SLUGS.full, { first: 30, close: 25, capacity: 1, paid: true })
  await mk(STATE_SLUGS.closed, { first: -30, close: -35 })
  await mk(STATE_SLUGS.cancelled, { first: 30, close: 25, status: 'cancelled' })
  await db.from('schools').insert([{ name: 'QA Smoke School Two', nickname: 'QASMOKE2', timezone: 'Europe/Rome', city: 'Milan', evergreen_code: 'qasmoke2', collateral_language: 'en' }])
}
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
  }
  // PL-489: the header/footer audit — one URL per public state, gated.
  const { data: smokeSchool } = await db.from('schools').select('id').eq('nickname', 'QASMOKE').maybeSingle()
  await createStateFixtures(smokeSchool.id)
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

  // PL-488: the inquiry API refuses a blank required field (server-side, naming it) and accepts a blank "anything else" (the honeypot is set so no row is written).
  const full = { parentFirst: 'QA', parentLast: 'Smoke', parentEmail: 'billy+qasmoke-inq@highergroundlearning.com', parentPhoneCountry: '+1', parentPhone: '801 555 0100', connectPref: 'Email', studentFirst: 'QA', studentLast: 'Student', studentSchool: 'Homeschooled', subject: 'SAT', other: '', company: 'bot' }
  const post = (b) => fetch(`${base}/api/inquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  const okRes = await post(full)
  check('inquiry API accepts every required field + a BLANK "anything else"', okRes.status === 200, `status ${okRes.status}`)
  for (const k of ['parentFirst', 'parentLast', 'parentEmail', 'parentPhone', 'connectPref', 'studentFirst', 'studentLast', 'studentSchool', 'subject']) {
    const r = await post({ ...full, [k]: '' })
    const j = await r.json().catch(() => ({}))
    check(`inquiry API rejects a blank "${k}" and names it`, r.status === 400 && /Please fill in:/.test(j.error ?? '') && Array.isArray(j.missing) && j.missing.length === 1, `${r.status} ${j.error ?? ''}`)
  }
  const embedJs = await (await fetch(`${base}/embed/inquire.js`)).text().catch(() => '')
  check('inquiry embed carries the same required set (data-require switch retired)', !/data-require/.test(embedJs) && (embedJs.match(/"required":true/g) ?? []).length === 9)
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
      await page.close()
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
