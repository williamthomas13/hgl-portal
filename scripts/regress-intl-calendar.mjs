#!/usr/bin/env node
// PL-161 + the Jul-28 configuration≠activation lesson, with a FAKE Google
// (the compiled gcal module's exports are swapped for an in-memory store):
//  - configured-but-DISABLED: sync writes NOTHING; adopt (reconcile) still
//    runs — that's the cutover order (id → adopt → enable).
//  - reconcile is SAFELY RE-RUNNABLE: a second run adopts nothing new and
//    reports the same unmatched hand events; nothing is ever deleted.
//  - enabled: sync creates span+sessions with the right colors, cancel
//    recolors red IN PLACE, hand edits are drift-detected, not overwritten.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const env = Object.fromEntries(
  readFileSync(path.join(root, '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
delete process.env.RESEND_API_KEY

const out = path.join(root, 'scripts', '.tmp-build-regress-intl')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/intl-calendar.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const gcal = require(path.join(out, 'gcal.js'))

// ---- fake Google ----------------------------------------------------------
const store = new Map()
let nextId = 1
gcal.loadGcalConnection = async () => ({ key: { client_email: 'fake', private_key: 'fake' }, status: 'connected' })
gcal.createGcalEvent = async (_key, input) => {
  const id = `fake-${nextId++}`
  store.set(id, snapshot(input))
  return id
}
gcal.patchGcalEvent = async (_key, eventId, input) => {
  if (!store.has(eventId)) throw new gcal.GcalApiError('gone', 404)
  store.set(eventId, snapshot(input))
}
gcal.listCalendarEvents = async () =>
  [...store.entries()].map(([id, e]) => ({ id, summary: e.summary, status: 'confirmed', colorId: e.colorId ?? null, start: e.start, end: e.end, allDay: e.allDay }))
function snapshot(input) {
  return input.allDay
    ? { summary: input.summary, colorId: input.colorId, allDay: true,
        start: new Date(input.allDay.startDate + 'T06:00:00Z').toISOString(), end: new Date(input.allDay.endDate + 'T06:00:00Z').toISOString() }
    : { summary: input.summary, colorId: input.colorId, allDay: false, start: new Date(input.startsAt).toISOString(), end: new Date(input.endsAt).toISOString() }
}

const intl = require(path.join(out, 'intl-calendar.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }
const cleanup = { classes: [], schools: [] }

try {
  // configured but NOT enabled
  await db.from('app_settings').upsert([{ key: 'intl_classes_calendar_id', value: 'qa-fake-calendar' }])
  await db.from('app_settings').delete().eq('key', 'intl_classes_sync_enabled')

  const { data: school } = await db.from('schools')
    .insert([{ name: 'QA-INTL School', nickname: 'QAINTL', timezone: 'America/Santiago' }])
    .select('id').single()
  cleanup.schools.push(school.id)
  const d1 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const d2 = new Date(Date.now() + 37 * 86_400_000).toISOString().slice(0, 10)
  const { data: cls } = await db.from('classes').insert([{
    school_id: school.id, class_type: 'QA-INTL SAT', price: 500, capacity: 10,
    start_date: d1, status: 'open', delivery_mode: 'in_person',
  }]).select('id').single()
  cleanup.classes.push(cls.id)
  await db.from('sessions').insert([
    { class_id: cls.id, session_date: d1, start_time: '10:00', end_time: '12:00' },
    { class_id: cls.id, session_date: d2, start_time: '10:00', end_time: '12:00' },
  ])

  // ---- 1. configuration ≠ activation --------------------------------------
  const s0 = await intl.syncInternationalCalendar(cls.id)
  check('1. configured-but-DISABLED sync writes NOTHING', s0.configured === false && store.size === 0, JSON.stringify(s0))

  // hand events for adoption while disabled
  const tzStart = (dateIso, hhmm) => new Date(`${dateIso}T${hhmm}:00-04:00`).toISOString()
  store.set('hand-session', { summary: 'SAT prep w/ QAINTL', colorId: '10', allDay: false, start: tzStart(d1, '10:00'), end: tzStart(d1, '12:00') })
  store.set('hand-span', { summary: 'QA-INTL SAT — trip', colorId: '10', allDay: true, start: new Date(d1 + 'T00:00:00-04:00').toISOString(), end: new Date(d2 + 'T00:00:00-04:00').toISOString() })
  store.set('hand-stranger', { summary: 'Dentist', colorId: null, allDay: false, start: tzStart(d1, '15:00'), end: tzStart(d1, '16:00') })

  const rec1 = await intl.reconcileInternationalCalendar()
  check('2. adopt runs while DISABLED (the cutover order: id → adopt → enable)',
    rec1.configured === true && rec1.adoptedSessions === 1 && rec1.adoptedSpans === 1, JSON.stringify({ s: rec1.adoptedSessions, sp: rec1.adoptedSpans }))
  check('3. unmatched hand events reported, never deleted',
    rec1.unmatched.some((u) => u.summary === 'Dentist') && store.has('hand-stranger'))

  // ---- 2. adopt is safely RE-RUNNABLE -------------------------------------
  const rec2 = await intl.reconcileInternationalCalendar()
  check('4. re-running adopt adopts nothing new (already-claimed ids skipped)',
    rec2.adoptedSessions === 0 && rec2.adoptedSpans === 0, JSON.stringify({ s: rec2.adoptedSessions, sp: rec2.adoptedSpans }))
  check('5. re-run still reports the same unmatched events',
    rec2.unmatched.some((u) => u.summary === 'Dentist') && store.has('hand-stranger') && store.has('hand-session'))

  // ---- 3. enable → sync takes over ----------------------------------------
  await db.from('app_settings').upsert([{ key: 'intl_classes_sync_enabled', value: 'true' }])
  const s1 = await intl.syncInternationalCalendar(cls.id)
  check('6. enabled sync takes over (adopted events patched, missing created)',
    s1.configured === true && s1.created + s1.patched === 3, JSON.stringify(s1))
  check('7. adopted session patched into portal shape (id stable)',
    store.get('hand-session')?.summary?.startsWith('QAINTL QA-INTL SAT'))
  const s2 = await intl.syncInternationalCalendar(cls.id)
  check('8. second sync is a no-op', s2.created === 0 && s2.patched === 0 && s2.unchanged === 3)

  // ---- 4. cancel recolors red IN PLACE ------------------------------------
  const idsBefore = [...store.keys()].sort().join()
  await db.from('classes').update({ status: 'cancelled' }).eq('id', cls.id)
  const s3 = await intl.syncInternationalCalendar(cls.id)
  check('9. cancel patches all 3 red in place (no delete/recreate)',
    s3.patched === 3 && [...store.keys()].sort().join() === idsBefore &&
      [...store.values()].filter((e) => e.colorId === '11').length === 3)

  // ---- 5. hand edits detected, never overwritten --------------------------
  const [spanId] = [...store.entries()].find(([, e]) => e.allDay)
  store.get(spanId).summary = 'Kelsie edited this by hand'
  const audit = await intl.auditInternationalCalendar()
  check('10. drift audit reports the hand edit', audit.drift.length === 1 && audit.drift[0].problem.includes('hand-edited'))
  const s4 = await intl.syncInternationalCalendar(cls.id)
  check('11. sync leaves the hand edit alone (portal unchanged)',
    s4.patched === 0 && store.get(spanId).summary === 'Kelsie edited this by hand')

  // ---- 6. disable turns writing back off ----------------------------------
  await db.from('app_settings').upsert([{ key: 'intl_classes_sync_enabled', value: 'false' }])
  await db.from('classes').update({ status: 'open' }).eq('id', cls.id)
  const s5 = await intl.syncInternationalCalendar(cls.id)
  check('12. disabled again → sync writes nothing despite a portal change', s5.configured === false && store.get(spanId).summary === 'Kelsie edited this by hand')
} catch (e) {
  check('flow ran without crashing', false, e.stack?.slice(0, 500) ?? e.message)
} finally {
  await db.from('app_settings').delete().in('key', ['intl_classes_calendar_id', 'intl_classes_calendar_owner', 'intl_classes_sync_enabled'])
  for (const id of cleanup.classes) {
    await db.from('sessions').delete().eq('class_id', id)
    await db.from('classes').delete().eq('id', id)
  }
  for (const id of cleanup.schools) await db.from('schools').delete().eq('id', id)
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done (intl settings removed — prod stays unconfigured until the cutover)')
}
process.exit(failures === 0 ? 0 : 1)
