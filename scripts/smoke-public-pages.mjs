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
async function cleanupInProgress() {
  const { data: cls } = await db.from('classes').select('id').eq('slug', IP_SLUG)
  for (const c of cls ?? []) {
    await db.from('sessions').delete().eq('class_id', c.id)
    await db.from('classes').delete().eq('id', c.id)
  }
  await db.from('schools').delete().eq('nickname', 'QASMOKE')
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
  check('/classes carries the new intro line + the "Talk to us" button', /Live test-prep classes at partner schools around the world, online, and at our HQ in Salt Lake City, USA\./.test(clHtml) && /data-testid="classes-talk-to-us"/.test(clHtml))
  for (const [name, path] of [['/classes', '/classes'], ['/{code} in progress', '/qasmoke'], ['/team', '/team'], ['/inquire', '/inquire']]) {
    const h = path === '/classes' ? clHtml : await (await fetch(`${base}${path}`)).text().catch(() => '')
    check(`${name} renders the site header + footer (PL-478)`, /data-testid="site-header"/.test(h) && /data-testid="site-footer"/.test(h))
  }
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
