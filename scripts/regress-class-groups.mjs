#!/usr/bin/env node
// PL-501 gate: the admin Classes list's grouping / search / sort rules —
// the SAME pure module the page runs (app/utils/class-groups.ts, compiled
// and called), on 20 synthetic classes across the five states. Asserts the
// grouping + counts, search across every matched field (auto-expansion is
// "the group has hits"), every sort order, and that a cancelled class never
// lands under Ended whatever its dates.
//   node scripts/regress-class-groups.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
function safeRm(dir) { try { rmSync(dir, { recursive: true, force: true }) } catch (e) { console.warn(`note: could not remove ${dir} (${e?.code ?? e})`) } }
let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }
const build = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-build-groups-'))
let M
try {
  execSync(`npx tsc app/utils/class-groups.ts --outDir ${JSON.stringify(build)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`, { stdio: 'inherit' })
  M = createRequire(import.meta.url)(path.join(build, 'class-groups.js'))
} finally { safeRm(build) }
const { groupClasses, classGroup, matchesSearch, sortClasses, classTerm } = M

const TODAY = '2026-09-24'
const d = (n) => { const x = new Date(`${TODAY}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const mk = (i, o) => ({
  id: `c${i}`, status: o.status ?? 'open', slug: o.slug ?? `${o.code ?? 'xx'}-sat-prep-${o.term ?? 'fall26'}`, class_type: o.type ?? 'SAT Prep',
  start_date: d(o.first), registration_close_date: o.close != null ? d(o.close) : null,
  sessions: [0, 7, 14].map((n) => ({ session_date: d(o.first + n) })),
  schools: { name: o.name ?? `School ${i}`, nickname: (o.code ?? `S${i}`).toUpperCase(), evergreen_code: o.code ?? null },
  instructors: { name: o.instructor ?? 'Nobody Here' }, delivery_mode: o.online ? 'online' : 'in_person',
})
// 4 per state: open (close ahead), in-progress (started, close passed), upcoming (future first, close passed or status planned), ended, cancelled (mixed dates)
const rows = [
  mk(1, { first: 20, close: 15, code: 'sls', name: 'St. Louis School', instructor: 'Kevin Marren' }),
  mk(2, { first: 30, close: 25, code: 'mis', name: 'Munich International School', instructor: 'Gwen De Silva' }),
  mk(3, { first: 10, close: 9, code: 'asf', name: 'American School Foundation' }),
  mk(4, { first: 40, close: 35, online: true, code: null, slug: 'online-act-deep-dive-fall26', type: 'ACT Prep' }),
  mk(5, { first: -7, close: -10, code: 'leone', name: 'Istituto Leone XIII', instructor: 'Rebecca Baumher' }),
  mk(6, { first: -3, close: -4, code: 'ism' }),
  mk(7, { first: -10, close: -12, code: 'aisj', term: 'fall26' }),
  mk(8, { first: -1, close: -2, code: 'sas' }),
  mk(9, { first: 25, close: -1, code: 'isd', term: 'spring27' }),
  mk(10, { first: 50, close: null, status: 'planned', code: 'aosr', term: 'spring27' }),
  mk(11, { first: 60, close: -5, code: 'aas', term: 'spring27' }),
  mk(12, { first: 45, close: null, status: 'draft', code: 'asm', term: 'spring27' }),
  mk(13, { first: -200, close: -210, code: 'ulis', term: 'spring26' }),
  mk(14, { first: -400, close: -410, code: 'eab', term: 'spring25' }),
  mk(15, { first: -100, close: -110, code: 'cas', term: 'summer26', instructor: 'Kevin Marren' }),
  mk(16, { first: -30, close: -40, code: 'sis', term: 'spring25' }),
  mk(17, { first: 20, close: 15, status: 'cancelled', code: 'isp' }),
  mk(18, { first: -50, close: -60, status: 'cancelled', code: 'aisv' }),
  mk(19, { first: -5, close: -8, status: 'cancelled', code: 'qa1' }),
  mk(20, { first: 90, close: null, status: 'cancelled', code: 'qa2' }),
]
const g = groupClasses(rows, { today: TODAY })
const counts = Object.fromEntries(g.map((x) => [x.key, x.total]))
check('five groups in display order', JSON.stringify(g.map((x) => x.key)) === JSON.stringify(['open', 'in-progress', 'upcoming', 'ended', 'cancelled']), g.map((x) => x.key).join(','))
check('counts: open 4 · in-progress 4 · upcoming 4 · ended 4 · cancelled 4', JSON.stringify(counts) === JSON.stringify({ open: 4, 'in-progress': 4, upcoming: 4, ended: 4, cancelled: 4 }), JSON.stringify(counts))
check('every class lands in exactly one group', g.reduce((n, x) => n + x.total, 0) === 20)
check('a cancelled class NEVER appears under Ended (past dates included)', !g.find((x) => x.key === 'ended').rows.some((c) => c.status === 'cancelled') && g.find((x) => x.key === 'cancelled').rows.length === 4 && ['c17', 'c18', 'c19', 'c20'].every((id) => classGroup(rows.find((r) => r.id === id), TODAY) === 'cancelled'))
check('the live groups carry live=true, Ended/Cancelled live=false (collapsed by default)', g.filter((x) => x.live).map((x) => x.key).join(',') === 'open,in-progress,upcoming' && g.filter((x) => !x.live).map((x) => x.key).join(',') === 'ended,cancelled')
// search — every matched field
const hits = (q) => groupClasses(rows, { today: TODAY, query: q }).flatMap((x) => x.rows.map((c) => c.id))
check('search by school nickname (SLS)', JSON.stringify(hits('sls')) === JSON.stringify(['c1']), hits('sls').join(','))
check('search by school name fragment (munich)', JSON.stringify(hits('munich')) === JSON.stringify(['c2']), hits('munich').join(','))
check('search by code (aisj)', JSON.stringify(hits('aisj')) === JSON.stringify(['c7']), hits('aisj').join(','))
check('search by slug fragment (deep-dive)', JSON.stringify(hits('deep-dive')) === JSON.stringify(['c4']), hits('deep-dive').join(','))
check('search by class type (act)', hits('act prep').includes('c4') && hits('act prep').length === 1, hits('act prep').join(','))
check('search by instructor FIRST name (kevin) finds both of his', JSON.stringify(hits('kevin').sort()) === JSON.stringify(['c1', 'c15']), hits('kevin').join(','))
check('search by term (spring27) spans groups', JSON.stringify(hits('spring27').sort()) === JSON.stringify(['c10', 'c11', 'c12', 'c9'].sort()), hits('spring27').join(','))
check('search is token-AND (kevin fall26 → c1 only)', JSON.stringify(hits('kevin fall26')) === JSON.stringify(['c1']), hits('kevin fall26').join(','))
check('a search keeps every group with a hit expandable (rows > 0) and the miss groups empty', groupClasses(rows, { today: TODAY, query: 'spring27' }).map((x) => x.rows.length).join(',') === '0,0,4,0,0')
check('classTerm() reads the trailing term token', classTerm(rows[0]) === 'fall26' && classTerm({ slug: 'online-act-deep-dive-fall26' }) === 'fall26' && classTerm({ slug: 'no-term-here' }) === null)
check('matchesSearch(empty) is true', matchesSearch(rows[0], '   '))
// sort
const ended = g.find((x) => x.key === 'ended').rows
check('default sort = newest first by start', ended.map((c) => c.id).join(',') === 'c16,c15,c13,c14', ended.map((c) => c.id).join(','))
check('oldest-first sort', sortClasses(ended, 'oldest').map((c) => c.id).join(',') === 'c14,c13,c15,c16')
check('A–Z by school sort', sortClasses(ended, 'school').map((c) => c.schools.nickname).join(',') === 'CAS,EAB,SIS,ULIS')
check('per-group sort option applies to that group only', groupClasses(rows, { today: TODAY, sort: { ended: 'oldest' } }).find((x) => x.key === 'ended').rows[0].id === 'c14' && groupClasses(rows, { today: TODAY, sort: { ended: 'oldest' } }).find((x) => x.key === 'open').rows[0].id === 'c4')
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
