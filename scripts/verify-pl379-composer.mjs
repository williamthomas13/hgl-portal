#!/usr/bin/env node
// PL-379 verification via the COMPOSER PATH (standing rule): render every
// touched template through renderEmail — the exact call the send paths make
// against the ACTIVE registry bodies — in three class shapes:
//   A. school class WITH diagnostics   (the historical default — copy unchanged)
//   B. open class WITHOUT diagnostics  (Deep-Dive shape — zero diagnostic or
//      strategy-session promises anywhere)
//   C. school class WITHOUT diagnostics (strategy Q&A stays, score-report
//      clause inside it drops)
// Asserts on both the DB render and the code-twin fallback.
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl379')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-db-render.ts app/utils/email.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { renderEmail } = require(path.join(out, 'comms-db-render.js'))
const email = require(path.join(out, 'email.js'))
const { SAMPLE_CONTEXT } = require(path.join(out, 'comms-variables.js'))

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const CASES = {
  A: { ...SAMPLE_CONTEXT, parentFirstName: 'Marta', studentFirstName: 'Ana', isOpenEnrollment: false, hasDiagnostics: true },
  B: {
    ...SAMPLE_CONTEXT, parentFirstName: 'Marta', studentFirstName: 'Ana',
    isOpenEnrollment: true, hasDiagnostics: false,
    schoolName: 'Higher Ground Learning', schoolNickname: 'HGL',
    classType: 'SAT Math Deep Dive', className: 'HGL SAT Math Deep Dive',
  },
  C: { ...SAMPLE_CONTEXT, parentFirstName: 'Marta', studentFirstName: 'Ana', isOpenEnrollment: false, hasDiagnostics: false },
}

const noDiag = (h) => !/diagnostic/i.test(h)
const noStrat = (h) => !/strategy session/i.test(h)
const clean = (h) => !/\{[a-zA-Z][a-zA-Z0-9_]*\}/.test(h) && !/<li>\s*<\/li>/.test(h) && !/,\s*,/.test(h) && !/—\s*,/.test(h)

const T = async (key, ctx, audience, fallback) =>
  (await renderEmail(key, ctx, audience, {}, () => fallback(ctx, audience))).html

