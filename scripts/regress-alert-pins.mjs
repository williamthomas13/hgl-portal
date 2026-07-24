#!/usr/bin/env node
// PL-137 gate (static + computed, no DB/network): every registry template
// whose body uses {alertDetailsBlock} must have its OWN sample pin.
//
// Without a pin, a template falls back to the shared sample — which is the
// registration story ("Ana García registered for SIS SAT Prep… 3 enrolled /
// 8 min / 15 cap"). Reviewing a coverage alert and reading registration copy
// makes the review surface lie about a send that is actually correct. This
// is the PL-96 class of bug, and this gate is how it stops recurring.
//
// Also asserts the coverage pins are COMPUTED from the real composer, not
// hand-written: the pinned HTML must equal what coverage-copy.ts produces.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-pins')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-variables.ts app/utils/coverage-copy.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const vars = require(path.join(out, 'comms-variables.js'))
const copy = require(path.join(out, 'coverage-copy.js'))

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

// ---- 1. Every {alertDetailsBlock} template has a pin ----------------------
const seed = readFileSync('app/utils/comms-template-seed.ts', 'utf8')
// Split the seed into per-template chunks and keep the ones using the block.
const chunks = seed.split(/template_key: '/).slice(1)
const needPins = []
for (const chunk of chunks) {
  const key = chunk.slice(0, chunk.indexOf("'"))
  const body = chunk.slice(0, chunk.indexOf('\n  },'))
  if (body.includes('{alertDetailsBlock}')) needPins.push(key)
}
const pinned = Object.keys(vars.SAMPLE_EXTRA_BY_TEMPLATE ?? {})
const missing = needPins.filter((k) => !pinned.includes(k))
check(
  `1. every {alertDetailsBlock} template has its own sample pin`,
  missing.length === 0,
  missing.length ? `MISSING: ${missing.join(', ')}` : `${needPins.length} templates checked, all pinned`
)

// ---- 2. The coverage pins exist and are coverage-flavoured ----------------
for (const key of ['AL_COVERAGE_REQUEST', 'AL_COVERAGE_RESOLVED']) {
  const pin = vars.SAMPLE_EXTRA_BY_TEMPLATE?.[key]
  const html = pin?.alertDetailsBlock ?? ''
  check(`2.${key}: pin exists`, Boolean(html))
  check(
    `3.${key}: zero registration copy in the sample`,
    !/registered for|enrolled \/|Add-on purchased/i.test(html),
    html.slice(0, 80)
  )
  check(
    `4.${key}: reads as coverage (names the substitute exchange)`,
    /cover|coverage/i.test(html),
    html.slice(0, 80)
  )
}

// ---- 3. Drift guard: the pins EQUAL the real composer's output ------------
const facts = {
  studentName: 'Ana García',
  studentFirst: 'Ana',
  studentId: '00000000-0000-4000-8000-000000000005',
  subjectName: 'SAT Math',
  when: 'Thursday, September 10 at 4:00 PM',
  requesterName: 'Billy Thomas',
  candidateName: 'Jordan Lee',
  baseUrl: 'https://hgl-portal.vercel.app',
}
check(
  '5. AL_COVERAGE_REQUEST pin is computed from the composer (no drift)',
  vars.SAMPLE_EXTRA_BY_TEMPLATE.AL_COVERAGE_REQUEST.alertDetailsBlock ===
    copy.coverageAlertDetails({ ...facts, event: 'requested' })
)
check(
  '6. AL_COVERAGE_RESOLVED pin is the ACCEPTED variant, from the composer',
  vars.SAMPLE_EXTRA_BY_TEMPLATE.AL_COVERAGE_RESOLVED.alertDetailsBlock ===
    copy.coverageAlertDetails({ ...facts, event: 'accepted' })
)

// ---- 4. All four outcome variants render distinctly ----------------------
const variants = ['requested', 'accepted', 'declined', 'cancelled'].map((event) =>
  copy.coverageAlertDetails({ ...facts, event })
)
check('7. all four coverage variants render distinct copy', new Set(variants).size === 4)
check(
  '8. the declined variant says the session still needs coverage',
  /still needs coverage/i.test(variants[2])
)
check(
  '9. the withdrawn variant says the tutor is keeping the session',
  /keeping the session/i.test(variants[3])
)
check(
  '10. every variant deep-links the student schedule (standing rule)',
  variants.every((v) => v.includes('/admin/tutoring?schedule=')),
)

rmSync(out, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
