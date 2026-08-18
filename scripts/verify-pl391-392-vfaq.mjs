#!/usr/bin/env node
// PL-391/392 verification via the COMPOSER PATH: the ACTIVE E3_VFAQ body in
// all FOUR gating combinations (diagnostics × school), asserting the bridge
// only introduces real content, no orphaned connective tissue, and every
// button renders block-level (no sentence fragments hanging off a button).
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl391')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-db-render.ts app/utils/email.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { renderEmail } = require(path.join(out, 'comms-db-render.js'))
const email = require(path.join(out, 'email.js'))
const { SAMPLE_CONTEXT } = require(path.join(out, 'comms-variables.js'))

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const shape = (diag, school) => ({
  ...SAMPLE_CONTEXT,
  hasDiagnostics: diag,
  isOpenEnrollment: !school,
  ...(school ? {} : { schoolName: 'Higher Ground Learning', schoolNickname: 'HGL', classType: 'SAT Math Deep Dive', className: 'HGL SAT Math Deep Dive' }),
})
const combos = {
  both: shape(true, true),
  diagOnly: shape(true, false),
  strategyOnly: shape(false, true),
  neither: shape(false, false),
}

// A button <a> is block-level iff its <p> contains nothing else.
const inlineButtonFrag = (h) => {
  for (const m of h.matchAll(/<p[^>]*>(.*?)<\/p>/gs)) {
    const inner = m[1]
    if (/background:#00AEEE/.test(inner)) {
      const stripped = inner.replace(/<a [^>]*background:#00AEEE[^>]*>.*?<\/a>/gs, '').trim()
      if (stripped !== '') return inner.slice(0, 120)
    }
  }
  return null
}

const renders = {}
for (const [name, ctx] of Object.entries(combos)) {
  renders[name] = (await renderEmail('E3_VFAQ', ctx, 'student', {}, () => email.faqEmail(ctx, 'student'))).html
  const twin = email.faqEmail(ctx, 'student').html
  const bridge = /Are you still here/.test(renders[name])
  const expectBridge = name !== 'neither'
  check(`${name}: bridge ${expectBridge ? 'present' : 'ABSENT'}`, bridge === expectBridge)
  check(`${name}: twin bridge agrees`, /Are you still here/.test(twin) === expectBridge)
  const frag = inlineButtonFrag(renders[name])
  check(`${name}: no mid-sentence button (registry)`, frag === null, frag ?? '')
  const twinFrag = inlineButtonFrag(twin)
  check(`${name}: no mid-sentence button (twin)`, twinFrag === null, twinFrag ?? '')
  check(`${name}: no unresolved vars`, !/\{[a-zA-Z][a-zA-Z0-9_]*\}/.test(renders[name].replace(/\{className\}|\{examName\}/g, '')))
}
check('both: diagnostic Q&A whole sentence + own-line button', /the test is right here, due [A-Z][a-z]+/.test(renders.both))
check('neither: miss-class FAQ still flows', /going to miss a class/.test(renders.neither))
check('diagOnly: strategy Q&A absent, diagnostic present', /diagnostic test information/.test(renders.diagOnly) && !/strategy session/i.test(renders.diagOnly))
check('strategyOnly: diagnostic absent, strategy present', !/diagnostic test information/.test(renders.strategyOnly) && /strategy session/i.test(renders.strategyOnly))

// Renderer enforcement check: a synthetic mid-sentence button splits visibly.
const { renderMarkdownBody } = require(path.join(out, 'comms-md.js'))
const synth = renderMarkdownBody('Click here: [button:Go](https://x) and enjoy.', {})
check('renderer: embedded button extracted to its own block', /<p style="margin:20px 0"><a /.test(synth) && /Click here:/.test(synth) && /and enjoy\./.test(synth), synth.slice(0, 200))

// Test send: the no-diagnostics/no-strategy (Deep Dive) shape per the doc.
const { Resend } = require(path.join(process.cwd(), 'node_modules', 'resend'))
const resend = new Resend(process.env.RESEND_API_KEY)
const r = await renderEmail('E3_VFAQ', combos.neither, 'student', {}, () => email.faqEmail(combos.neither, 'student'))
const { data, error } = await resend.emails.send({
  from: process.env.EMAIL_FROM,
  to: 'billy+pl391-vfaq-deepdive@highergroundlearning.com',
  subject: '[PL-391/392 test: Deep Dive shape] ' + r.subject,
  html: r.html,
})
check('test send → billy+pl391-vfaq-deepdive@', !error, error?.message)
if (data?.id) console.log('  resend id', data.id)

console.log(`\n${pass} passed, ${fail} failed`)
rmSync(out, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
