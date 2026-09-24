#!/usr/bin/env node
// PL-504 gate: the historical importer on a 6-row fixture (2 existing
// students, 2 new, 1 unknown class refused, 1 duplicate of an existing row →
// idempotent), then the Results API on the same seed. Self-cleaning.
//   node scripts/regress-import-past-scores.mjs [base-url]   (default http://localhost:3100)
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); return [k, v] }))
const base = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }
const plus = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function safeRm(p) { try { rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }
async function staffCookie() {
  const { data: profiles } = await db.from('profiles').select('id').eq('role', 'admin')
  const { data: users } = await db.auth.admin.listUsers()
  const admin = users.users.find((u) => profiles.some((p) => p.id === u.id))
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: admin.email })
  if (error) throw error
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const { data: verified, error: vErr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
  if (vErr || !verified.session) throw vErr ?? new Error('no session')
  const encoded = 'base64-' + Buffer.from(JSON.stringify(verified.session)).toString('base64url')
  const name = `sb-${ref}-auth-token`, CHUNK = 3180
  if (encoded.length <= CHUNK) return `${name}=${encoded}`
  const parts = []; for (let i = 0; i * CHUNK < encoded.length; i++) parts.push(`${name}.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`)
  return parts.join('; ')
}
const NICK = 'QAIMPSC'
async function cleanup() {
  const { data: sch } = await db.from('schools').select('id').eq('nickname', NICK)
  for (const s of sch ?? []) {
    const { data: cls } = await db.from('classes').select('id').eq('school_id', s.id)
    for (const c of cls ?? []) {
      await db.from('student_scores').delete().eq('class_id', c.id)
      await db.from('email_sends').delete().eq('class_id', c.id)
      await db.from('enrollments').delete().eq('class_id', c.id)
      await db.from('sessions').delete().eq('class_id', c.id)
      await db.from('classes').delete().eq('id', c.id)
    }
    await db.from('schools').delete().eq('id', s.id)
  }
  const { data: fams } = await db.from('families').select('id').like('parent_email', 'billy+qaimpsc%')
  for (const f of fams ?? []) {
    const { data: kids } = await db.from('students').select('id').eq('family_id', f.id)
    for (const k of kids ?? []) { await db.from('student_scores').delete().eq('student_id', k.id); await db.from('enrollments').delete().eq('student_id', k.id) }
    await db.from('students').delete().eq('family_id', f.id); await db.from('families').delete().eq('id', f.id)
  }
}
await cleanup()
let up = false
try { up = (await fetch(`${base}/classes`)).status < 500 } catch { up = false }
check(`server reachable at ${base} (crashed gate ≠ green gate)`, up)
if (!up) process.exit(1)
const tmp = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-import-scores-'))
try {
  const { data: school } = await db.from('schools').insert([{ name: 'QA Import Scores', nickname: NICK, timezone: 'America/Denver', city: 'Salt Lake City', evergreen_code: 'qaimpsc', collateral_language: 'en' }]).select('id').single()
  const { data: cls } = await db.from('classes').insert([{ class_type: 'SAT Prep', status: 'open', start_date: plus(-120), price: 749, capacity: 20, min_enrollment: 1, school_id: school.id, slug: 'qaimpsc-sat-prep-spring26', delivery_mode: 'in_person', default_location: 'Room 1', timezone: 'America/Denver', registration_close_date: plus(-130), enrollment_deadline: plus(-130), practice_test_count: 2 }]).select('id').single()
  await db.from('sessions').insert([0, 7].map((n) => ({ class_id: cls.id, session_date: plus(-120 + n), start_time: '16:00:00', end_time: '18:00:00' })))
  // two EXISTING students: one matched by student email, one by parent email + name
  const { data: f1 } = await db.from('families').insert([{ parent_first_name: 'Ann', parent_last_name: 'Existing', parent_email: 'billy+qaimpsc-1@highergroundlearning.com' }]).select('id').single()
  const { data: st1 } = await db.from('students').insert([{ family_id: f1.id, first_name: 'Erin', last_name: 'Existing', student_email: 'billy+qaimpsc-erin@highergroundlearning.com', school_id: school.id }]).select('id').single()
  const { data: f2 } = await db.from('families').insert([{ parent_first_name: 'Bo', parent_last_name: 'Existing', parent_email: 'billy+qaimpsc-2@highergroundlearning.com' }]).select('id').single()
  const { data: st2 } = await db.from('students').insert([{ family_id: f2.id, first_name: 'Finn', last_name: 'Existing', school_id: school.id }]).select('id').single()
  const H = 'class,student_first,student_last,parent_email,student_email,parent_first,parent_last,d1_rw,d1_math,d1_total,d1_date,d2_rw,d2_math,d2_total,d2_date,final_rw,final_math,final_total,final_date,attendance'
  const D1 = plus(-120), D2 = plus(-113), FIN = plus(-106)
  const rows = [
    `qaimpsc-sat-prep-spring26,Erin,Existing,,billy+qaimpsc-erin@highergroundlearning.com,,,500,510,,${D1},520,540,,${D2},560,590,,${FIN},7`,
    `qaimpsc,Finn,Existing,billy+qaimpsc-2@highergroundlearning.com,,,,600,600,1200,${D1},,,,,640,660,1300,${FIN},8`,
    `qaimpsc-sat-prep-spring26,Nina,Newfam,billy+qaimpsc-3@highergroundlearning.com,,Cara,Newfam,450,470,920,${D1},,,,,500,520,1020,${FIN},6`,
    `qaimpsc-sat-prep-spring26,Omar,Newkid,billy+qaimpsc-4@highergroundlearning.com,billy+qaimpsc-omar@highergroundlearning.com,Dee,Newkid,700,680,1380,${D1},,,,,690,700,1390,${FIN},`,
    `no-such-class-ever,Zed,Unknown,billy+qaimpsc-9@highergroundlearning.com,,,,500,500,1000,${D1},,,,,,,,,`,
    `qaimpsc-sat-prep-spring26,Erin,Existing,,billy+qaimpsc-erin@highergroundlearning.com,,,500,510,,${D1},520,540,,${D2},560,590,,${FIN},7`,
  ]
  const csv = path.join(tmp, 'fixture.csv')
  writeFileSync(csv, [H, ...rows].join('\n') + '\n')
  const run = (extra) => JSON.parse(execSync(`node scripts/import-past-scores.mjs --csv ${JSON.stringify(csv)} --json ${extra}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').pop())
  const dry = run('')
  check('dry run: 6 CSV rows → 1 refused (unknown class), 5 planned', dry.mode === 'dry-run' && dry.summary.csvRows === 6 && dry.summary.refused === 1 && dry.rows.length === 5 && /not found/.test(dry.refused[0].reason), JSON.stringify(dry.summary))
  check('dry run: 2 existing students matched (student email · parent email + name), 2 new (+ the duplicate row re-matches Erin and reads duplicate)', dry.summary.studentsMatched === 3 && dry.rows[4].enrollment === 'duplicate row in this file' && dry.rows[4].scores.every((x) => /duplicate row/.test(x)) && dry.summary.studentsNew === 2 && /existing — student email/.test(dry.rows[0].student) && /existing — parent email \+ name/.test(dry.rows[1].student) && /NEW — new family \+ student/.test(dry.rows[2].student), dry.rows.map((r) => r.student).join(' | '))
  check('dry run: school CODE resolves when the school has exactly one class', dry.rows[1].class === 'qaimpsc-sat-prep-spring26')
  check('dry run: nothing written (no enrollments, no scores)', (await db.from('enrollments').select('id', { count: 'exact', head: true }).eq('class_id', cls.id)).count === 0 && (await db.from('student_scores').select('id', { count: 'exact', head: true }).eq('class_id', cls.id)).count === 0)
  const applied = run('--apply --by qa-gate')
  check('apply: 2 families + 2 students created, 4 enrollments, 9 score rows (Erin 3 + Finn 2 + Nina 2 + Omar 2; the duplicate row adds none)', applied.applied.familiesCreated === 2 && applied.applied.studentsCreated === 2 && applied.applied.enrollmentsCreated === 4 && applied.applied.scoresInserted === 9 && applied.applied.errors.length === 0, JSON.stringify(applied.applied))
  const { data: ens } = await db.from('enrollments').select('student_id, payment_status, source, source_recorded_by, comms_muted, notes').eq('class_id', cls.id)
  check('enrollment provenance = sheet_import:<by>', ens.every((e) => e.source_recorded_by === 'sheet_import:qa-gate'), JSON.stringify(ens.map((e) => e.source_recorded_by)))
  check('enrollments are Completed · source import (CHECK-constrained) with sheet_import:<by> provenance · comms_muted · the sheet attendance count in the note', ens.length === 4 && ens.every((e) => e.payment_status === 'Completed' && e.source === 'import' && e.comms_muted === true) && ens.filter((e) => /Attended \d sessions/.test(e.notes ?? '')).length === 3, JSON.stringify(ens.map((e) => [e.source, e.comms_muted, e.notes?.slice(0, 40)])))
  const { data: sc } = await db.from('student_scores').select('student_id, test_label, total, section_scores, source, recorded_by').eq('class_id', cls.id)
  const erin = sc.filter((s) => s.student_id === st1.id)
  check('Erin (existing by student email): 3 scores, totals composed from sections when blank, source sheet_import, recorded_by', erin.length === 3 && erin.find((s) => s.test_label === 'Diagnostic 1')?.total === 1010 && erin.find((s) => s.test_label === 'Final')?.total === 1150 && erin.every((s) => s.source === 'sheet_import' && s.recorded_by === 'qa-gate'), JSON.stringify(erin.map((s) => [s.test_label, s.total])))
  check('Finn (existing by parent email + name): sections kept + given total wins', sc.filter((s) => s.student_id === st2.id).length === 2 && sc.find((s) => s.student_id === st2.id && s.test_label === 'Final')?.total === 1300 && sc.find((s) => s.student_id === st2.id && s.test_label === 'Final')?.section_scores?.Math === 660)
  const { data: newKids } = await db.from('students').select('first_name, student_email, families ( parent_email, parent_first_name )').in('first_name', ['Nina', 'Omar'])
  check('new families/students created through the one path with the CSV parent names + emails', newKids.length === 2 && newKids.every((k) => /billy\+qaimpsc-[34]@/.test((Array.isArray(k.families) ? k.families[0] : k.families)?.parent_email ?? '')) && newKids.find((k) => k.first_name === 'Omar')?.student_email === 'billy+qaimpsc-omar@highergroundlearning.com', JSON.stringify(newKids))
  const again = run('--apply --by qa-gate')
  check('second --apply is idempotent: 0 families, 0 students, 0 enrollments, 0 scores', again.applied.familiesCreated === 0 && again.applied.studentsCreated === 0 && again.applied.enrollmentsCreated === 0 && again.applied.scoresInserted === 0 && again.summary.scoresSkipped === 9 + 3, JSON.stringify(again.applied) + ' ' + JSON.stringify(again.summary))
  check('unknown class stays refused on apply (no row for Zed)', (await db.from('families').select('id', { count: 'exact', head: true }).eq('parent_email', 'billy+qaimpsc-9@highergroundlearning.com')).count === 0)
  // Results API on the same seed
  const cookie = await staffCookie()
  const res = await fetch(`${base}/api/admin/results`, { headers: { cookie } })
  const j = await res.json().catch(() => ({}))
  const cRow = (j.results?.byClass ?? []).find((b) => b.classId === cls.id)
  check('results API: the class appears with n=4 scored, 4 with final, avg improvement +87.5 (Erin +140 · Finn +100 · Nina +100 · Omar +10), 100% improved', res.status === 200 && cRow && cRow.scored === 4 && cRow.withFinal === 4 && cRow.avgImprovement === 87.5 && cRow.pctImproved === 100 && cRow.improved === 4, JSON.stringify(cRow))
  check('results API: per-section improvement (R&W +50 · Math +60 for Erin etc.) present', cRow?.bySection?.['Reading & Writing']?.n === 4 && cRow.bySection['Math'].n === 4 && cRow.bySection['Reading & Writing'].avgImprovement != null, JSON.stringify(cRow?.bySection))
  const sRow = (j.results?.bySchool ?? []).find((b) => b.key === school.id)
  const tRow = (j.results?.byTerm ?? []).find((b) => b.key === 'spring26')
  check('results API: school + term buckets carry the same four', sRow?.scored === 4 && sRow.label === NICK && tRow?.scored >= 4, JSON.stringify({ s: sRow?.scored, t: tRow?.scored }))
  check('results API: marketing block has n, date range, students served ≥ 4', j.results?.marketing?.n >= 4 && j.results.marketing.studentsServed >= 4 && j.results.marketing.from && j.results.marketing.to, JSON.stringify(j.results?.marketing))
  const csvRes = await fetch(`${base}/api/admin/results?csv=1`, { headers: { cookie } })
  const csvText = await csvRes.text()
  check('results CSV export: text/csv with the class row', /text\/csv/.test(csvRes.headers.get('content-type') ?? '') && csvText.split('\n')[0].startsWith('scope,label,') && csvText.includes(`class,${NICK} SAT Prep spring26`), csvText.split('\n').slice(0, 2).join(' | '))
  const anon = await fetch(`${base}/api/admin/results`)
  check('results API refuses a signed-out caller', anon.status === 403)
  const page = await fetch(`${base}/admin/results`, { headers: { cookie } })
  check('/admin/results renders for staff', page.status === 200)
} finally {
  safeRm(tmp)
  await cleanup()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
