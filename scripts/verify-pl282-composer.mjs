#!/usr/bin/env node
// PL-282 verification via the COMPOSER PATH (standing rule): render the two
// live returning-family templates through renderEmail — the exact call
// sweepThankYou makes — across all four pronoun states, and render the code
// twin fallback alongside. Asserts: correct subjects, {she_he_they} {is_are}
// agreement, no placeholder remnants, no unresolved {variables}, and the
// twin carries the same copy.
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl282')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-db-render.ts app/utils/email.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { renderEmail } = require(path.join(out, 'comms-db-render.js'))
const { returningThanksEmail } = require(path.join(out, 'email.js'))
const { SAMPLE_CONTEXT } = require(path.join(out, 'comms-variables.js'))

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

// The full sample context (the editor/view-as composer input) with the
// fields we assert on pinned — a minimal ctx breaks eager resolvers.
const baseCtx = {
  ...SAMPLE_CONTEXT,
  parentFirstName: 'Marta',
  studentFirstName: 'Ana',
  studentEmail: 'qa-s@example.com',
}

const states = [
  { p: 'she_her', subj: 'she', is: 'is' },
  { p: 'he_him', subj: 'he', is: 'is' },
  { p: 'name_only', subj: 'Ana', is: 'is' },
  { p: null, subj: 'they', is: 'are' },
]

for (const st of states) {
  const ctx = { ...baseCtx, studentPronouns: st.p }
  const parent = await renderEmail('E1_RETURNING_PARENT', ctx, 'parent', {}, () =>
    returningThanksEmail(ctx, 'parent')
  )
  const label = st.p ?? 'unset'
  check(`parent[${label}] subject`, parent.subject === 'Thank you (again!), Marta', parent.subject)
  check(`parent[${label}] registry version used`, Boolean(parent.versionId), 'fell back to code twin — template not live?')
  check(
    `parent[${label}] pronoun agreement`,
    parent.html.includes(`we know what ${st.subj} ${st.is} capable of`),
    'agreement sentence missing/wrong'
  )
  check(`parent[${label}] no placeholder`, !parent.html.includes('PLACEHOLDER'))
  const leftover = parent.html.match(/\{[a-zA-Z_]+\}/g)
  check(`parent[${label}] no unresolved vars`, !leftover, String(leftover))
  check(`parent[${label}] diagnostics-agnostic`, !/diagnostic/i.test(parent.html))

  const twin = returningThanksEmail(ctx, 'parent')
  check(
    `parent[${label}] twin copy matches`,
    twin.subject === parent.subject &&
      twin.html.replace(/\s+/g, ' ').includes(`we know what ${st.subj} ${st.is} capable of`),
    'twin drifted'
  )
}

const ctx = { ...baseCtx, studentPronouns: null }
const student = await renderEmail('E1_RETURNING_STUDENT', ctx, 'student', {}, () =>
  returningThanksEmail(ctx, 'student')
)
check('student subject', student.subject === 'Ana, welcome back', student.subject)
check('student registry version used', Boolean(student.versionId))
check('student greeting', student.html.includes('Hey Ana,'))
check('student copy line', student.html.includes('keep leveling up'))
check('student no placeholder', !student.html.includes('PLACEHOLDER'))
const sLeft = student.html.match(/\{[a-zA-Z_]+\}/g)
check('student no unresolved vars', !sLeft, String(sLeft))
const sTwin = returningThanksEmail(ctx, 'student')
check(
  'student twin copy matches',
  sTwin.subject === student.subject && /keep leveling up/.test(sTwin.html)
)

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
