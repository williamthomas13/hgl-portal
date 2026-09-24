#!/usr/bin/env node
// PL-506 gate: the homepage strip's state pick + orderings — the SAME pure
// module the embed runs (app/utils/embed-order.ts, compiled and called) on
// synthetic rows. Covers every row of the headline table, priority over
// date, date over fewest-paid, fewest-paid over newest-school, the caps
// (4 / 3 after one upcoming), cancelled excluded, the large-card mode.
//   node scripts/regress-embed-order.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
function safeRm(dir) { try { rmSync(dir, { recursive: true, force: true }) } catch (e) { console.warn(`note: could not remove ${dir} (${e?.code ?? e})`) } }
let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }
const build = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-build-embed-'))
let M
try {
  execSync(`npx tsc app/utils/embed-order.ts app/utils/class-groups.ts --outDir ${JSON.stringify(build)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`, { stdio: 'inherit' })
  M = createRequire(import.meta.url)(path.join(build, 'embed-order.js'))
} finally { safeRm(build) }
const { planEmbed, orderUpcoming, orderCurrentOrRecent } = M
const TODAY = '2026-09-24'
const d = (n) => { const x = new Date(`${TODAY}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
let n = 0
const mk = (o) => ({ id: o.id ?? `c${++n}`, status: o.status ?? 'open', slug: `s${n}`, class_type: 'SAT Prep', school_id: o.school ?? `school-${n}`, start_date: d(o.first), registration_close_date: o.close != null ? d(o.close) : null, sessions: [0, 7].map((k) => ({ session_date: d(o.first + k) })), schools: { name: o.school ?? `School ${n}` }, paidCount: o.paid ?? 5, schoolClassCount: o.runs ?? 1 })
const up = (o) => mk({ first: 30, close: 20, ...o })
const cur = (o) => mk({ first: -3, close: -5, ...o })
const rec = (o) => mk({ first: -60, close: -70, ...o })
const canc = (o) => mk({ status: 'cancelled', first: -60, close: -70, ...o })
const ids = (rows) => rows.map((r) => r.id).join(',')
const P = ['NIDO', 'AISCT', 'SAS', 'ASM', 'MIS', 'ISD']
const plan = (rows, priority = P) => planEmbed(rows, { today: TODAY, priority })

// --- headline table ------------------------------------------------------------
let p = plan([up({ id: 'u1' }), up({ id: 'u2' }), cur({ id: 'k1' }), rec({ id: 'r1' })])
check('≥2 upcoming → "Upcoming Classes", upcoming only', p.headline === 'Upcoming Classes' && ids(p.upcoming) === 'u1,u2' && p.others.length === 0, `${p.headline} ${ids(p.upcoming)} | ${ids(p.others)}`)
p = plan([up({ id: 'u1' }), cur({ id: 'k1' }), cur({ id: 'k2' }), rec({ id: 'r1' })])
check('1 upcoming + ≥1 current → "Upcoming and Current Classes", the 1 first then current', p.headline === 'Upcoming and Current Classes' && ids(p.upcoming) === 'u1' && p.othersKind === 'current' && ids(p.others).split(',').sort().join(',') === 'k1,k2', `${p.headline} ${ids(p.upcoming)} | ${ids(p.others)}`)
p = plan([up({ id: 'u1' }), rec({ id: 'r1' }), rec({ id: 'r2' })])
check('1 upcoming + 0 current → "Upcoming and Recent Classes", the 1 first then recent', p.headline === 'Upcoming and Recent Classes' && ids(p.upcoming) === 'u1' && p.othersKind === 'recent' && p.others.length === 2, `${p.headline} ${ids(p.others)}`)
p = plan([cur({ id: 'k1' }), rec({ id: 'r1' })])
check('0 upcoming + ≥1 current → "Classes Happening Now", current only', p.headline === 'Classes Happening Now' && ids(p.others) === 'k1' && p.upcoming.length === 0, `${p.headline} ${ids(p.others)}`)
p = plan([rec({ id: 'r1', first: -60 }), rec({ id: 'r2', first: -30 })])
check('0 + 0 → "Recent Classes", most recent first', p.headline === 'Recent Classes' && ids(p.others) === 'r2,r1', `${p.headline} ${ids(p.others)}`)
p = plan([])
check('nothing in the database → "Recent Classes" with mode empty (never on the real site)', p.headline === 'Recent Classes' && p.mode === 'empty')
// --- upcoming ordering ---------------------------------------------------------------
let rows = [up({ id: 'late-prio', school: 'MIS', first: 60 }), up({ id: 'soon-plain', school: 'X', first: 10 }), up({ id: 'first-prio', school: 'NIDO', first: 90 })]
check('priority schools first, in the LIST order, even when a plain school starts sooner', ids(orderUpcoming(rows, P)) === 'first-prio,late-prio,soon-plain', ids(orderUpcoming(rows, P)))
rows = [up({ id: 'b', first: 20, paid: 1 }), up({ id: 'a', first: 10, paid: 9 })]
check('soonest start beats fewest paid', ids(orderUpcoming(rows, P)) === 'a,b', ids(orderUpcoming(rows, P)))
rows = [up({ id: 'full', first: 10, paid: 9, runs: 0 }), up({ id: 'empty', first: 10, paid: 1, runs: 5 })]
check('same start: fewest paid beats newest school', ids(orderUpcoming(rows, P)) === 'empty,full', ids(orderUpcoming(rows, P)))
rows = [up({ id: 'old-school', first: 10, paid: 3, runs: 4 }), up({ id: 'new-school', first: 10, paid: 3, runs: 0 })]
check('same start + same paid: newest school (fewest classes ever run) first', ids(orderUpcoming(rows, P)) === 'new-school,old-school', ids(orderUpcoming(rows, P)))
check('the priority list is matched by school ID, not by name text', ids(orderUpcoming([up({ id: 'x', school: 'nido-lookalike', first: 10 }), up({ id: 'y', school: 'NIDO', first: 50 })], P)) === 'y,x')
check('an empty priority list orders purely by date', ids(orderUpcoming([up({ id: 'b', school: 'NIDO', first: 40 }), up({ id: 'a', school: 'Z', first: 10 })], [])) === 'a,b')
// --- current/recent ordering -----------------------------------------------------------
rows = [rec({ id: 'r-new-plain', school: 'Q', first: -20 }), rec({ id: 'r-old-prio', school: 'SAS', first: -200 }), rec({ id: 'r-mid-plain', school: 'R', first: -100, runs: 3 }), rec({ id: 'r-mid-plain2', school: 'S', first: -100, runs: 0 })]
check('current/recent: priority first, then MOST RECENT start, then fewest classes ever run', ids(orderCurrentOrRecent(rows, P)) === 'r-old-prio,r-new-plain,r-mid-plain2,r-mid-plain', ids(orderCurrentOrRecent(rows, P)))
// --- caps + exclusions + sizes ---------------------------------------------------------------
p = plan([1, 2, 3, 4, 5, 6].map((i) => up({ id: `u${i}`, first: 10 + i })))
check('upcoming cap 4 (soonest four)', ids(p.upcoming) === 'u1,u2,u3,u4' && p.mode === 'tiles', ids(p.upcoming))
p = plan([up({ id: 'u1' }), ...[1, 2, 3, 4, 5].map((i) => cur({ id: `k${i}`, first: -i }))])
check('one upcoming + current: current capped at 3', ids(p.upcoming) === 'u1' && p.others.length === 3 && ids(p.others) === 'k1,k2,k3', ids(p.others))
p = plan([...[1, 2, 3, 4, 5].map((i) => rec({ id: `r${i}`, first: -10 * i }))])
check('recent alone capped at 4, most recent first', ids(p.others) === 'r1,r2,r3,r4')
p = plan([canc({ id: 'x1', first: -10 }), canc({ id: 'x2', first: 30, close: 20 }), rec({ id: 'r1' })])
check('cancelled classes never appear (past or future dates)', p.headline === 'Recent Classes' && ids(p.others) === 'r1' && p.upcoming.length === 0, `${p.headline} ${ids(p.others)}`)
p = plan([up({ id: 'u1' }), up({ id: 'u2' })])
check('2 upcoming alone → large-card mode', p.mode === 'large' && p.upcoming.length === 2)
p = plan([up({ id: 'u1' }), up({ id: 'u2' }), up({ id: 'u3' })])
check('3 upcoming alone → large-card mode', p.mode === 'large' && p.upcoming.length === 3)
p = plan([up({ id: 'u1' }), up({ id: 'u2' }), up({ id: 'u3' }), up({ id: 'u4' })])
check('4 upcoming → normal tiles', p.mode === 'tiles')
p = plan([up({ id: 'u1' }), cur({ id: 'k1' })])
check('1 upcoming + others → normal tiles (the upcoming one first)', p.mode === 'tiles' && ids(p.upcoming) === 'u1')
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