// --- E0_CONFIRM_PARENT: portal scores clause -------------------------------
{
  const a = await T('E0_CONFIRM_PARENT', CASES.A, 'parent', (c) => email.parentConfirmationEmail(c))
  const b = await T('E0_CONFIRM_PARENT', CASES.B, 'parent', (c) => email.parentConfirmationEmail(c))
  check('E0-P A: portal promises diagnostic scores', /diagnostic scores once they('|&#39;|’)re in/.test(a))
  check('E0-P B: no diagnostic mention', noDiag(b))
  check('E0-P B: receipts→calendar list joins cleanly', /your receipts, a\s+calendar feed/.test(b.replace(/\n/g, ' ')) || /your receipts, a calendar feed/.test(b))
  check('E0-P B: clean render', clean(b))
}

// --- E0_CONFIRM_STUDENT: compass strategy bullet ---------------------------
{
  const a = await T('E0_CONFIRM_STUDENT', CASES.A, 'student', (c) => email.studentConfirmationEmail(c))
  const b = await T('E0_CONFIRM_STUDENT', CASES.B, 'student', (c) => email.studentConfirmationEmail(c))
  check('E0-S A: strategy bullet present ("your free")', /How to best take advantage of your free 30-minute strategy session/.test(a))
  check('E0-S B: no strategy mention', noStrat(b))
  check('E0-S B: no diagnostic mention', noDiag(b))
  check('E0-S B: no empty bullet', clean(b))
  check('E0-S B: list still renders (compass items)', /test anxiety/.test(b))
}

// --- E1_THANKS: compass strategy bullet ("the free") -----------------------
{
  const a = await T('E1_THANKS', CASES.A, 'parent', (c) => email.thankYouEmail(c))
  const b = await T('E1_THANKS', CASES.B, 'parent', (c) => email.thankYouEmail(c))
  check('E1 A: strategy bullet present ("the free")', /How to best take advantage of the free 30-minute strategy session/.test(a))
  check('E1 B: no strategy mention', noStrat(b))
  check('E1 B: clean render', clean(b))
}

// --- E3_VFAQ: strategy Q&A gates on school; score-report clause on diag ----
{
  const a = await T('E3_VFAQ', CASES.A, 'student', (c, aud) => email.faqEmail(c, aud))
  const b = await T('E3_VFAQ', CASES.B, 'student', (c, aud) => email.faqEmail(c, aud))
  const c3 = await T('E3_VFAQ', CASES.C, 'student', (c, aud) => email.faqEmail(c, aud))
  check('VFAQ A: strategy Q&A present w/ score report', /What is the 30-minute strategy session/.test(a) && /understand your diagnostic score report/.test(a))
  check('VFAQ B: no strategy Q&A', noStrat(b) && !/strategy/i.test(b))
  check('VFAQ B: no diagnostic mention anywhere (FAQ links pruned too)', noDiag(b))
  check('VFAQ C: strategy Q&A present WITHOUT score report', /What is the 30-minute strategy session/.test(c3) && !/diagnostic score report/.test(c3))
  check('VFAQ C: mindset→day-of joins cleanly', /test-day mindset,\s*or go over day-of/.test(c3.replace(/\n\s*/g, ' ')))
  check('VFAQ B: clean render', clean(b))
}

// --- LR_WELCOME: section drop + clean renumbering + FAQ topics -------------
{
  const aP = await T('LR_WELCOME', CASES.A, 'parent', (c, aud) => email.lateRegistrationWelcomeEmail(c, aud))
  const aS = await T('LR_WELCOME', CASES.A, 'student', (c, aud) => email.lateRegistrationWelcomeEmail(c, aud))
  const b = await T('LR_WELCOME', CASES.B, 'parent', (c, aud) => email.lateRegistrationWelcomeEmail(c, aud))
  check('LR A parent: diagnostic section is #1', /1\. The diagnostic test/.test(aP))
  check('LR A parent: possessive name in section', /Ana('|&#39;|’)s<\/strong>|Ana('|&#39;|’)s first diagnostic/.test(aP.replace(/\n\s*/g, ' ')))
  check('LR A student: "Your first diagnostic"', /Your first diagnostic test is ready/.test(aS.replace(/\n\s*/g, ' ')))
  check('LR A: numbering 1/2/3', /2\. When and where/.test(aP) && /3\. Good things to know/.test(aP))
  check('LR A: strategy session in FAQ topics', /the free 30-minute strategy session/.test(aP))
  check('LR B: no diagnostic section', noDiag(b))
  check('LR B: renumbered 1/2 (no leading 2.)', /1\. When and where/.test(b) && /2\. Good things to know/.test(b) && !/3\. Good things/.test(b))
  check('LR B: FAQ topics without strategy session', /class times and what to do if Ana misses a session/.test(b.replace(/\n\s*/g, ' ')) && noStrat(b))
  check('LR B: clean render', clean(b))
}

// --- W2_SPOT_OPEN: recap composes from the includes phrase -----------------
{
  const a = await T('W2_SPOT_OPEN', CASES.A, 'parent', (c) =>
    email.waitlistOfferEmail(c, 'https://x/claim', 'https://x/decline', new Date(Date.now()+48*3600*1000).toISOString()))
  const b = await T('W2_SPOT_OPEN', CASES.B, 'parent', (c) =>
    email.waitlistOfferEmail(c, 'https://x/claim', 'https://x/decline', new Date(Date.now()+48*3600*1000).toISOString()))
  check('W2 A: recap promises diagnostic test access', /diagnostic test access/.test(a))
  check('W2 B: no diagnostic promise', noDiag(b))
  check('W2 B: location phrase present', /the classroom location|the meeting link for class/.test(b))
  check('W2 B: clean render', clean(b))
}

// --- CS_CLASS_CONFIRMED: counselor portal phrase ---------------------------
{
  const mk = (base) => ({ ...base, parentFirstName: 'Counselor' })
  const extra = {
    counselorFirstName: 'Sam', salesPageLink: 'https://hgl.co/sls-sat', courseDatesPhrase: 'from Sep 1 to Oct 1',
    enrollmentDeadline: 'September 1, 2026', classCapacity: '18', languageSuffix: '',
  }
  const a = (await renderEmail('CS_CLASS_CONFIRMED', mk(CASES.A), 'parent', extra, () => ({ subject: 'x', html: 'no-twin' }))).html
  const c3 = (await renderEmail('CS_CLASS_CONFIRMED', mk(CASES.C), 'parent', extra, () => ({ subject: 'x', html: 'no-twin' }))).html
  check('CS A: portal promises diagnostic scores', /diagnostic scores once the class is underway/.test(a))
  check('CS C (no-diag school class): no diagnostic promise', noDiag(c3))
  check('CS C: enrollment+attendance joins cleanly', /live enrollment for .* and attendance\./.test(c3.replace(/\n\s*/g, ' ')))
  check('CS C: clean render', clean(c3))
}

console.log(`\n${pass} passed, ${fail} failed`)
rmSync(out, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
