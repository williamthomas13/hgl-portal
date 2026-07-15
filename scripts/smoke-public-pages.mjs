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

import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

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
