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
const EMAILS = ['billy+pl457a@highergroundlearning.com', 'billy+pl457b@highergroundlearning.com', 'billy+pl457c@highergroundlearning.com', 'billy+pl464d@highergroundlearning.com', 'billy+pl465e@highergroundlearning.com', 'billy+pl465f@highergroundlearning.com', 'billy+pl465g@highergroundlearning.com']
const tmp = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-pl457-'))
const build = path.join(tmp, 'build')
const req = createRequire(import.meta.url)
let classId = null
async function cleanup() {
  if (classId) {
    const { data: withEv } = await db.from('sessions').select('id, instructor_gcal_event_id, instructor_gcal_email').eq('class_id', classId).not('instructor_gcal_event_id', 'is', null)
    for (const s of withEv ?? []) {
      try {
        const { loadGcalConnection, deleteGcalEvent } = req(path.join(build, 'gcal.js'))
        const conn = await loadGcalConnection()
        if (conn?.key) await deleteGcalEvent(conn.key, s.instructor_gcal_email, null, s.instructor_gcal_event_id)
        console.log('removed a QA calendar event the sync wrote:', s.instructor_gcal_event_id)
      } catch (e) { console.log('calendar cleanup failed (remove by hand):', s.instructor_gcal_event_id, String(e)) }
    }
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
  const csv = (rows) => `Parent First,Parent Last,Email,Student First,Student Last,Student Email,Outcome,Extra 1on1 Hours Paid,Extra Hours Amount,Accommodations,Notes\n${rows.map((r) => [...r, ...Array(11 - r.length).fill('')].join(',')).join('\n')}\n`
  const silentCsv = path.join(tmp, 'silent.csv')
  writeFileSync(silentCsv, csv([['QA-PL457', 'ParentA', EMAILS[0], 'QA-PL457', 'StudentA', 'billy+pl457sa@highergroundlearning.com'], ['QA-PL457', 'ParentB', EMAILS[1], 'QA-PL457', 'StudentB', '']]))
  const mapping = path.join(tmp, 'mapping.json')
  writeFileSync(mapping, JSON.stringify({ parentFirst: 'Parent First', parentLast: 'Parent Last', parentEmail: 'Email', studentFirst: 'Student First', studentLast: 'Student Last', studentEmail: 'Student Email', outcome: 'Outcome', addonHours: 'Extra 1on1 Hours Paid', addonAmount: 'Extra Hours Amount', accommodations: 'Accommodations', notes: 'Notes' }))

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
  execSync(`npx tsc app/utils/lifecycle.ts app/utils/comms-projector.ts app/utils/email.ts app/utils/instructor-comms.ts --outDir ${JSON.stringify(build)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`, { stdio: 'inherit' })
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

  // ---- act 4: PL-464 A + PL-465 outcomes, add-on, accommodations, records-only -----
  const mixCsv = path.join(tmp, 'mix.csv')
  writeFileSync(mixCsv, csv([
    ['', '', '', 'QA-PL464', 'StudentD', EMAILS[3], 'enrolled'],                                   // no parent email → keyed on the student's
    ['QA-PL465', 'ParentE', EMAILS[4], 'QA-PL465', 'StudentE', '', 'refunded', '', '', '', 'Refund 7/17'],
    ['QA-PL465', 'ParentF', EMAILS[5], 'QA-PL465', 'StudentF', '', 'moved_to_tutoring', '', '', 'extra time on tests', 'went 1on1 instead'],
    ['QA-PL465', 'ParentG', EMAILS[6], 'QA-PL465', 'StudentG', '', 'enrolled', '5', '375', 'front row seat', ''],
  ]))
  const dry = execSync(`node scripts/import-class-registrations.mjs --class ${classId} --csv ${mixCsv} --mapping ${mapping} --baseline-current --all-paid --silent --dry-run --by regress-pl465`, { encoding: 'utf8' })
  check('dry run prints the verdict table with totals per outcome', /Row \| who \| outcome \| verdict/.test(dry) && /Totals: .*enrolled=2.*refunded=1.*moved_to_tutoring=1|Totals: .*moved_to_tutoring=1.*refunded=1|Totals: .*refunded=1/.test(dry), dry.split('\n').find((l) => l.startsWith('Totals')))
  check('dry run flags the student-address family', /STUDENT address/.test(dry))
  check('dry run shows the add-on as paid, source=import', /add-on 5h \$375 \(as paid, source=import\)/.test(dry))
  const out4 = execSync(`node scripts/import-class-registrations.mjs --class ${classId} --csv ${mixCsv} --mapping ${mapping} --baseline-current --all-paid --silent --by regress-pl465`, { encoding: 'utf8' })
  const { data: famD } = await db.from('families').select('id, parent_email, students ( id, student_email )').eq('parent_email', EMAILS[3]).maybeSingle()
  check('PL-464 A: no-parent-email row imports with families.parent_email = the student address', famD?.parent_email === EMAILS[3] && famD.students?.[0]?.student_email === EMAILS[3])
  const { data: enrD } = await db.from('enrollments').select('id').eq('class_id', classId).eq('student_id', famD?.students?.[0]?.id ?? '-').maybeSingle()
  // The mute gate fires first for a muted row — lift it for this probe so the
  // same-address gate is what answers.
  await db.from('enrollments').update({ comms_muted: false }).eq('id', enrD?.id ?? '-')
  const sD = await sendOnce({ dedupeKey: `qa_pl464_probe_s:${enrD?.id}`, emailType: 'schedule_update', templateKey: 'SU_SCHEDULE_UPDATE', enrollmentId: enrD?.id, classId, to: [EMAILS[3]], subject: 'PL-464 probe', html: '<p>x</p><a href="https://highergroundlearning.com/classes">x</a>', recipientRole: 'student' })
  const { data: sRow } = await db.from('email_sends').select('status, cancel_reason').eq('dedupe_key', `qa_pl464_probe_s:${enrD?.id}`).maybeSingle()
  check("PL-464 B: the student leg to the parent's address is collapsed ('suppressed' + cancelled row 'same address')", sD === 'suppressed' && /same address/.test(sRow?.cancel_reason ?? ''), `${sD} ${JSON.stringify(sRow)}`)
  // (this enrollment is also comms-muted — the mute gate fires first for a real send; the same-address gate is proven on the student ROLE)
  const { data: famE } = await db.from('families').select('id, students ( id )').eq('parent_email', EMAILS[4]).maybeSingle()
  const { data: enrE } = await db.from('enrollments').select('payment_status, comms_muted, notes').eq('class_id', classId).eq('student_id', famE?.students?.[0]?.id ?? '-').maybeSingle()
  check('PL-465 refunded: enrollment exists as Refunded, muted, with the sheet note', enrE?.payment_status === 'Refunded' && enrE.comms_muted === true && /Refund 7\/17/.test(enrE.notes ?? ''), JSON.stringify(enrE))
  const { data: famF } = await db.from('families').select('id, students ( id, special_needs )').eq('parent_email', EMAILS[5]).maybeSingle()
  const { data: enrF } = await db.from('enrollments').select('id').eq('class_id', classId).eq('student_id', famF?.students?.[0]?.id ?? '-').maybeSingle()
  const { data: noteF } = await db.from('family_fact_edits').select('actor, summary').eq('family_id', famF?.id ?? '-').maybeSingle()
  check('PL-465 moved_to_tutoring: family + student created, NO enrollment', !!famF && !enrF)
  check('PL-465 moved_to_tutoring: dated staff note on the family record (activity trail)', noteF?.actor === 'staff:import' && /moved to 1-on-1 tutoring/.test(noteF.summary) && /went 1on1 instead/.test(noteF.summary), noteF?.summary)
  check('PL-465 D: accommodations land on the student field the intake captures', famF?.students?.[0]?.special_needs === 'extra time on tests')
  const { data: famG } = await db.from('families').select('id, students ( id )').eq('parent_email', EMAILS[6]).maybeSingle()
  const { data: enrG } = await db.from('enrollments').select('id, accommodations, enrollment_addons ( hours, price_paid, source, package_id, stripe_session_id )').eq('class_id', classId).eq('student_id', famG?.students?.[0]?.id ?? '-').maybeSingle()
  const addon = enrG?.enrollment_addons?.[0]
  check('PL-465 C: paid add-on recorded — hours, price, source=import, no package, no Stripe', Number(addon?.hours) === 5 && Number(addon?.price_paid) === 375 && addon?.source === 'import' && addon.package_id === null && addon.stripe_session_id === null, JSON.stringify(addon) + ' | ' + out4.split('\n').filter((l) => /add-on/.test(l)).join(' | '))
  check('PL-465 C: add-on never enqueued to QuickBooks', (await db.from('qbo_sync_log').select('id', { count: 'exact', head: true }).eq('enrollment_id', enrG?.id ?? '-')).count === 0)
  check('PL-465 D: accommodations also on the enrollment row (roster/emails read it)', enrG?.accommodations === 'front row seat')
  const again = execSync(`node scripts/import-class-registrations.mjs --class ${classId} --csv ${mixCsv} --mapping ${mapping} --baseline-current --all-paid --silent --by regress-pl465`, { encoding: 'utf8' })
  check('PL-465 E: re-run is idempotent for every outcome (all 4 rows skip)', /already-on-record=4/.test(again), again.split('\n').find((l) => l.startsWith('Totals')))
  const { count: notesF } = await db.from('family_fact_edits').select('id', { count: 'exact', head: true }).eq('family_id', famF?.id ?? '-')
  check('PL-465 E: the note is not duplicated on re-run', notesF === 1)
  // records-only mode: no --class; unknown school refused, known school noted.
  const roCsv = path.join(tmp, 'ro.csv')
  writeFileSync(roCsv, csv([['QA-PL465', 'ParentF', EMAILS[5], 'QA-PL465', 'StudentF', '', 'class_cancelled', '', '', '', 'Cairo cohort cancelled']]))
  let roErr = ''
  try { execSync(`node scripts/import-class-registrations.mjs --records-only --school NOSUCH --csv ${roCsv} --mapping ${mapping} --by regress-pl465`, { encoding: 'utf8', stdio: 'pipe' }) } catch (e) { roErr = String(e.stderr ?? e.stdout ?? '') }
  check('PL-465 B: --records-only with an unknown school nickname is refused, not created', /Unknown school nickname/.test(roErr))
  const ro = execSync(`node scripts/import-class-registrations.mjs --records-only --school MIS --csv ${roCsv} --mapping ${mapping} --by regress-pl465`, { encoding: 'utf8' })
  const { count: notesF2 } = await db.from('family_fact_edits').select('id', { count: 'exact', head: true }).eq('family_id', famF?.id ?? '-')
  check('PL-465 B/F: --records-only matches the SAME family/student and adds a second dated note (no enrollment)', /matches family/.test(ro) && notesF2 === 2 && !(await db.from('enrollments').select('id', { count: 'exact', head: true }).eq('student_id', famF?.students?.[0]?.id ?? '-')).count)

  // ---- act 5: PL-463 — the instructor stays quiet ------------------------------
  const { instructorQuietReason, sweepInstructorComms, syncInstructorClassCalendar } = req(path.join(build, 'instructor-comms.js'))
  await db.from('classes').update({ instructor_id: '74bc29e7-f578-4c5e-a20d-8805a74cf752' }).eq('id', classId) // Billy — as Scarlett will assign real instructors
  await db.from('enrollments').update({ comms_muted: true }).eq('class_id', classId) // the whole roster is a silent import (act 3's plain row was the control)
  const [b463] = await loadClassBundles(classId)
  check('PL-463 B: a class whose paid enrollments are all muted is records-only (quiet)', /records-only/.test(instructorQuietReason(b463) ?? ''), instructorQuietReason(b463))
  const sweep = await sweepInstructorComms(b463)
  const { count: inWelcome } = await db.from('email_sends').select('id', { count: 'exact', head: true }).eq('class_id', classId).like('dedupe_key', 'in_welcome:%')
  check('PL-463: the instructor sweep sends nothing to the newly assigned instructor', sweep.welcomed === 0 && sweep.digested === 0 && inWelcome === 0, JSON.stringify(sweep))
  await syncInstructorClassCalendar(b463)
  const { count: withEvents } = await db.from('sessions').select('id', { count: 'exact', head: true }).eq('class_id', classId).not('instructor_gcal_event_id', 'is', null)
  check('PL-463: no class-session calendar event is written for the quiet class', withEvents === 0)
  const ended = { ...b463, lastSession: '2020-01-02', firstSession: '2020-01-01' }
  check('PL-463 A: a class whose last session has passed is quiet', /ended/.test(instructorQuietReason(ended) ?? ''))
  const running = { ...b463, enrollments: [], firstSession: '2020-01-01', lastSession: '2999-01-01' }
  check('PL-463: a class already running with no portal enrollments is quiet (the MIS post-purge case)', /no portal enrollments/.test(instructorQuietReason(running) ?? ''))
  const live = { ...b463, enrollments: b463.enrollments.map((e) => ({ ...e, commsMuted: false })), firstSession: '2999-01-01', lastSession: '2999-02-01' }
  check('PL-463: a live portal-run class is NOT quiet', instructorQuietReason(live) === null)
} finally {
  await cleanup()
  rmSync(tmp, { recursive: true, force: true })
  console.log('\ncleaned up QA rows.')
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
