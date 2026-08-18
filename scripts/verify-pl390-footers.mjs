#!/usr/bin/env node
// PL-390 verification: one fresh render per audience — staff sign-in line on
// staff/admin/tutor emails, family footer VERBATIM on family emails,
// counselor emails keep the family pointer (decided: they sign in at /portal
// with just their email). Sends one of each → billy+pl390-*@.
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl390')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-db-render.ts app/utils/email.ts app/utils/comms-registered.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { renderEmail } = require(path.join(out, 'comms-db-render.js'))
const email = require(path.join(out, 'email.js'))
const { tutoringStubContext } = require(path.join(out, 'comms-registered.js'))
const { SAMPLE_CONTEXT } = require(path.join(out, 'comms-variables.js'))

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const FAMILY_LINE = /sign in with just this email address, no password needed/
const STAFF_LINE = /Staff sign-in is always at[\s\S]*@highergroundlearning\.com Google account/

const stub = tutoringStubContext({ parentFirstName: 'Kelsie', parentEmail: 'billy@highergroundlearning.com' })

// 1. Tutor audience: T5 (live registry).
const t5 = await renderEmail('T5_TIMECARD_READY', stub, 'parent', {
  tutorFirstName: 'Kelsie', payPeriodRange: 'August 1 – 15, 2026', timecardHours: '14.5',
  timecardLink: 'https://example.com/portal?view=tutor',
}, () => ({ subject: 'twin', html: 'twin' }))
check('T5 (tutor): staff line present', STAFF_LINE.test(t5.html))
check('T5 (tutor): family line GONE', !FAMILY_LINE.test(t5.html))

// 2. Admin audience: sendAdminAlert fallback shape via footerStaff directly + AL registry.
const al = await renderEmail('AL_ROSTER_REPORT', stub, 'parent', {
  alertDetailsBlock: '<p>3 classes below minimum.</p>', counselorFirstName: 'Ops',
}, () => ({ subject: 'Admin roster report', html: email.wrap('<p>3 classes below minimum.</p>', { preheader: 'x', footer: email.footerStaff() }) }))
check('AL_ROSTER_REPORT (admin): staff line present', STAFF_LINE.test(al.html))
check('AL_ROSTER_REPORT (admin): family line GONE', !FAMILY_LINE.test(al.html))

// 3. Family audience: E0 parent (live registry) — family footer verbatim.
const fam = await renderEmail('E0_CONFIRM_PARENT', { ...SAMPLE_CONTEXT, parentFirstName: 'Marta' }, 'parent', {}, () => email.parentConfirmationEmail(SAMPLE_CONTEXT))
check('E0 (family): family line verbatim', FAMILY_LINE.test(fam.html))
check('E0 (family): no staff line', !STAFF_LINE.test(fam.html))

// 4. Counselor audience: CS_CLASS_CONFIRMED keeps the family-style pointer (decided).
const cs = await renderEmail('CS_CLASS_CONFIRMED', stub, 'parent', {
  counselorFirstName: 'Sam', salesPageLink: 'https://hgl.co/sls', courseDatesPhrase: 'from Sep 1 to Oct 1',
  enrollmentDeadline: 'September 1, 2026', classCapacity: '18', languageSuffix: '',
}, () => ({ subject: 'x', html: 'no-twin' }))
check('CS (counselor): family-style pointer kept (decided)', FAMILY_LINE.test(cs.html) && !STAFF_LINE.test(cs.html))

// Sends.
const { Resend } = require(path.join(process.cwd(), 'node_modules', 'resend'))
const resend = new Resend(process.env.RESEND_API_KEY)
for (const [to, r] of [
  ['billy+pl390-tutor@highergroundlearning.com', t5],
  ['billy+pl390-admin@highergroundlearning.com', al],
  ['billy+pl390-family@highergroundlearning.com', fam],
]) {
  const { data, error } = await resend.emails.send({ from: process.env.EMAIL_FROM, to, subject: '[PL-390 test] ' + r.subject, html: r.html })
  check(`send → ${to.split('@')[0]}@`, !error, error?.message)
}

console.log(`\n${pass} passed, ${fail} failed`)
rmSync(out, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
