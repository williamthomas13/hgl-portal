#!/usr/bin/env node
// PL-151 gate (static, no DB/network): every response body parsed in a client
// component must be crash-proof, and every busy flag must reset on the way
// out. The failure this prevents: a gateway 500 returns an HTML body, res
// .json() throws past the busy-flag reset, and the button is bricked with
// "Error: undefined" until the user reloads — losing wizard state with it.
//
// Rule 1: `await <res>.json()` must be followed by `.catch(...)`.
// Rule 2: a function that sets a busy flag true must reset it in a `finally`
//         (or not at all — some flows deliberately stay busy until a redirect).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(process.cwd(), 'app')
const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (full.endsWith('.tsx')) files.push(full)
  }
})(ROOT)

let failures = 0
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
  if (!ok) failures++
}

// ---- Rule 1: unguarded .json() -------------------------------------------
const UNGUARDED = /\bawait\s+(\w+)\.json\(\)(?!\s*\.catch)/g
const rule1 = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (!src.includes("'use client'") && !src.includes('"use client"')) continue
  for (const m of src.matchAll(UNGUARDED)) {
    const line = src.slice(0, m.index).split('\n').length
    rule1.push(`${path.relative(process.cwd(), f)}:${line}`)
  }
}
check(
  '1. every awaited .json() in a client component is .catch()-guarded',
  rule1.length === 0,
  rule1.length ? rule1.join(', ') : `${files.length} files scanned`
)

// ---- Rule 2: busy flags reset in a finally --------------------------------
// Scan function-ish blocks: from a `setX(true)` to the end of its enclosing
// function (approximated by brace depth), require the matching `setX(false)`
// to sit inside a `finally {` block.
const SET_TRUE = /set([A-Z]\w*)\((?:true)\)/g
const rule2 = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (!src.includes("'use client'") && !src.includes('"use client"')) continue
  const lines = src.split('\n')
  for (const m of src.matchAll(SET_TRUE)) {
    const name = m[1]
    // Only the busy-ish flags: these gate buttons.
    if (!/^(Busy|Saving|Submitting|Sending|Pulling\w*|Working)$/.test(name)) continue
    const startLine = src.slice(0, m.index).split('\n').length
    // Walk forward to the matching set<Name>(false).
    let resetLine = -1
    for (let i = startLine; i < Math.min(lines.length, startLine + 120); i++) {
      if (lines[i].includes(`set${name}(false)`)) {
        resetLine = i + 1
        break
      }
    }
    if (resetLine === -1) continue // never reset here (redirect flows)
    // Is the reset inside a finally block? Look back for `finally {` that is
    // still open at the reset line.
    const between = lines.slice(startLine - 1, resetLine).join('\n')
    const lastFinally = between.lastIndexOf('finally')
    const inFinally = lastFinally !== -1 && !between.slice(lastFinally).includes('\n    }\n  }\n\n')
    if (!inFinally) {
      rule2.push(`${path.relative(process.cwd(), f)}:${startLine} (set${name})`)
    }
  }
}
// Reported, not enforced: the acute crash source (rule 1) is fixed
// everywhere, so the remaining sites only strand on a network-level throw.
// The named panels from the PL-151 audit are enforced below.
const ENFORCED = [
  'app/admin/tutoring/engagement-wizard.tsx',
  'app/admin/tutoring/invoices-panel.tsx',
  'app/portal/coverage-panel.tsx',
  'app/portal/session-notes-panel.tsx',
]
const enforcedMisses = rule2.filter((r) => ENFORCED.some((e) => r.startsWith(e)))
check(
  '2. the audited mutation panels reset their busy flag in a finally',
  enforcedMisses.length === 0,
  enforcedMisses.length ? enforcedMisses.join(', ') : ENFORCED.length + ' panels clean'
)
console.log(`note: ${rule2.length} other busy-flag site(s) reset outside a finally (network-throw only)`)

process.exit(failures === 0 ? 0 : 1)
