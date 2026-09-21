#!/usr/bin/env node
// PL-309 gate: every alert template in the registry maps to exactly one
// subscription category — no orphans. Walks TEMPLATE_LABELS' AL_*/ADMIN_*
// keys against TEMPLATE_ALERT_CATEGORY, and checks every mapped category
// actually exists in ALERT_CATEGORIES.
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'

// PL-487: cleanup must never decide the exit code — a sandboxed shell cannot
// delete files (EPERM at the END of an otherwise successful run); warn and go on.
function safeRm(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.warn(`note: could not remove temp dir ${dir} (${e?.code ?? e}) — harmless, delete it by hand`)
  }
}


// PL-487: a FRESH temp dir each run — never an rmSync of a fixed path at the
// start (a sandboxed shell cannot delete, which blocked the run outright).
const out = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-build-alert-cats-'))
execSync(
  `npx tsc app/utils/comms.ts app/utils/alert-categories.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { TEMPLATE_LABELS } = require(path.join(out, 'comms.js'))
const { TEMPLATE_ALERT_CATEGORY, ALERT_CATEGORIES } = require(path.join(out, 'alert-categories.js'))

let fail = 0
const check = (name, ok, detail = '') =>
  console.log(`${ok ? 'PASS' : (fail++, 'FAIL')}  ${name}${detail ? ' — ' + detail : ''}`)

const alertKeys = Object.keys(TEMPLATE_LABELS).filter((k) => /^AL_|^ADMIN_/.test(k))
const orphans = alertKeys.filter((k) => !TEMPLATE_ALERT_CATEGORY[k])
check(`every alert template maps to a category (${alertKeys.length} keys)`, orphans.length === 0, orphans.join(', '))

const catKeys = new Set(ALERT_CATEGORIES.map((c) => c.key))
const badCats = Object.entries(TEMPLATE_ALERT_CATEGORY).filter(([, c]) => !catKeys.has(c))
check('every mapped category exists', badCats.length === 0, badCats.map(([k]) => k).join(', '))

safeRm(out)
process.exit(fail ? 1 : 0)
