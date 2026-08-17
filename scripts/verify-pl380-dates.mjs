#!/usr/bin/env node
// PL-380 verification: (1) the shared formatters render plain-English dates;
// (2) the REAL roster-report builder (utils/roster-report.ts, the exact code
// the Monday sweep sends) produces zero ISO dates in visible copy — and the
// fresh render goes to billy@ (standing test-send rule) under a test dedupe
// key so it never collides with the real weekly_digest send;
// (3) the T5 timecard subject/heading/preheader/{payPeriodRange} carry the
// plain pay period.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl380')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/roster-report.ts app/utils/timecards.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const dates = require(path.join(out, 'dates.js'))
const { buildRosterReportSections } = require(path.join(out, 'roster-report.js'))
const { loadClassBundles } = require(path.join(out, 'lifecycle.js'))
const { renderEmail } = require(path.join(out, 'comms-db-render.js'))

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

// (1) Formatters.
check('formatDateLong', dates.formatDateLong('2026-10-13') === 'October 13, 2026', dates.formatDateLong('2026-10-13'))
check('range same month', dates.formatDateRange('2026-08-01', '2026-08-15') === 'August 1 – 15, 2026', dates.formatDateRange('2026-08-01', '2026-08-15'))
check('range cross month', dates.formatDateRange('2026-08-25', '2026-09-08') === 'August 25 – September 8, 2026', dates.formatDateRange('2026-08-25', '2026-09-08'))
check('range cross year', dates.formatDateRange('2026-12-20', '2027-01-03') === 'December 20, 2026 – January 3, 2027', dates.formatDateRange('2026-12-20', '2027-01-03'))
check('range single day', dates.formatDateRange('2026-08-15', '2026-08-15') === 'August 15, 2026', dates.formatDateRange('2026-08-15', '2026-08-15'))

// (2) The real roster report, real bundles.
const bundles = await loadClassBundles()
check('bundles loaded', bundles.length > 0, `${bundles.length}`)
const sections = await buildRosterReportSections(bundles)
check('report has sections', sections.length > 0, `${sections.length}`)
const body = sections.join('')
// ISO dates in VISIBLE copy — strip attribute values (href/src) first.
const visible = body.replace(/(href|src)="[^"]*"/g, '')
const isoHits = visible.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []
check('zero ISO dates in visible report copy', isoHits.length === 0, isoHits.slice(0, 5).join(', '))
check('plain-English start dates present', /starts [A-Z][a-z]+ \d{1,2}, \d{4}/.test(body))

// (3) T5 subject/preheader/body via the registry pipeline with the value the
// fixed caller now passes.
const stubCtxMod = require(path.join(out, 'comms-registered.js'))
const stub = stubCtxMod.tutoringStubContext({ parentFirstName: 'Kelsie', parentEmail: 'billy@highergroundlearning.com' })
const t5 = await renderEmail(
  'T5_TIMECARD_READY', stub, 'parent',
  {
    tutorFirstName: 'Kelsie',
    payPeriodRange: dates.formatDateRange('2026-08-01', '2026-08-15'),
    timecardHours: '14.5',
    timecardLink: 'https://example.com/portal?view=tutor',
  },
  () => ({ subject: 'twin-not-needed', html: '<p>twin</p>' })
)
check('T5 subject plain period', t5.subject === 'Your timecard for August 1 – 15, 2026 is ready to confirm', t5.subject)
check('T5 body zero ISO dates', !/\b\d{4}-\d{2}-\d{2}\b/.test(t5.html.replace(/(href|src)="[^"]*"/g, '')))

// Send the fresh roster report to billy@ (test key, is_test-style tag).
const { Resend } = require(path.join(process.cwd(), 'node_modules', 'resend'))
const resend = new Resend(process.env.RESEND_API_KEY)
const { data, error } = await resend.emails.send({
  from: process.env.EMAIL_FROM,
  to: 'billy+pl380-roster@highergroundlearning.com',
  subject: '[PL-380 test] Admin roster report — classes vs. minimums & email health',
  html: body,
})
check('roster report test send → billy+pl380-roster@', !error, error?.message)
if (data?.id) console.log('  resend id', data.id)

console.log(`\n${pass} passed, ${fail} failed`)
rmSync(out, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
