#!/usr/bin/env node
// PL-503 gate: one QA school × three classes (ended with scores + attendance,
// in progress, cancelled with a roster) → the school-classes API lists them
// newest first with counts, the expansion carries roster / scores /
// attendance + the report and detail links, and the cancelled class shows
// its cancellation note INSTEAD of scores. Self-cleaning.
//   node scripts/regress-school-classes.mjs [base-url]   (default http://localhost:3100)
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); return [k, v] }))
const base = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }
const plus = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
async function staffCookie() {
  const { data: profiles } = await db.from('profiles').select('id').eq('role', 'admin')
  const { data: users } = await db.auth.admin.listUsers()
  const admin = users.users.find((u) => profiles.some((p) => p.id === u.id))
  if (!admin) throw new Error('no admin user found')
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
const NICK = 'QASCHCL'
async function cleanup() {
  const { data: sch } = await db.from('schools').select('id').eq('nickname', NICK)
  for (const s of sch ?? []) {
    const { data: cls } = await db.from('classes').select('id').eq('school_id', s.id)
    for (const c of cls ?? []) {
      const { data: ens } = await db.from('enrollments').select('id').eq('class_id', c.id)
      for (const e of ens ?? []) await db.from('attendance_records').delete().eq('enrollment_id', e.id)
      await db.from('student_scores').delete().eq('class_id', c.id)
      await db.from('email_sends').delete().eq('class_id', c.id)
      await db.from('enrollments').delete().eq('class_id', c.id)
      await db.from('sessions').delete().eq('class_id', c.id)
      await db.from('classes').delete().eq('id', c.id)
    }
    await db.from('schools').delete().eq('id', s.id)
  }
  const { data: fams } = await db.from('families').select('id').like('parent_email', 'billy+qaschcl%')
  for (const f of fams ?? []) { await db.from('students').delete().eq('family_id', f.id); await db.from('families').delete().eq('id', f.id) }
}
await cleanup()
let up = false
try { up = (await fetch(`${base}/classes`)).status < 500 } catch { up = false }
check(`server reachable at ${base} (crashed gate ≠ green gate)`, up)
if (!up) process.exit(1)
try {
  const { data: school } = await db.from('schools').insert([{ name: 'QA School Classes', nickname: NICK, timezone: 'Europe/Rome', city: 'Milan', evergreen_code: 'qaschcl', collateral_language: 'en' }]).select('id').single()
  const mkClass = async (slug, o) => {
    const { data: c } = await db.from('classes').insert([{ class_type: 'SAT Prep', status: o.status ?? 'open', start_date: plus(o.first), price: 749, capacity: 20, min_enrollment: 1, school_id: school.id, slug, delivery_mode: 'in_person', default_location: 'Room 1', timezone: 'Europe/Rome', registration_close_date: plus(o.close), enrollment_deadline: plus(o.close), practice_test_count: 2 }]).select('id').single()
    const { data: sess } = await db.from('sessions').insert([0, 7].map((n) => ({ class_id: c.id, session_date: plus(o.first + n), start_time: '18:00:00', end_time: '20:00:00' }))).select('id')
    return { id: c.id, sessions: sess }
  }
  const mkStudent = async (i) => {
    const { data: fam } = await db.from('families').insert([{ parent_first_name: 'QA', parent_last_name: `Parent${i}`, parent_email: `billy+qaschcl-${i}@highergroundlearning.com` }]).select('id').single()
    const { data: st } = await db.from('students').insert([{ family_id: fam.id, first_name: `Stu${i}`, last_name: 'Classes', school_id: school.id }]).select('id').single()
    return st.id
  }
  const ended = await mkClass('qaschcl-sat-prep-spring25', { first: -60, close: -70 })
  const inprog = await mkClass('qaschcl-sat-prep-fall26', { first: -3, close: -5 })
  const cancelled = await mkClass('qaschcl-sat-prep-summer26', { first: 30, close: 25, status: 'cancelled' })
  const s1 = await mkStudent(1), s2 = await mkStudent(2), s3 = await mkStudent(3)
  const { data: e1 } = await db.from('enrollments').insert([{ class_id: ended.id, student_id: s1, payment_status: 'Completed', paid_at: new Date().toISOString(), comms_muted: true }]).select('id').single()
  const { data: e2 } = await db.from('enrollments').insert([{ class_id: ended.id, student_id: s2, payment_status: 'Paid', paid_at: new Date().toISOString(), comms_muted: true }]).select('id').single()
  await db.from('enrollments').insert([{ class_id: cancelled.id, student_id: s3, payment_status: 'Refunded', class_cancelled: true, cancellation_outcome: 'refunded', comms_muted: true }])
  await db.from('student_scores').insert([
    { student_id: s1, class_id: ended.id, test_label: 'Diagnostic 1', section_scores: { 'Reading & Writing': 500, Math: 500 }, total: 1000, taken_at: plus(-60), source: 'manual' },
    { student_id: s1, class_id: ended.id, test_label: 'Final', section_scores: { 'Reading & Writing': 560, Math: 580 }, total: 1140, taken_at: plus(-53), source: 'manual' },
    { student_id: s2, class_id: ended.id, test_label: 'Diagnostic 1', section_scores: { 'Reading & Writing': 600, Math: 600 }, total: 1200, taken_at: plus(-60), source: 'manual' },
    { student_id: s2, class_id: ended.id, test_label: 'Final', section_scores: { 'Reading & Writing': 620, Math: 640 }, total: 1260, taken_at: plus(-53), source: 'manual' },
  ])
  await db.from('attendance_records').insert([
    { session_id: ended.sessions[0].id, enrollment_id: e1.id, present: true, arrived_late: false, left_early: false },
    { session_id: ended.sessions[1].id, enrollment_id: e1.id, present: false, arrived_late: false, left_early: false },
    { session_id: ended.sessions[0].id, enrollment_id: e2.id, present: true, arrived_late: false, left_early: false },
    { session_id: ended.sessions[1].id, enrollment_id: e2.id, present: true, arrived_late: false, left_early: false },
  ])
  const cookie = await staffCookie()
  const get = async (q) => { const r = await fetch(`${base}/api/admin/school-classes?${q}`, { headers: { cookie } }); return { status: r.status, j: await r.json().catch(() => ({})) } }
  const anon = await fetch(`${base}/api/admin/school-classes?school=${school.id}`)
  check('school-classes API refuses a signed-out caller', anon.status === 403, String(anon.status))
  const list = await get(`school=${school.id}`)
  const rows = list.j.rows ?? []
  check('lists the three classes, newest first', list.status === 200 && rows.map((r) => r.slug).join(',') === 'qaschcl-sat-prep-summer26,qaschcl-sat-prep-fall26,qaschcl-sat-prep-spring25', rows.map((r) => r.slug).join(','))
  const endedRow = rows.find((r) => r.id === ended.id), cancRow = rows.find((r) => r.id === cancelled.id), ipRow = rows.find((r) => r.id === inprog.id)
  check('row facts: term · type · dates · counts · group', endedRow?.term === 'spring25' && endedRow.classType === 'SAT Prep' && endedRow.firstSession === plus(-60) && endedRow.lastSession === plus(-53) && endedRow.paid === 2 && endedRow.enrolled === 2 && endedRow.group === 'ended', JSON.stringify(endedRow))
  check('in-progress + cancelled groups read honestly', ipRow?.group === 'in-progress' && cancRow?.group === 'cancelled' && cancRow.status === 'cancelled', `${ipRow?.group} ${cancRow?.group}`)
  const det = await get(`class=${ended.id}`)
  const d = det.j.detail
  check('ended class expansion: roster with parent email / payment / comms', det.status === 200 && d?.roster?.length === 2 && d.roster.every((r) => /billy\+qaschcl-\d@/.test(r.parentEmail) && r.commsState === 'muted') && d.roster.map((r) => r.paymentStatus).sort().join(',') === 'Completed,Paid', JSON.stringify(d?.roster))
  check('ended class expansion: scores per student + class average + average improvement (from the class report loader)', d?.report?.scored === 2 && d.report.classAverage.initial === 1100 && d.report.classAverage.final === 1200 && d.report.averageImprovement === 100 && d.report.students.every((s) => s.initial && s.final), JSON.stringify(d?.report && { ...d.report, students: d.report.students.length }))
  check('ended class expansion: attendance summary (75% average over 2 tracked)', d?.attendance?.students === 2 && d.attendance.averagePct === 75, JSON.stringify(d?.attendance))
  check('ended class expansion: report + detail links', d?.links?.report === `/class-report/${ended.id}` && d.links.detail === `/admin?class=${ended.id}`, JSON.stringify(d?.links))
  const cd = (await get(`class=${cancelled.id}`)).j.detail
  check('cancelled class shows its cancellation note INSTEAD of scores', cd?.status === 'cancelled' && cd.report === null && /Cancelled with 1 on the roster — 1 refunded/.test(cd.cancellation?.note ?? '') && cd.links.report === null, JSON.stringify(cd?.cancellation))
  const ip = (await get(`class=${inprog.id}`)).j.detail
  check('in-progress class with no scores: empty roster, no cancellation note, report link present', ip?.cancellation === null && ip.roster.length === 0 && ip.links.report === `/class-report/${inprog.id}`, JSON.stringify(ip))
} finally {
  await cleanup()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
