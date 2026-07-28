#!/usr/bin/env node
// PL-200 regression: a monthly-billed engagement that starts mid-month bills
// its current-month remainder immediately (billMidMonthStart), with the T1
// labeled as the partial period; post-20th the family also folds into the
// already-generated next month. Send-light: the compiled email.js sendOnce is
// REPLACED with a capturing stub before tutoring-billing loads, so no email
// machinery runs and the harness can assert on the rendered T1.
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
delete process.env.RESEND_API_KEY // belt and suspenders — the stub never sends

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-pl200')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/tutoring-billing.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)

// Capture every send instead of sending (loaded BEFORE tutoring-billing so
// the dependency graph sees the stub).
const emailMod = require(path.join(out, 'email.js'))
const sends = []
emailMod.sendOnce = async (opts) => { sends.push(opts); return 'sent' }
emailMod.sendAdminAlert = async (opts) => { sends.push({ ...opts, __alert: true }); return 'sent' }

const tb = require(path.join(out, 'tutoring-billing.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const TZ = 'America/Denver'
const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ }) // YYYY-MM-DD
const curYm = today.slice(0, 7)
const curPeriod = `${curYm}-01`
const curMonthName = new Date(`${curPeriod}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
const lastDayNum = new Date(Date.UTC(Number(curYm.slice(0, 4)), Number(curYm.slice(5, 7)), 0, 12)).getUTCDate()
// Start the engagement TOMORROW (mid-month by construction; the suite is a
// no-op guard if run on the last day of a month — it says so and passes).
const startDate = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ })
if (startDate.slice(0, 7) !== curYm) {
  console.log('PASS  (month rolls over tomorrow — mid-month scenario not constructible today; suite is a no-op)')
  process.exit(0)
}

const marker0 = (await db.from('app_settings').select('value').eq('key', 'tutoring_generated_period').maybeSingle()).data?.value ?? null

const cleanup = { engagements: [], students: [], families: [], instructors: [], invoices: [], enrollments: [] }
async function destroy() {
  for (const id of cleanup.engagements) {
    await db.from('tutoring_sessions').delete().eq('engagement_id', id)
    await db.from('tutoring_engagements').delete().eq('id', id)
  }
  for (const id of cleanup.invoices) {
    await db.from('tutoring_invoice_lines').delete().eq('invoice_id', id)
    await db.from('tutoring_invoices').delete().eq('id', id)
  }
  for (const id of cleanup.enrollments) {
    await db.from('enrollment_addons').delete().eq('enrollment_id', id)
    await db.from('enrollments').delete().eq('id', id)
  }
  for (const id of cleanup.students) await db.from('students').delete().eq('id', id)
  for (const id of cleanup.families) {
    await db.from('tutoring_invoices').delete().eq('family_id', id) // any stragglers
    await db.from('families').delete().eq('id', id)
  }
  for (const id of cleanup.instructors) await db.from('instructors').delete().eq('id', id)
}

try {
  const rand = Math.random().toString(36).slice(2, 8)
  const { data: tutor } = await db.from('instructors').insert([{
    name: 'QA-PL200 Tutor', email: `billy+qa-pl200-tutor-${rand}@highergroundlearning.com`,
    timezone: TZ, tutoring_active: true,
  }]).select('id').single()
  cleanup.instructors.push(tutor.id)
  const { data: subject } = await db.from('subjects').select('id').limit(1).single()

  const mkFam = async (label) => {
    const { data: fam } = await db.from('families').insert([{
      parent_first_name: `QA-PL200-${label}`, parent_last_name: 'Parent',
      parent_email: `billy+qa-pl200-${label}-${rand}@highergroundlearning.com`,
    }]).select('id').single()
    cleanup.families.push(fam.id)
    const { data: stu } = await db.from('students').insert([{
      family_id: fam.id, first_name: `QA-PL200-${label}`, last_name: 'Student',
    }]).select('id').single()
    cleanup.students.push(stu.id)
    return { familyId: fam.id, studentId: stu.id }
  }

  // Recurrence covers every weekday so the remainder always has sessions
  // between tomorrow and month-end regardless of what day it is today.
  const recurrence = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: '16:00', duration_minutes: 60 }))

  // ---- Monthly-billed mid-month start ------------------------------------
  const A = await mkFam('monthly')
  const { data: engA } = await db.from('tutoring_engagements').insert([{
    student_id: A.studentId, tutor_id: tutor.id, subject_id: subject.id,
    hourly_rate: 90, funding: 'monthly_billed', recurrence, status: 'active',
    start_date: startDate,
  }]).select('id').single()
  cleanup.engagements.push(engA.id)

  await tb.billMidMonthStart(engA.id)

  const { data: invCur } = await db.from('tutoring_invoices')
    .select('id, status, total').eq('family_id', A.familyId).eq('period', curPeriod).maybeSingle()
  if (invCur) cleanup.invoices.push(invCur.id)
  check('1. current-month remainder invoice exists and is proposed', invCur?.status === 'proposed', `status=${invCur?.status}`)

  const { data: sessA } = await db.from('tutoring_sessions')
    .select('starts_at').eq('engagement_id', engA.id).order('starts_at')
  const days = (sessA ?? []).map((s) => new Date(s.starts_at).toLocaleDateString('en-CA', { timeZone: TZ }))
  check('2. no session materialized before the start date', days.every((d) => d >= startDate), `earliest=${days[0]} start=${startDate}`)
  const curDays = days.filter((d) => d.slice(0, 7) === curYm)
  check('3. remainder sessions run start → month-end only', curDays.length > 0 && curDays.every((d) => d >= startDate), `${curDays.length} this month`)

  const t1s = sends.filter((s) => String(s.dedupeKey ?? '').startsWith('t1_proposal:'))
  const t1Cur = t1s.find((s) => s.dedupeKey === `t1_proposal:${invCur?.id}`)
  const startDayNum = Number((curDays[0] ?? startDate).slice(8, 10))
  const expectedLabel = `${curMonthName} ${startDayNum}–${lastDayNum}`
  check('4. T1 label reads the partial period, not the bare month',
    !!t1Cur && (t1Cur.html.includes(expectedLabel) || t1Cur.subject.includes(expectedLabel)),
    `expected "${expectedLabel}"`)

  // ---- Post-20th edge: next month folds in too ---------------------------
  const denverDay = Number(today.slice(8, 10))
  const y = Number(curYm.slice(0, 4)), m = Number(curYm.slice(5, 7))
  const nextPeriod = (m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`) + '-01'
  const { data: invNext } = await db.from('tutoring_invoices')
    .select('id, status').eq('family_id', A.familyId).eq('period', nextPeriod).maybeSingle()
  if (invNext) cleanup.invoices.push(invNext.id)
  if (denverDay >= 20 || marker0 === nextPeriod) {
    check('5. post-20th: next month generated for the new family too', !!invNext, `period=${nextPeriod}`)
    const nextT1 = sends.find((s) => s.dedupeKey === `t1_proposal:${invNext?.id}`)
    check('6. next-month T1 label is the plain month (not partial)',
      !!nextT1 && !new RegExp(`${curMonthName} \\d`).test(nextT1.subject ?? ''), '')
  } else {
    check('5. pre-20th: next month NOT generated early', !invNext, '')
    check('6. (n/a pre-20th)', true, '')
  }

  // ---- Idempotency -------------------------------------------------------
  const linesBefore = (await db.from('tutoring_invoice_lines').select('id').eq('invoice_id', invCur.id)).data?.length ?? 0
  const sessBefore = sessA?.length ?? 0
  await tb.billMidMonthStart(engA.id)
  const linesAfter = (await db.from('tutoring_invoice_lines').select('id').eq('invoice_id', invCur.id)).data?.length ?? 0
  const sessAfter = (await db.from('tutoring_sessions').select('id').eq('engagement_id', engA.id)).data?.length ?? 0
  check('7. re-run is idempotent (same sessions, same lines)', linesAfter === linesBefore && sessAfter === sessBefore,
    `lines ${linesBefore}→${linesAfter}, sessions ${sessBefore}→${sessAfter}`)

  // ---- Paid invoices are never touched -----------------------------------
  await db.from('tutoring_invoices').update({ status: 'paid' }).eq('id', invCur.id)
  await db.from('tutoring_invoice_lines').delete().eq('invoice_id', invCur.id)
  await tb.billMidMonthStart(engA.id)
  const linesPaid = (await db.from('tutoring_invoice_lines').select('id').eq('invoice_id', invCur.id)).data?.length ?? 0
  const { data: stillPaid } = await db.from('tutoring_invoices').select('status').eq('id', invCur.id).single()
  check('8. a paid invoice is untouched by the scoped run', linesPaid === 0 && stillPaid.status === 'paid', '')

  // ---- Package engagements: unchanged (no invoice) -----------------------
  const B = await mkFam('package')
  // funding='package' requires an addon (check constraint) — minimal chain
  // via an existing class row.
  const { data: anyClass } = await db.from('classes').select('id').limit(1).single()
  const { data: enrB, error: enrBErr } = await db.from('enrollments').insert([{
    student_id: B.studentId, class_id: anyClass.id, payment_status: 'Paid',
  }]).select('id').single()
  if (enrBErr) throw new Error('enrollment fixture: ' + enrBErr.message)
  cleanup.enrollments.push(enrB.id)
  const { data: addonB, error: addonBErr } = await db.from('enrollment_addons').insert([{
    enrollment_id: enrB.id, hours: 10, price_paid: 0, source: 'cancellation_conversion',
  }]).select('id').single()
  if (addonBErr) throw new Error('addon fixture: ' + addonBErr.message)
  const { data: engB, error: engBErr } = await db.from('tutoring_engagements').insert([{
    student_id: B.studentId, tutor_id: tutor.id, subject_id: subject.id,
    hourly_rate: 90, funding: 'package', addon_id: addonB.id, recurrence, status: 'active',
    start_date: startDate,
  }]).select('id').single()
  if (engBErr) throw new Error('package engagement fixture: ' + engBErr.message)
  cleanup.engagements.push(engB.id)
  await tb.billMidMonthStart(engB.id)
  const { data: invB } = await db.from('tutoring_invoices').select('id').eq('family_id', B.familyId)
  check('9. package engagement: no remainder invoice (drawdown unchanged)', (invB ?? []).length === 0, '')

  // ---- The completion marker never moves ---------------------------------
  const marker1 = (await db.from('app_settings').select('value').eq('key', 'tutoring_generated_period').maybeSingle()).data?.value ?? null
  check('10. scoped runs never stamp the completion marker', marker1 === marker0, `${marker0} → ${marker1}`)
} finally {
  await destroy()
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done (fixtures removed)')
}
process.exit(failures ? 1 : 0)
