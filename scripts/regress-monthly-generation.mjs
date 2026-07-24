#!/usr/bin/env node
// PL-144 regression (send-light — RESEND_API_KEY deleted, so T1/alerts skip):
// 1) catch-up gate — generation is "due" any day >= generateDay until the
//    month's completion marker is stamped (a fully-failed generation day no
//    longer skips the month);
// 2) per-family isolation — a poison engagement (broken tutor timezone) fails
//    ONLY its own family; everyone else generates, and a clean re-run after
//    the fix picks up exactly the failed family (idempotent retry).
// All DB work is scoped to QA fixtures via generateMonthlyCycle's familyScope
// param; the completion marker is saved and restored.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
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
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
delete process.env.RESEND_API_KEY // no emails, ever, from this harness

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-gen')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/tutoring-billing.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const tb = require(path.join(out, 'tutoring-billing.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const MARKER_KEY = 'tutoring_generated_period'
const QA_MONTH = '2027-03' // far future: never collides with the live cycle
const QA_PERIOD = '2027-03-01'
const recurrence = [{ weekday: 3, start_time: '16:00', duration_minutes: 60 }]

const cleanup = { engagements: [], students: [], families: [], instructors: [], subjects: [] }
const readMarker = async () => {
  const { data } = await db.from('app_settings').select('value').eq('key', MARKER_KEY).maybeSingle()
  return data?.value ?? null
}
const originalMarker = await readMarker()

const mkTutor = async (name, tz) => {
  const { data, error } = await db.from('instructors').insert([{
    name, email: `billy+qa-pl144-${name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@highergroundlearning.com`,
    timezone: tz, tutoring_active: true,
  }]).select('id').single()
  if (error) throw new Error('tutor fixture: ' + error.message)
  cleanup.instructors.push(data.id)
  return data.id
}
const mkFamilyWithStudent = async (label) => {
  const { data: fam, error } = await db.from('families').insert([{
    parent_first_name: `QA-PL144 ${label}`, parent_last_name: 'Parent',
    parent_email: `billy+qa-pl144-${label.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@highergroundlearning.com`,
  }]).select('id').single()
  if (error) throw new Error('family fixture: ' + error.message)
  cleanup.families.push(fam.id)
  const { data: stu, error: e2 } = await db.from('students').insert([{
    family_id: fam.id, first_name: `QA-PL144-${label}`, last_name: 'Student',
  }]).select('id').single()
  if (e2) throw new Error('student fixture: ' + e2.message)
  cleanup.students.push(stu.id)
  return { familyId: fam.id, studentId: stu.id }
}
const mkEngagement = async (studentId, tutorId, subjectId) => {
  const { data, error } = await db.from('tutoring_engagements').insert([{
    student_id: studentId, tutor_id: tutorId, subject_id: subjectId,
    hourly_rate: 80, funding: 'monthly_billed', recurrence, status: 'active',
  }]).select('id').single()
  if (error) throw new Error('engagement fixture: ' + error.message)
  cleanup.engagements.push(data.id)
  return data.id
}
const sessionCount = async (engId) => {
  const { count } = await db.from('tutoring_sessions')
    .select('id', { count: 'exact', head: true }).eq('engagement_id', engId)
  return count ?? 0
}

