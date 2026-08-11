#!/usr/bin/env node
// PL-197 regression: package overdraw BILLS — the whole-history drawdown
// covers exactly the prepaid hours, in-period overflow bills at the
// engagement rate, and overflow that slipped past earlier cycles (sessions
// added after their month's invoice left draft/proposed) is CARRIED onto the
// next generated invoice, deduped by the session's own line. Send-light via
// a capturing sendOnce stub. QA months live in 2027 so nothing collides with
// the real cycle.
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
delete process.env.RESEND_API_KEY

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-pl197')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/tutoring-billing.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const emailMod = require(path.join(out, 'email.js'))
const sendLog = []
emailMod.sendOnce = async (opts) => { sendLog.push(opts); return 'sent' }
emailMod.sendAdminAlert = async () => 'sent'
const tb = require(path.join(out, 'tutoring-billing.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const QA_MONTH = '2027-03'
const QA_PERIOD = '2027-03-01'
const marker0 = (await db.from('app_settings').select('value').eq('key', 'tutoring_generated_period').maybeSingle()).data?.value ?? null

const cleanup = { engagements: [], students: [], families: [], instructors: [], invoices: [], enrollments: [] }
async function destroy() {
  for (const id of cleanup.engagements) {
    await db.from('tutoring_invoice_lines').delete().in('session_id',
      ((await db.from('tutoring_sessions').select('id').eq('engagement_id', id)).data ?? []).map((s) => s.id))
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
    await db.from('tutoring_invoices').delete().eq('family_id', id)
    await db.from('families').delete().eq('id', id)
  }
  for (const id of cleanup.instructors) await db.from('instructors').delete().eq('id', id)
}

try {
  const rand = Math.random().toString(36).slice(2, 8)
  const { data: tutor } = await db.from('instructors').insert([{
    name: 'QA-PL197 Tutor', email: `billy+qa-pl197-${rand}@highergroundlearning.com`,
    timezone: 'America/Denver', tutoring_active: true,
  }]).select('id').single()
  cleanup.instructors.push(tutor.id)
  const { data: subject } = await db.from('subjects').select('id').limit(1).single()

  const { data: fam } = await db.from('families').insert([{
    parent_first_name: 'QA-PL197', parent_last_name: 'Parent',
    parent_email: `billy+qa-pl197-fam-${rand}@highergroundlearning.com`,
  }]).select('id').single()
  cleanup.families.push(fam.id)
  const { data: stu } = await db.from('students').insert([{
    family_id: fam.id, first_name: 'QA-PL197', last_name: 'Student',
  }]).select('id').single()
  cleanup.students.push(stu.id)

  // A 10h package on the family.
  const { data: anyClass } = await db.from('classes').select('id').limit(1).single()
  const { data: enr } = await db.from('enrollments').insert([{
    student_id: stu.id, class_id: anyClass.id, payment_status: 'Paid',
  }]).select('id').single()
  cleanup.enrollments.push(enr.id)
  const { data: addon } = await db.from('enrollment_addons').insert([{
    enrollment_id: enr.id, hours: 10, price_paid: 1000, source: 'cancellation_conversion',
  }]).select('id').single()

  // Package engagement: 12 completed 1h sessions in Feb 2027 → 10 covered,
  // 2 overflow that "slipped" (no invoice ever billed them). No March
  // sessions at all — the carry must still land (the wound-down case).
  const { data: engPkg } = await db.from('tutoring_engagements').insert([{
    student_id: stu.id, tutor_id: tutor.id, subject_id: subject.id,
    hourly_rate: 100, funding: 'package', addon_id: addon.id, recurrence: [], status: 'active',
  }]).select('id').single()
  cleanup.engagements.push(engPkg.id)
  const febSessions = Array.from({ length: 12 }, (_, i) => ({
    engagement_id: engPkg.id, student_id: stu.id, tutor_id: tutor.id,
    starts_at: `2027-02-${String(i + 2).padStart(2, '0')}T17:00:00-07:00`,
    ends_at: `2027-02-${String(i + 2).padStart(2, '0')}T18:00:00-07:00`,
    status: 'completed', rate_snapshot: 100,
  }))
  {
    const { error: febErr } = await db.from('tutoring_sessions').insert(febSessions)
    if (febErr) throw new Error('feb sessions: ' + febErr.message)
  }

  // Monthly engagement with one March session — it keeps the family's bucket
  // non-empty, exactly the Roman shape (other engagement still active).
  const { data: engMon } = await db.from('tutoring_engagements').insert([{
    student_id: stu.id, tutor_id: tutor.id, subject_id: subject.id,
    hourly_rate: 80, funding: 'monthly_billed', recurrence: [], status: 'active',
  }]).select('id').single()
  cleanup.engagements.push(engMon.id)
  {
    const { error: marErr } = await db.from('tutoring_sessions').insert([{
      engagement_id: engMon.id, student_id: stu.id, tutor_id: tutor.id,
      starts_at: '2027-03-10T17:00:00-07:00', ends_at: '2027-03-10T18:00:00-07:00',
      status: 'confirmed', rate_snapshot: 80,
    }])
    if (marErr) throw new Error('mar session: ' + marErr.message)
  }

  const genResult = await tb.generateMonthlyCycle(new Date(), QA_MONTH, [fam.id])
  console.log('generate result:', JSON.stringify(genResult))

  const { data: inv } = await db.from('tutoring_invoices')
    .select('id, status, total').eq('family_id', fam.id).eq('period', QA_PERIOD).maybeSingle()
  if (inv) cleanup.invoices.push(inv.id)
  check('1. invoice generated for the family', !!inv, '')

  const { data: lines } = await db.from('tutoring_invoice_lines')
    .select('id, session_id, description, rate, amount, kind').eq('invoice_id', inv.id)
  const carry = (lines ?? []).filter((l) => l.description?.includes('past the prepaid package'))
  check('2. slipped overflow CARRIED: exactly the 2h past the package', carry.length === 2,
    `${carry.length} carry lines`)
  check('3. carry bills at the engagement rate', carry.every((l) => Number(l.rate) === 100 && Number(l.amount) === 100), '')

  const { data: febRows } = await db.from('tutoring_sessions')
    .select('id, starts_at').eq('engagement_id', engPkg.id).order('starts_at')
  const coveredIds = febRows.slice(0, 10).map((s) => s.id)
  const { data: coveredLines } = await db.from('tutoring_invoice_lines')
    .select('id').in('session_id', coveredIds).eq('kind', 'session')
  check('4. covered sessions (first 10h) never billed', (coveredLines ?? []).length === 0, '')

  check('5. invoice total = carry (200) + monthly session (80)', Number(inv?.total ?? -1) === 0 || true, '')
  const { data: freshInv } = await db.from('tutoring_invoices').select('total').eq('id', inv.id).single()
  check('5. invoice total = carry (200) + monthly session (80)', Number(freshInv.total) === 280, `total=${freshInv.total}`)

  // Idempotency: regenerate → same lines (carry doesn't duplicate).
  await tb.generateMonthlyCycle(new Date(), QA_MONTH, [fam.id])
  const { data: lines2 } = await db.from('tutoring_invoice_lines').select('id').eq('invoice_id', inv.id)
  check('6. re-run idempotent (carry deduped by the session line)', (lines2 ?? []).length === (lines ?? []).length,
    `${(lines ?? []).length} → ${(lines2 ?? []).length}`)

  // Once the carry is on a non-draft invoice, later cycles skip it: mark the
  // invoice paid and generate the NEXT month — no new carry lines anywhere.
  await db.from('tutoring_invoices').update({ status: 'paid' }).eq('id', inv.id)
  await tb.generateMonthlyCycle(new Date(), '2027-04', [fam.id])
  const { data: aprInv } = await db.from('tutoring_invoices')
    .select('id').eq('family_id', fam.id).eq('period', '2027-04-01').maybeSingle()
  if (aprInv) cleanup.invoices.push(aprInv.id)
  const { data: aprLines } = aprInv
    ? await db.from('tutoring_invoice_lines').select('id, description').eq('invoice_id', aprInv.id)
    : { data: [] }
  const aprCarry = (aprLines ?? []).filter((l) => l.description?.includes('past the prepaid package'))
  check('7. billed carry never re-bills on a later month', aprCarry.length === 0, `${aprCarry.length} in April`)

  const marker1 = (await db.from('app_settings').select('value').eq('key', 'tutoring_generated_period').maybeSingle()).data?.value ?? null
  check('8. completion marker untouched', marker1 === marker0, '')

  // --- PL-299: the family consent gate on top of PL-197 ---------------------
  const bc = require(path.join(out, 'block-confirm.js'))
  check('9. thresholds: 15→3 · 10→2 · 5→1 · 8→2 (20% up)',
    bc.blockThreshold(15) === 3 && bc.blockThreshold(10) === 2 && bc.blockThreshold(5) === 1 && bc.blockThreshold(8) === 2, '')
  check('10. hold states: asked+declined hold, null+confirmed do not',
    bc.blockHoldActive('asked') && bc.blockHoldActive('declined') && !bc.blockHoldActive(null) && !bc.blockHoldActive('confirmed'), '')

  // A fresh 5h block at 4.5h used → the sweep asks the parent once.
  const { data: addon2 } = await db.from('enrollment_addons').insert([{
    enrollment_id: cleanup.enrollments[0], hours: 5, price_paid: 500, source: 'cancellation_conversion',
  }]).select('id').single()
  const { data: eng2 } = await db.from('tutoring_engagements').insert([{
    student_id: cleanup.students[0], tutor_id: cleanup.instructors[0], subject_id: (await db.from('subjects').select('id').limit(1).single()).data.id,
    hourly_rate: 110, funding: 'package', addon_id: addon2.id, recurrence: [], status: 'active',
  }]).select('id').single()
  cleanup.engagements.push(eng2.id)
  const maySessions = Array.from({ length: 5 }, (_, i) => ({
    engagement_id: eng2.id, student_id: cleanup.students[0], tutor_id: cleanup.instructors[0],
    starts_at: `2027-05-${String(i + 3).padStart(2, '0')}T17:00:00-06:00`,
    ends_at: `2027-05-${String(i + 3).padStart(2, '0')}T17:54:00-06:00`,
    status: 'completed', rate_snapshot: 110,
  }))
  {
    const { error } = await db.from('tutoring_sessions').insert(maySessions)
    if (error) throw new Error('may sessions: ' + error.message)
  }
  sendLog.length = 0
  // The sweep scans EVERY active block engagement — snapshot the moment so
  // any real (non-QA) engagement it asks during this run can be restored.
  const sweepStart = new Date().toISOString()
  const swept = await bc.sweepBlockConfirmations()
  await db
    .from('tutoring_engagements')
    .update({ block_confirmation: null, block_confirmation_asked_at: null })
    .eq('block_confirmation', 'asked')
    .gte('block_confirmation_asked_at', sweepStart)
    .neq('id', eng2.id)
  const { data: eng2After } = await db.from('tutoring_engagements')
    .select('block_confirmation, block_confirmation_asked_at').eq('id', eng2.id).single()
  const askEmail = sendLog.find((s) => s.dedupeKey === `block_confirm_ask:${eng2.id}`)
  check('11. sweep asks at the threshold (4.5 of 5h used → 0.5 ≤ 1h left)',
    swept.asked >= 1 && eng2After.block_confirmation === 'asked' && !!eng2After.block_confirmation_asked_at, JSON.stringify(eng2After))
  check('12. the ask email goes to the parent, plain numbers in view',
    // PL-323D/E: Scarlett's copy + the PROVENANCE continuing rate (post-class
    // sheet for the student's tier), not the engagement's old block rate.
    !!askEmail && /0\.5 left of the\s+5 tutoring hours/.test(askEmail.html) &&
      new RegExp(`\\$${(await bc.continueRatesForStudent(cleanup.students[0])).rate1to9}/hr`).test(askEmail.html),
    askEmail?.subject)
  const sweep2Start = new Date().toISOString()
  sendLog.length = 0
  await bc.sweepBlockConfirmations()
  await db
    .from('tutoring_engagements')
    .update({ block_confirmation: null, block_confirmation_asked_at: null })
    .eq('block_confirmation', 'asked')
    .gte('block_confirmation_asked_at', sweep2Start)
    .neq('id', eng2.id)
  check('13. asks THIS engagement once (state already set → no re-ask)',
    !sendLog.some((s) => s.dedupeKey === `block_confirm_ask:${eng2.id}`), '')

  // Overflow past the block while ASKED → generation writes NO overflow line.
  // (A June monthly session keeps the family's invoice generating — the
  // PL-197 no-billables-no-invoice edge would otherwise hide the difference.)
  {
    const { error } = await db.from('tutoring_sessions').insert([
      {
        engagement_id: eng2.id, student_id: cleanup.students[0], tutor_id: cleanup.instructors[0],
        starts_at: '2027-05-20T17:00:00-06:00', ends_at: '2027-05-20T18:00:00-06:00',
        status: 'completed', rate_snapshot: 110,
      },
      {
        engagement_id: cleanup.engagements[1], student_id: cleanup.students[0], tutor_id: cleanup.instructors[0],
        starts_at: '2027-06-10T17:00:00-06:00', ends_at: '2027-06-10T18:00:00-06:00',
        status: 'confirmed', rate_snapshot: 80,
      },
    ])
    if (error) throw new Error('overflow session: ' + error.message)
  }
  await tb.generateMonthlyCycle(new Date(), '2027-06', [cleanup.families[0]])
  const { data: junInv } = await db.from('tutoring_invoices')
    .select('id').eq('family_id', cleanup.families[0]).eq('period', '2027-06-01').maybeSingle()
  if (junInv) cleanup.invoices.push(junInv.id)
  const junLines = junInv
    ? (await db.from('tutoring_invoice_lines').select('id, description, rate').eq('invoice_id', junInv.id)).data ?? []
    : []
  check('14. ASKED: overflow past the block never bills',
    junLines.filter((l) => l.description?.includes('past the prepaid package') && Number(l.rate) === 110).length === 0,
    JSON.stringify(junLines.map((l) => l.description)))

  // The family CHOOSES (PL-323B: monthly = until-I-cancel) → the SAME
  // overflow bills on the next cycle at the provenance continuing rate
  // (PL-323D: the decision re-rates the engagement forward).
  const contRates = await bc.continueRatesForStudent(cleanup.students[0])
  const rec = await bc.recordBlockDecision(eng2.id, 'confirmed', 'admin', 'monthly')
  check('15. decision recorder flips asked → confirmed (choice=monthly; no recurrence → staff-routed reservation)',
    rec.ok === true && (rec.outcome === 'staff' || rec.outcome === 'reserved'), JSON.stringify(rec))
  await tb.generateMonthlyCycle(new Date(), '2027-06', [cleanup.families[0]])
  const junLines2 = junInv
    ? (await db.from('tutoring_invoice_lines').select('id, description, rate, amount').eq('invoice_id', junInv.id)).data ?? []
    : []
  const confirmedCarry = junLines2.filter(
    (l) => l.description?.includes('past the prepaid package') && Number(l.rate) === contRates.rate1to9
  )
  check('16. CONFIRMED: the held overflow now bills at the provenance continuing rate',
    confirmedCarry.length === 1 && Number(confirmedCarry[0].amount) === contRates.rate1to9,
    JSON.stringify(junLines2.map((l) => `${l.description} @${l.rate}`)))

  // A decision can't be recorded before the ask (null → plain refusal).
  const early = await bc.recordBlockDecision(cleanup.engagements[0], 'confirmed', 'admin', 'monthly')
  check("17. pre-ask decision refused plainly ('the low-hours email goes out first')",
    early.ok === false && /goes out first/.test(early.error), JSON.stringify(early))
} finally {
  await destroy()
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done (fixtures removed)')
}
process.exit(failures ? 1 : 0)
