// PL-402 E2E: grouped, once-only drift alerts. Fake Google (in-memory event
// list built from REAL session rows), fake sendAdminAlert (captured), REAL
// calendar_drift table. Steps: 3 perturbed events → ONE email listing 3;
// second pass → zero; move one AGAIN → one new email; restore + cleanup.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const root = '/Users/williamthomas/Desktop/hgl-portal'
process.chdir(root)
const env = Object.fromEntries(
  readFileSync(path.join(root, '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
delete process.env.RESEND_API_KEY

const out = path.join(root, 'scripts', '.tmp-build-pl402')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/gcal-sync.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const gcal = require(path.join(out, 'gcal.js'))
const email = require(path.join(out, 'email.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ---- fakes (patched BEFORE gcal-sync is required) --------------------------
const captured = []
email.sendAdminAlert = async (opts) => { captured.push(opts); return 'sent' }
gcal.loadGcalConnection = async () => ({ status: 'connected', key: { client_email: 'fake', private_key: 'fake' } })

// Build the fake calendar from the REAL rows so every other session reads
// undrifted; perturb only the chosen three.
const { data: sessions } = await db
  .from('tutoring_sessions')
  .select('id, tutor_id, starts_at, ends_at, status, gcal_event_id, students ( first_name )')
  .not('gcal_event_id', 'is', null)
  .in('status', ['confirmed', 'proposed', 'completed'])
const eventState = new Map() // event_id -> {start,end,deleted}
for (const s of sessions) eventState.set(s.gcal_event_id, { start: s.starts_at, end: s.ends_at, deleted: false })

gcal.listCalendarEvents = async () =>
  [...eventState.entries()]
    .filter(([, e]) => !e.deleted)
    .map(([id, e]) => ({ id, summary: 'Tutoring: X — Y', status: 'confirmed', colorId: null, start: e.start, end: e.end, allDay: false, hglSessionId: null }))

const sync = require(path.join(out, 'gcal-sync.js'))

// pick 3 future confirmed sessions (prefer QA student Fakey)
const now = Date.now()
const future = sessions
  .filter((s) => s.status === 'confirmed' && new Date(s.starts_at).getTime() > now + 3600e3)
  .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
const fakeyFirst = [...future.filter((s) => s.students?.first_name === 'Fakey'), ...future.filter((s) => s.students?.first_name !== 'Fakey')]
const targets = fakeyFirst.slice(0, 3)
if (targets.length < 3) { console.error('need 3 future synced sessions, found', targets.length); process.exit(1) }
console.log('targets:', targets.map((t) => `${t.students?.first_name} ${t.starts_at}`))

const shift = (iso, mins) => new Date(new Date(iso).getTime() + mins * 60e3).toISOString()
// perturb: move #1 +30min, move #2 +60min, delete #3
eventState.get(targets[0].gcal_event_id).start = shift(targets[0].starts_at, 30)
eventState.get(targets[0].gcal_event_id).end = shift(targets[0].ends_at, 30)
eventState.get(targets[1].gcal_event_id).start = shift(targets[1].starts_at, 60)
eventState.get(targets[1].gcal_event_id).end = shift(targets[1].ends_at, 60)
eventState.get(targets[2].gcal_event_id).deleted = true

const pass = async (label) => {
  const drift = await sync.syncTutoringDriftTable()
  const rung = await sync.sendGroupedDriftAlert(drift, 'billy@highergroundlearning.com')
  console.log(`${label}: drift=${drift.length} rung=${rung} emails so far=${captured.length}`)
  return { drift, rung }
}

let ok = true
const check = (cond, msg) => { console.log(cond ? `  PASS ${msg}` : `  FAIL ${msg}`); if (!cond) ok = false }

const p1 = await pass('pass 1 (3 changes)')
check(p1.drift.length === 3, '3 drifts detected')
check(p1.rung === 3 && captured.length === 1, 'ONE grouped email covering 3')
check((captured[0]?.body.match(/<li>/g) ?? []).length === 3, 'email lists 3 lines')
check(/3 session events changed/.test(captured[0]?.subject ?? ''), `subject groups: "${captured[0]?.subject}"`)

const p2 = await pass('pass 2 (no new changes)')
check(p2.drift.length === 3 && p2.rung === 0 && captured.length === 1, 'second pass rings NOTHING')

// move #1 AGAIN
eventState.get(targets[0].gcal_event_id).start = shift(targets[0].starts_at, 90)
eventState.get(targets[0].gcal_event_id).end = shift(targets[0].ends_at, 90)
const p3 = await pass('pass 3 (one re-move)')
check(p3.rung === 1 && captured.length === 2, 'one NEW email for the re-moved event only')
check((captured[1]?.body.match(/<li>/g) ?? []).length === 1, 'new email lists exactly 1 line')

// restore: un-perturb everything → audit clears the table
eventState.get(targets[0].gcal_event_id).start = targets[0].starts_at
eventState.get(targets[0].gcal_event_id).end = targets[0].ends_at
eventState.get(targets[1].gcal_event_id).start = targets[1].starts_at
eventState.get(targets[1].gcal_event_id).end = targets[1].ends_at
eventState.get(targets[2].gcal_event_id).deleted = false
const p4 = await pass('pass 4 (restored)')
check(p4.drift.length === 0 && p4.rung === 0, 'restore clears all drift, no email')
const { data: leftover } = await db.from('calendar_drift').select('session_id')
check((leftover ?? []).length === 0, 'calendar_drift table empty after restore')

rmSync(out, { recursive: true, force: true })
console.log(ok ? '\nPL-402 E2E: ALL PASS' : '\nPL-402 E2E: FAILURES')
process.exit(ok ? 0 : 1)
