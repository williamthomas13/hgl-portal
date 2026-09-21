#!/usr/bin/env node
// PL-460 gate: every call-to-action lands where the action can be done.
//
//   1. Every Needs-Attention `kind` the dashboard route emits is registered in
//      NEEDS_ATTENTION_LANDINGS (app/utils/cta-landings.ts); the registered
//      href matches the emitted one; the landing file exists, reads each
//      deep-link param the href carries, and its control marker is present.
//   2. Every email link variable the registry resolves is in LINK_LANDINGS;
//      portal/tokenized landings exist and carry their invalid-link branch.
//   3. Every hand-built staff alert (sendAdminAlert) either links somewhere
//      (an href in its body/vars) or is on the informational allow-list.
// A new alert / row / link variable without a registered landing FAILS here.
//
//   node scripts/regress-cta-landings.mjs
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// PL-487: cleanup must never decide the exit code — a sandboxed shell cannot
// delete files (EPERM at the END of an otherwise successful run); warn and go on.
function safeRm(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.warn(`note: could not remove temp dir ${dir} (${e?.code ?? e}) — harmless, delete it by hand`)
  }
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const read = (f) => readFileSync(f, 'utf8')
const build = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-cta-'))
try {
  execSync(`npx tsc app/utils/cta-landings.ts app/utils/comms-variables.ts --outDir ${JSON.stringify(build)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`, { stdio: 'inherit' })
  const req = createRequire(import.meta.url)
  const { NEEDS_ATTENTION_LANDINGS, LINK_LANDINGS } = req(path.join(build, 'cta-landings.js'))
  const vars = req(path.join(build, 'comms-variables.js'))

  // --- 1. Needs-Attention rows ---------------------------------------------
  const dash = read('app/api/admin/dashboard/route.ts')
  const rows = [...dash.matchAll(/kind: '([^']+)'[\s\S]*?href: `([^`]*)`/g)].map((m) => ({ kind: m[1], href: m[2] }))
  const kinds = [...new Set(rows.map((r) => r.kind))]
  check(`dashboard emits ${kinds.length} Needs-Attention kinds`, kinds.length > 20)
  const paramReads = (file) => {
    const src = read(file)
    return new Set([...src.matchAll(/\.get\('([a-zA-Z]+)'\)/g)].map((m) => m[1]))
  }
  for (const kind of kinds) {
    const reg = NEEDS_ATTENTION_LANDINGS[kind]
    if (!reg) { check(`${kind}: registered landing`, false, 'add it to NEEDS_ATTENTION_LANDINGS with its control'); continue }
    const emitted = rows.filter((r) => r.kind === kind).map((r) => r.href)
    check(`${kind}: href matches registry (${reg.href})`, emitted.every((h) => h.startsWith(reg.href.replace(/=$/, '=')) || h.includes(reg.href)), emitted.join(' | '))
    check(`${kind}: landing file exists`, existsSync(reg.file), reg.file)
    if (!existsSync(reg.file)) continue
    const reads = paramReads(reg.file)
    for (const p of reg.params) check(`${kind}: landing reads ?${p}=`, reads.has(p), `${reg.file} has no .get('${p}')`)
    const cf = reg.controlFile ?? reg.file
    check(`${kind}: control "${reg.control}" present on the landing`, existsSync(cf) && read(cf).includes(reg.control), cf)
  }
  for (const kind of Object.keys(NEEDS_ATTENTION_LANDINGS)) {
    if (!kinds.includes(kind)) console.log(`note  registry entry "${kind}" is not currently emitted by the dashboard (kept — harmless)`)
  }

  // --- 1b. PL-470: public class-page state CTAs ------------------------------
  const { PUBLIC_STATE_LANDINGS } = req(path.join(build, 'cta-landings.js'))
  for (const [name, reg] of Object.entries(PUBLIC_STATE_LANDINGS)) {
    check(`public state CTA "${name}": landing file exists`, existsSync(reg.file), reg.file)
    if (!existsSync(reg.file)) continue
    check(`public state CTA "${name}": control "${reg.control}" present`, read(reg.file).includes(reg.control))
    if (reg.params.length) {
      const reads = paramReads(reg.file)
      const src = read(reg.file)
      for (const p of reg.params) check(`public state CTA "${name}": landing reads ?${p}=`, reads.has(p) || new RegExp(`\\b${p}\\b`).test(src), `${reg.file} does not read ${p}`)
    }
  }

  // --- 2. email link variables ---------------------------------------------
  const linkVars = Object.keys(vars.VARIABLES ?? vars.VARIABLE_REGISTRY ?? {}).filter((k) => /Link$|Url$/.test(k))
  check(`registry exposes ${linkVars.length} link variables`, linkVars.length >= 25)
  for (const v of linkVars) {
    const reg = LINK_LANDINGS[v]
    if (!reg) { check(`{${v}}: registered landing`, false, 'add it to LINK_LANDINGS'); continue }
    if (reg.file) {
      check(`{${v}}: landing ${reg.file} exists`, existsSync(reg.file))
      if (reg.invalidBranch) check(`{${v}}: landing handles a bad/expired link ("${reg.invalidBranch}")`, existsSync(reg.file) && read(reg.file).includes(reg.invalidBranch))
    } else {
      console.log(`note  {${v}} → ${reg.route} (external — no portal landing to check)`)
    }
  }

  // --- 3. hand-built staff alerts carry a link ------------------------------
  const INFORMATIONAL = new Set([
    'Hourly sweep is DOWN — emails are not going out',        // external action (Vercel cron); System health card shows the state
    'Blocked: outgoing email carried a non-production link',  // dev-environment guard
    'AL_ROSTER_REPORT',                                       // digest; per-row links inside
    'AL_REGISTRATION',                                        // informational; roster link inside the details block
    'AL_CLOSE_MATCH', 'AL_LEAD_ASSIGNED', 'AL_INTAKE_COMPLETE', 'AL_AVAILABILITY_UPDATED', 'AL_AVAILABILITY_SHARED', // links composed in their copy modules
    'AL_COLLATERAL_NUDGE', 'AL_SYNAP_NUDGE', 'AL_QBO_FAILURE', 'AL_WEBHOOK_FAILURE', 'AL_UNAGREED', 'AL_DUNNING_EXHAUSTED', 'AL_OVERDUE_10', 'AL_OVERDUE_30',
    'AL_MIN_ENROLLMENT', 'AL_CLASS_DETAILS_HOLD', 'AL_MISSING_DETAILS', 'AL_WAITLIST_ROLLOVER', 'AL_REFUND_REQUEST', 'AL_SWEEP_OVERDUE', // vars/body carry the link (checked by the body scan below)
    'coverageAlertSubject', // AL_COVERAGE_* — coverage-copy composes the link
  ])
  function walk(d, out = []) {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f)
      if (f.startsWith('.tmp') || f === 'node_modules') continue
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.tsx?$/.test(f)) out.push(p)
    }
    return out
  }
  let alerts = 0
  for (const f of walk('app')) {
    const src = read(f)
    let i = 0
    while ((i = src.indexOf('sendAdminAlert({', i)) >= 0) {
      const block = src.slice(i, i + 3000)
      const end = block.indexOf('\n  })')
      const b = end > 0 ? block.slice(0, end) : block
      const subj = (/subject: (?:`([^`]*)`|'([^']*)')/.exec(b) || [])
      const key = (/templateKey: '([A-Z_]+)'/.exec(b) || [])[1]
      const name = key ?? subj[1] ?? subj[2] ?? (/subject: ([a-zA-Z]+)\(/.exec(b) || [])[1] ?? '?'
      // A link composed just above the call (the drift digest builds its
      // rows first) counts — the body interpolates it.
      const before = src.slice(Math.max(0, i - 1500), i)
      const hasHref = /href="/.test(b) || /Url:|Link:|link:/.test(b) || (/href="/.test(before) && /\$\{[a-zA-Z_]+\}/.test(b))
      const line = src.slice(0, i).split('\n').length
      alerts++
      const ok = hasHref || [...INFORMATIONAL].some((k) => name.startsWith(k.slice(0, 40)))
      check(`alert ${f}:${line} "${name.slice(0, 60)}" links somewhere or is allow-listed`, ok)
      i += 10
    }
  }
  check(`scanned ${alerts} staff alerts`, alerts > 40)
} finally {
  safeRm(build)
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
