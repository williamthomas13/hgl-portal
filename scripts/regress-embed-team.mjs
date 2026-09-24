#!/usr/bin/env node
// PL-507 gate: the homepage team strip's selection — the SAME pure module
// the embed runs (app/utils/embed-team.ts): setting order honoured, hidden-
// from-/team excluded, unknown ids ignored, duplicates collapsed, cap 12,
// empty state, and the seed = the first four in /team order.
//   node scripts/regress-embed-team.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
function safeRm(dir) { try { rmSync(dir, { recursive: true, force: true }) } catch (e) { console.warn(`note: could not remove ${dir} (${e?.code ?? e})`) } }
let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }
const build = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-build-team-'))
let M, S
try {
  execSync(`npx tsc app/utils/embed-team.ts app/utils/school-monogram.ts --outDir ${JSON.stringify(build)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`, { stdio: 'inherit' })
  M = createRequire(import.meta.url)(path.join(build, 'embed-team.js'))
  S = createRequire(import.meta.url)(path.join(build, 'school-monogram.js'))
} finally { safeRm(build) }
const { selectTeam, defaultTeamSeed, TEAM_EMBED_CAP, TEAM_CTA_LABEL, TEAM_COLUMNS } = M
check('PL-511: the button reads the site\'s own label "See more"', TEAM_CTA_LABEL === 'See more')
check('PL-511: 6 across on desktop, 4 ≤1024, 3 ≤768, 2 on phones', TEAM_COLUMNS.desktop === 6 && TEAM_COLUMNS.tablet === 4 && TEAM_COLUMNS.small === 3 && TEAM_COLUMNS.phone === 2)
const p = (id, o = {}) => ({ id, name: o.name ?? `Person ${id}`, credential: o.credential ?? null, show_on_team: o.hidden ? false : true, team_order: o.order ?? null })
const people = [p('billy', { name: 'William Thomas', credential: 'President', order: 0 }), p('eric', { name: 'Eric Brown', credential: 'Executive Director', order: 1 }), p('jason', { name: 'Jason Topa', order: 2 }), p('kelsie', { name: 'Kelsie Rank', order: 3 }), p('gwen', { name: 'Gwen De Silva', credential: 'International SAT', order: 4 }), p('kevin', { name: 'Kevin Marren', order: 5 }), p('ghost', { name: 'Hidden Person', hidden: true, order: 1 }), p('zed', { name: 'Zed Noorder' })]
const ids = (rows) => rows.map((r) => r.id).join(',')
check('setting order is honoured exactly (not /team order)', ids(selectTeam(['kevin', 'billy', 'gwen'], people)) === 'kevin,billy,gwen', ids(selectTeam(['kevin', 'billy', 'gwen'], people)))
check('someone hidden from /team drops out even when listed', ids(selectTeam(['billy', 'ghost', 'eric'], people)) === 'billy,eric')
check('an id that no longer exists is ignored', ids(selectTeam(['billy', 'no-such-id', 'eric'], people)) === 'billy,eric')
check('a duplicated id shows once', ids(selectTeam(['billy', 'billy', 'eric'], people)) === 'billy,eric')
check(`cap ${TEAM_EMBED_CAP}`, selectTeam(Array.from({ length: 20 }, (_, i) => `x${i}`), Array.from({ length: 20 }, (_, i) => p(`x${i}`))).length === TEAM_EMBED_CAP)
check('empty setting → empty strip (never a hole is the renderer\'s job; the rule returns [])', selectTeam([], people).length === 0)
check('the seed = the first four in /team order (team_order then name), hidden people excluded', defaultTeamSeed(people, 4).join(',') === 'billy,eric,jason,kelsie', defaultTeamSeed(people, 4).join(','))
check('the seed skips a hidden person at a low team_order', !defaultTeamSeed(people, 8).includes('ghost') && defaultTeamSeed(people, 8).at(-1) === 'zed')
check('selection keeps each person\'s credential line as stored (title or subjects)', selectTeam(['billy', 'gwen'], people).map((r) => r.credential).join('|') === 'President|International SAT')
// PL-508: the logo-less tile reads the NICKNAME, initials only without one
const { schoolMonogram } = S
check('PL-508: nickname wins over full-name initials ("Nido", not "CNA")', schoolMonogram('Nido', 'Colegio Nido de Aguilas') === 'Nido' && schoolMonogram('SAS', 'Shanghai American School') === 'SAS')
check('PL-508: no nickname → initials of the full name; blank → HGL', schoolMonogram(null, 'Colegio Nido de Aguilas') === 'CNA' && schoolMonogram('', 'International School of Panama') === 'ISP' && schoolMonogram(null, '') === 'HGL')
check('PL-508: a long nickname is clipped to 8 characters so the tile never overflows', schoolMonogram('Leone XIII School', 'Istituto Leone XIII') === 'Leone XI')
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
