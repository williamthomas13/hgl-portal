#!/usr/bin/env node
// PL-457 regression: the silent import (--silent) leaves an enrollment the
// portal can never email, and the plain import is byte-identical to before.
//
//   1. A self-cleaning QA class (no school) whose sessions are all in the
//      FUTURE (so every sequence step is still ahead) gets a 2-row CSV
//      imported with --silent --all-paid.
//   2. Asserts per Paid row: comms_muted = true; a cancelled claim row for
//      EVERY sequence step × parent/student (7 × 2), the three confirmation
//      keys, and the four sweep keys (thank-you student leg, E9 upsell, class
//      survey + reminder) — 21 rows.
//   3. Compiles the real modules: the comms projector projects ZERO rows for
//      the muted enrollments (state-driven "what will send"), and sendOnce
//      refuses a probe keyed on one (returns 'suppressed', records a
//      cancelled row with the mute reason, never reaches Resend).
//   4. The same CSV shape WITHOUT --silent (fresh students): comms_muted =
//      false, only the three confirmation keys claimed (no step is due), and
//      the projector projects all 14 sequence legs — today's behaviour.
//
//   node scripts/regress-silent-import.mjs      (needs .env.local; real DB rows, cleaned in finally)
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
Object.assign(process.env, env)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const plus = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const SLUG = 'qa-pl457-silent-import'
const EMAILS = ['billy+pl457a@highergroundlearning.com', 'billy+pl457b@highergroundlearning.com', 'billy+pl457c@highergroundlearning.com']
const tmp = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-pl457-'))
let classId = null
async function cleanup() {
  if (classId) {
    await db.from('email_sends').delete().eq('class_id', classId)
    await db.from('email_sends').delete().like('dedupe_key', 'qa_pl457_%')
    await db.from('enrollments').delete().eq('class_id', classId)
    await db.from('sessions').delete().eq('class_id', classId)
    await db.from('classes').delete().eq('id', classId)
  }
  const { data: fams } = await db.from('families').select('id').in('parent_email', EMAILS)
  for (const f of fams ?? []) {
    await db.from('students').delete().eq('family_id', f.id)
    await db.from('families').delete().eq('id', f.id)
  }
}
try {
  await cleanup()
  // ---- arrange: future class ------------------------------------------------
  const { data: cls, error } = await db.from('classes').insert({
    class_type: 'SAT Prep', status: 'open', start_date: plus(12), price: 899, capacity: 20, school_id: null,
    slug: SLUG, delivery_mode: 'online', default_location: 'https://zoom.us/j/qa-pl457', timezone: 'America/Denver', min_enrollment: 1, synap_group: 'synap.ac',
  }).select('id').single()
  if (error) throw error
  classId = cls.id
  await db.from('sessions').insert([12, 19, 26].map((n) => ({ class_id: classId, session_date: plus(n), start_time: '16:00:00', end_time: '18:00:00' })))
  const csv = (rows) => `Parent First,Parent Last,Email,Student First,Student Last,Student Email\n${rows.map((r) => r.join(',')).join('\n')}\n`
  const silentCsv = path.join(tmp, 'silent.csv')
  writeFileSync(silentCsv, csv([['QA-PL457', 'ParentA', EMAILS[0], 'QA-PL457', 'StudentA', 'billy+pl457sa@highergroundlearning.com'], ['QA-PL457', 'ParentB', EMAILS[1], 'QA-PL457', 'StudentB', '']]))
  const mapping = path.join(tmp, 'mapping.json')
  writeFileSync(mapping, JSON.stringify({ parentFirst: 'Parent First', parentLast: 'Parent Last', parentEmail: 'Email', studentFirst: 'Student First', studentLast: 'Student Last', studentEmail: 'Student Email' }))

  // ---- act 1: --silent ------------------------------------------------------
  const out1 = execSync(`node scripts/import-class-registrations.mjs --class ${classId} --csv ${silentCsv} --mapping ${mapping} --baseline-current --all-paid --silent --by regress-pl457`, { encoding: 'utf8' })
  check('--silent import ran and reported SILENT', /SILENT: all 7 sequence steps claimed/.test(out1), out1.split('\n').filter((l) => /SILENT|Done/.test(l)).join(' | '))
  const { data: enrs } = await db.from('enrollments').select('id, comms_muted, payment_status, source, students ( student_email, families ( parent_email ) )').eq('class_id', classId)
  check('2 Paid import enrollments created', (enrs ?? []).length === 2 && enrs.every((e) => e.payment_status === 'Paid' && e.source === 'import'))
  check('both enrollments are comms_muted', (enrs ?? []).every((e) => e.comms_muted === true))
  const SEQ = ['synap_access', 'faq', 'class_details', 'location_reminder', 'second_diagnostic', 'review_request', 'tutoring_offer']
  for (const e of enrs ?? []) {
    const { data: claims } = await db.from('email_sends').select('dedupe_key, status, cancel_reason').eq('enrollment_id', e.id)
    const keys = new Set((claims ?? []).map((c) => c.dedupe_key))
    const expected = [
      `parent_confirmation:${e.id}`, `student_confirmation:${e.id}`, `thank_you:${e.id}`,
      ...SEQ.flatMap((s) => [`${s}_p:${e.id}`, `${s}_s:${e.id}`]),
      `thank_you_s:${e.id}`, `tutoring_upsell:${e.id}`, `class_survey:${e.id}`, `class_survey_reminder:${e.id}`,
    ]
    const missing = expected.filter((k) => !keys.has(k))
    check(`enrollment ${e.id.slice(0, 8)}: all ${expected.length} claim rows present, all cancelled`, missing.length === 0 && (claims ?? []).every((c) => c.status === 'cancelled'), missing.length ? `missing ${missing.join(', ')}` : `${claims.length} rows`)
    check(`enrollment ${e.id.slice(0, 8)}: claim reason says silent import`, (claims ?? []).every((c) => /silent import/.test(c.cancel_reason ?? '')))
  }

  // ---- act 2: the real modules ----------------------------------------------
  const build = path.join(tmp, 'build')
  execSync(`npx tsc app/utils/lifecycle.ts app/utils/comms-projector.ts app/utils/email.ts --outDir ${JSON.stringify(build)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`, { stdio: 'inherit' })
  const req = createRequire(import.meta.url)
  const { loadClassBundles, loadTutoringPackages } = req(path.join(build, 'lifecycle.js'))
  const { projectBundle } = req(path.join(build, 'comms-projector.js'))
  const { sendOnce } = req(path.join(build, 'email.js'))
  const [bundle] = await loadClassBundles(classId)
  const packages = await loadTutoringPackages()
  const projected = projectBundle(bundle, packages)
  const mutedIds = new Set((enrs ?? []).map((e) => e.id))
  check('projector projects ZERO rows for the muted enrollments', projected.filter((p) => mutedIds.has(p.enrollment_id)).length === 0, `${projected.length} projected for the class`)
  check('bundle rows carry commsMuted=true', bundle.enrollments.filter((e) => mutedIds.has(e.id)).every((e) => e.commsMuted === true))
  const probeKey = `qa_pl457_probe:${enrs[0].id}`
  const status = await sendOnce({
    dedupeKey: probeKey, emailType: 'schedule_update', templateKey: 'SU_SCHEDULE_UPDATE', enrollmentId: enrs[0].id, classId,
    to: [EMAILS[0]], subject: 'PL-457 probe', html: '<p>probe</p><a href="https://highergroundlearning.com/classes">x</a>',
  })
  const { data: probeRow } = await db.from('email_sends').select('status, cancel_reason').eq('dedupe_key', probeKey).maybeSingle()
  check("sendOnce refuses a send keyed on a muted enrollment ('suppressed')", status === 'suppressed', String(status))
  check('the refusal is recorded as a cancelled row with the mute reason', probeRow?.status === 'cancelled' && /comms muted/.test(probeRow.cancel_reason ?? ''), JSON.stringify(probeRow))
  const status2 = await sendOnce({
    dedupeKey: `qa_pl457_probe2:${enrs[0].id}`, emailType: 'schedule_update', templateKey: 'SU_SCHEDULE_UPDATE', enrollmentId: enrs[0].id, classId,
    to: [EMAILS[0]], subject: 'PL-457 probe', html: '<p>probe</p><a href="https://highergroundlearning.com/classes">x</a>',
  })
  check('a second, differently-keyed send is refused too (the flag, not the claim, holds)', status2 === 'suppressed', String(status2))

  // ---- act 3: WITHOUT --silent (today's behaviour) ---------------------------
  const plainCsv = path.join(tmp, 'plain.csv')
  writeFileSync(plainCsv, csv([['QA-PL457', 'ParentC', EMAILS[2], 'QA-PL457', 'StudentC', 'billy+pl457sc@highergroundlearning.com']]))
  const out2 = execSync(`node scripts/import-class-registrations.mjs --class ${classId} --csv ${plainCsv} --mapping ${mapping} --baseline-current --all-paid --by regress-pl457`, { encoding: 'utf8' })
  check('plain import ran without SILENT', !/SILENT/.test(out2) && /0 sequence step\(s\) already due/.test(out2), out2.split('\n').find((l) => /Importing into/.test(l)))
  const { data: plain } = await db.from('enrollments').select('id, comms_muted').eq('class_id', classId).not('id', 'in', `(${[...mutedIds].join(',')})`).maybeSingle()
  check('plain import enrollment is NOT muted', plain?.comms_muted === false)
  const { data: plainClaims } = await db.from('email_sends').select('dedupe_key').eq('enrollment_id', plain.id)
  check('plain import claims only the three confirmation keys (nothing due yet)', (plainClaims ?? []).length === 3, (plainClaims ?? []).map((c) => c.dedupe_key.split(':')[0]).join(','))
  const [bundle2] = await loadClassBundles(classId)
  const projected2 = projectBundle(bundle2, packages).filter((p) => p.enrollment_id === plain.id)
  check('projector projects all 14 sequence legs for the plain enrollment', projected2.length === 14, `${projected2.length} rows: ${[...new Set(projected2.map((p) => p.email_type))].join(',')}`)
  const status3 = await sendOnce({
    dedupeKey: `qa_pl457_probe3:${plain.id}`, emailType: 'schedule_update', templateKey: 'SU_SCHEDULE_UPDATE', enrollmentId: plain.id, classId,
    to: [EMAILS[2]], subject: 'PL-457 probe (plain)', html: '<p>probe</p><a href="https://highergroundlearning.com/classes">x</a>',
  })
  check('sendOnce SENDS for the plain enrollment (one real QA send — proves the gate is the flag)', status3 === 'sent', String(status3))
} finally {
  await cleanup()
  rmSync(tmp, { recursive: true, force: true })
  console.log('\ncleaned up QA rows.')
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
