#!/usr/bin/env node
// PL-471 D: the standing PRE-FLIGHT before any data change during cutover —
// "what will the next N hours' sweeps send, to EVERY audience?" Instructor,
// school contact, staff alerts, timecards, calendar writes — plus the family
// sequence rows — projected from the same rules the sweeps run on (see
// app/utils/send-projection.ts). Read-only: nothing here sends or writes.
//
//   node scripts/project-sends.mjs --hours 24 [--class <uuid>] [--json]
//
// Exit code 0 always; the human reads the table. Pair it with the dry run:
// projection BEFORE the change, change, projection AFTER — the diff is what
// the change will make the portal send.
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
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
Object.assign(process.env, env)
const args = process.argv.slice(2)
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
const hours = Number(arg('--hours', '24')) || 24
const classId = arg('--class', undefined)
const asJson = args.includes('--json')

const tmp = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-project-'))
try {
  execSync(`npx tsc app/utils/send-projection.ts --outDir ${JSON.stringify(tmp)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`, { stdio: 'inherit' })
  const req = createRequire(import.meta.url)
  const { projectSends, renderProjection } = req(path.join(tmp, 'send-projection.js'))
  const report = await projectSends({ hours, classId })
  console.log(asJson ? JSON.stringify(report, null, 2) : renderProjection(report))
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