try {
  const settings = await tb.loadCycleSettings()
  const gd = settings.generateDay // default 20
  // Dates pinned to 18:00Z = late morning Denver, same calendar day.
  const octDate = (day) => new Date(`2026-10-${String(day).padStart(2, '0')}T18:00:00Z`)

  // ---- 1. The catch-up gate -------------------------------------------------
  await db.from('app_settings').delete().eq('key', MARKER_KEY)
  check('1. before generateDay → not due', (await tb.generationDueFor(octDate(gd - 5), settings)) === null)
  const onDay = await tb.generationDueFor(octDate(gd), settings)
  check('2. on generateDay → due for next month', onDay?.period === '2026-11-01', JSON.stringify(onDay))
  const lateDay = await tb.generationDueFor(octDate(Math.min(gd + 5, 28)), settings)
  check('3. AFTER generateDay, month unmarked → still due (catch-up)', lateDay?.period === '2026-11-01', JSON.stringify(lateDay))
  await db.from('app_settings').upsert({ key: MARKER_KEY, value: '2026-11-01' })
  check('4. marker stamped → no longer due', (await tb.generationDueFor(octDate(Math.min(gd + 5, 28)), settings)) === null)
  check('5. marker from an OLDER month → due again', (await tb.generationDueFor(new Date('2026-11-25T18:00:00Z'), settings))?.period === '2026-12-01')

  // ---- 2. Poison engagement: per-family isolation --------------------------
  const { data: subj, error: se } = await db.from('subjects')
    .insert([{ name: `QA-PL144 Subject ${Math.random().toString(36).slice(2, 6)}`, category: 'subject_tutoring', hourly_rate: 80 }])
    .select('id').single()
  if (se) throw new Error('subject fixture: ' + se.message)
  cleanup.subjects.push(subj.id)
  const tutorOk = await mkTutor('Good', 'America/Denver')
  const tutorBad = await mkTutor('Poison', 'Not/AZone') // Intl throws on use
  const famA = await mkFamilyWithStudent('Alpha')
  const famB = await mkFamilyWithStudent('Poisoned')
  const engA = await mkEngagement(famA.studentId, tutorOk, subj.id)
  const engB = await mkEngagement(famB.studentId, tutorBad, subj.id)

  const scope = [famA.familyId, famB.familyId]
  const run1 = await tb.generateMonthlyCycle(new Date(), QA_MONTH, scope)
  check('6. poison family isolated: exactly one failure reported', run1.familiesFailed === 1, JSON.stringify(run1))
  const aCount = await sessionCount(engA)
  check('7. healthy family generated sessions', aCount > 0, `sessions=${aCount}`)
  check('8. poison family generated nothing', (await sessionCount(engB)) === 0)
  const { data: invA } = await db.from('tutoring_invoices').select('id, status')
    .eq('family_id', famA.familyId).eq('period', QA_PERIOD).maybeSingle()
  check('9. healthy family has its proposed invoice', invA?.status === 'proposed', JSON.stringify(invA))
  const { data: invB } = await db.from('tutoring_invoices').select('id')
    .eq('family_id', famB.familyId).eq('period', QA_PERIOD).maybeSingle()
  check('10. poison family has NO invoice (no partial bill)', !invB)
  check('11. scoped run never stamps the completion marker', (await readMarker()) === '2026-11-01')

  // ---- 3. Fix the poison → clean re-run picks up only the failed family ----
  await db.from('instructors').update({ timezone: 'America/Denver' }).eq('id', tutorBad)
  const run2 = await tb.generateMonthlyCycle(new Date(), QA_MONTH, scope)
  check('12. re-run after fix: zero failures', run2.familiesFailed === 0, JSON.stringify(run2))
  check('13. previously-failed family now generated', (await sessionCount(engB)) > 0)
  check('14. healthy family idempotent (no duplicate sessions)', (await sessionCount(engA)) === aCount)
  const { data: invB2 } = await db.from('tutoring_invoices').select('id, status')
    .eq('family_id', famB.familyId).eq('period', QA_PERIOD).maybeSingle()
  check('15. recovered family has its invoice', invB2?.status === 'proposed', JSON.stringify(invB2))
} catch (e) {
  check('flow ran without crashing', false, e.stack?.slice(0, 400) ?? e.message)
} finally {
  for (const id of cleanup.engagements) {
    const { data: inv } = await db.from('tutoring_invoices').select('id')
      .in('family_id', cleanup.families).eq('period', QA_PERIOD)
    for (const i of inv ?? []) await db.from('tutoring_invoice_lines').delete().eq('invoice_id', i.id)
    await db.from('tutoring_sessions').delete().eq('engagement_id', id)
  }
  await db.from('tutoring_invoices').delete().in('family_id', cleanup.families).eq('period', QA_PERIOD)
  for (const id of cleanup.engagements) await db.from('tutoring_engagements').delete().eq('id', id)
  for (const id of cleanup.students) await db.from('students').delete().eq('id', id)
  for (const id of cleanup.families) await db.from('families').delete().eq('id', id)
  for (const id of cleanup.instructors) await db.from('instructors').delete().eq('id', id)
  for (const id of cleanup.subjects) await db.from('subjects').delete().eq('id', id)
  // Restore the marker exactly as found.
  if (originalMarker === null) await db.from('app_settings').delete().eq('key', MARKER_KEY)
  else await db.from('app_settings').upsert({ key: MARKER_KEY, value: originalMarker })
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done (fixtures removed, generation marker restored)')
}
process.exit(failures === 0 ? 0 : 1)
