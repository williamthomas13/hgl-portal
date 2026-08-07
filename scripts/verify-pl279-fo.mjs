#!/usr/bin/env node
// PL-279 verification, on the real machinery (send-light: RESEND_API_KEY is
// deleted in-process, so sendOnce refuses before anything could deliver):
//   1. cohort math (pure)
//   2. DRAFT templates → the sweep renders nothing (the sign-off gate)
//   3. LIVE (flipped for the test, flipped back after; prod still runs
//      pre-FO code so nothing can send meanwhile) → announce pair renders
//      with the cohort's own {endDate}, code, tokenized link
//   4. suppression — a family with a live registration in the follow-on
//      class gets nothing, at every stage
//   5. extension — fo_extended_until arms stage 3
//   6. the discount seam — token path + typed-code path + expiry + wrong
//      code + stranger email, all per-cohort
// Fixtures are QA-named and fully deleted at the end.
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
delete process.env.RESEND_API_KEY // send-light — nothing can actually deliver

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl279')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/follow-on.ts app/utils/lifecycle.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const fo = require(path.join(out, 'follow-on.js'))
const shared = require(path.join(out, 'follow-on-shared.js'))
const lifecycle = require(path.join(out, 'lifecycle.js'))
const { renderDbEmail, clearTemplateCache } = require(path.join(out, 'comms-db-render.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`) }
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// --- 1. cohort math (PL-295 shape: announce +2, discount 7 days) ------------
{
  const w = shared.cohortWindow({ lastSession: '2026-10-24', foExtendedUntil: null })
  check('math: announce = last session + 2 (off the E-series)', w.announceDate === '2026-10-26')
  check('math: discount end = announce + 7', w.baseDeadline === '2026-11-02')
  check('math: reminder = discount end − 2', w.reminderDate === '2026-10-31')
  check('math: not extended by default', w.deadline === '2026-11-02' && !w.extended)
  const we = shared.cohortWindow({ lastSession: '2026-10-24', foExtendedUntil: '2026-11-09' })
  check('math: extension wins', we.deadline === '2026-11-09' && we.extended)
  check('math: extension target = deadline + 7 (future window)', shared.extensionTarget(w, '2026-10-28') === '2026-11-09')
  check('math: extension from today when long gone', shared.extensionTarget(w, '2026-12-01') === '2026-12-08')
  // PL-295C overrides + the registration-deadline clamp.
  const early = shared.cohortWindow({ lastSession: '2026-10-24', foExtendedUntil: null, foAnnounceDate: '2026-10-10' })
  check('math: announce override (early start, mid-class)', early.announceDate === '2026-10-10' && early.baseDeadline === '2026-10-17' && early.announceOverridden)
  const clamped = shared.cohortWindow({
    lastSession: '2026-10-24',
    foExtendedUntil: null,
    targetRegistrationDeadline: '2026-10-30',
  })
  check('math: discount end clamps to the FO registration deadline', clamped.baseDeadline === '2026-10-30' && clamped.clampedToRegistrationDeadline)
  const manualEnd = shared.cohortWindow({ lastSession: '2026-10-24', foExtendedUntil: null, foDiscountEnd: '2026-10-29' })
  check('math: manual discount end honored', manualEnd.baseDeadline === '2026-10-29' && manualEnd.discountEndOverridden)
}

// --- fixtures ---------------------------------------------------------------
const FO_KEYS = ['FO_ANNOUNCE_PARENT', 'FO_ANNOUNCE_STUDENT', 'FO_REMINDER_PARENT', 'FO_REMINDER_STUDENT', 'FO_EXTENSION_PARENT', 'FO_EXTENSION_STUDENT']
const { data: target, error: tErr } = await db.from('classes').insert([{
  class_type: 'QA FO Deep Dive (PL-279)', school_id: null, price: 500, capacity: 20,
  min_enrollment: 3, delivery_mode: 'online', start_date: addDays(today, 40),
  slug: 'qa-pl279-fo-target', status: 'open', timezone: 'America/Denver',
  promo_code: 'QADEEP50', promo_amount: 50, fo_short_name: 'QA Deep Dive',
}]).select('id').single()
if (tErr) { console.error('target insert failed:', tErr.message); process.exit(1) }
const { data: feeder, error: fErr } = await db.from('classes').insert([{
  class_type: 'QA FO Feeder (PL-279)', school_id: null, price: 450, capacity: 20,
  min_enrollment: 3, delivery_mode: 'online', start_date: addDays(today, -30),
  slug: 'qa-pl279-fo-feeder', status: 'open', timezone: 'America/Denver',
  follow_on_class_id: target.id,
}]).select('id').single()
if (fErr) { console.error('feeder insert failed:', fErr.message); process.exit(1) }
// PL-295 shape: last session 3 days ago → announce = today−1 (due
// regardless of the hour), discount end = today+6 (window open).
await db.from('sessions').insert([
  { class_id: feeder.id, session_date: addDays(today, -10), start_time: '16:00', end_time: '18:00' },
  { class_id: feeder.id, session_date: addDays(today, -3), start_time: '16:00', end_time: '18:00' },
])
const { data: fam } = await db.from('families').insert([{
  parent_first_name: 'QAP', parent_last_name: 'PL279', parent_email: 'qa-pl279-parent@example.com',
}]).select('id').single()
const { data: stu } = await db.from('students').insert([{
  family_id: fam.id, first_name: 'QAS', last_name: 'PL279', student_email: 'qa-pl279-student@example.com',
}]).select('id').single()
const { data: enr } = await db.from('enrollments').insert([{
  class_id: feeder.id, student_id: stu.id, payment_status: 'Completed',
  enrolled_at: new Date().toISOString(), paid_at: new Date().toISOString(),
}]).select('id').single()

const cleanup = async () => {
  await db.from('email_templates').update({ live: false }).in('template_key', FO_KEYS)
  await db.from('email_sends').delete().eq('class_id', feeder.id)
  await db.from('enrollments').delete().eq('class_id', feeder.id)
  await db.from('enrollments').delete().eq('class_id', target.id)
  await db.from('sessions').delete().eq('class_id', feeder.id)
  await db.from('classes').delete().in('id', [feeder.id, target.id])
  await db.from('students').delete().eq('id', stu.id)
  await db.from('families').delete().eq('id', fam.id)
}

try {
  const loadBundle = async () => (await lifecycle.loadClassBundles(feeder.id))[0]

  // --- 2. drafts render nothing (the sign-off gate) -------------------------
  let bundle = await loadBundle()
  check('fixture: bundle carries follow-on link', bundle.followOnClassId === target.id)
  let report = await fo.sweepFollowOnForBundle(bundle)
  check('drafts: sweep ran (stage due) but rendered nothing', report.ran && report.attempts.length === 0, JSON.stringify(report))

  // --- 3. live → announce pair renders with cohort values -------------------
  await db.from('email_templates').update({ live: true }).in('template_key', FO_KEYS)
  clearTemplateCache()
  report = await fo.sweepFollowOnForBundle(bundle)
  const parent = report.attempts.find((a) => a.stage === 'announce' && a.audience === 'parent')
  const student = report.attempts.find((a) => a.stage === 'announce' && a.audience === 'student')
  check('live: announce parent attempted', Boolean(parent), JSON.stringify(report))
  check('live: announce student attempted', Boolean(student))
  check('live: only the announce stage (reminder/extension not due)', report.attempts.every((a) => a.stage === 'announce'))
  check('live: send-light refused delivery', report.attempts.every((a) => a.status === 'failed'))
  check('live: parent subject is Scarlett\'s', parent?.subject === 'SAT Advanced Math opportunity for Higher Ground Learning students', parent?.subject)

  // Body assertions through the same render the sweep used.
  const w = shared.cohortWindow({ lastSession: bundle.lastSession, foExtendedUntil: null })
  const ctx = lifecycle.emailContext(bundle, bundle.enrollments[0])
  ctx.followOn = fo.followOnOfferFor(await fo.loadFollowOnTarget(target.id), w, enr.id)
  const rendered = await renderDbEmail('FO_ANNOUNCE_PARENT', ctx, 'parent', {})
  check('live: body carries the cohort endDate', rendered?.html.includes(shared.foLongDate(w.deadline)), shared.foLongDate(w.deadline))
  check('live: body carries the code', rendered?.html.includes('QADEEP50'))
  check('live: body carries the short name', rendered?.html.includes('QA Deep Dive'))
  check('live: body carries the tokenized link', /register\/qa-pl279-fo-target\?fo=/.test(rendered?.html ?? ''))
  const leftover = rendered?.html.match(/\{[a-zA-Z_]+\}/g)
  check('live: no unresolved variables', !leftover, String(leftover))

  // --- 4. suppression once registered ---------------------------------------
  const { data: reg } = await db.from('enrollments').insert([{
    class_id: target.id, student_id: stu.id, payment_status: 'Pending', enrolled_at: new Date().toISOString(),
  }]).select('id').single()
  report = await fo.sweepFollowOnForBundle(await loadBundle())
  check('suppression: registered family is skipped', report.attempts.length === 0 && report.suppressed.includes(enr.id), JSON.stringify(report))
  await db.from('enrollments').delete().eq('id', reg.id)

  // --- 5. extension arms stage 3 --------------------------------------------
  await db.from('classes').update({ fo_extended_until: addDays(today, 20) }).eq('id', feeder.id)
  report = await fo.sweepFollowOnForBundle(await loadBundle())
  check('extension: stage 3 attempted once extended', report.attempts.some((a) => a.stage === 'extension'), JSON.stringify(report.attempts.map((a) => a.stage)))
  const extCtxWindow = shared.cohortWindow({ lastSession: bundle.lastSession, foExtendedUntil: addDays(today, 20) })
  check('extension: effective deadline moved', extCtxWindow.deadline === addDays(today, 20) && extCtxWindow.extended)
  await db.from('classes').update({ fo_extended_until: null }).eq('id', feeder.id)

  // --- 6. the discount seam --------------------------------------------------
  const link = new URL(ctx.followOn.registrationLink)
  const token = link.searchParams.get('fo')
  const fe = link.searchParams.get('fe')
  let v = await fo.validateFollowOnDiscount({ classId: target.id, token, feederEnrollmentId: fe })
  check('seam: token path validates', v.ok && v.amount === 50 && v.code === 'QADEEP50', JSON.stringify(v))
  check('seam: token path endDate = cohort deadline', v.ok && v.endDateIso === w.deadline)
  v = await fo.validateFollowOnDiscount({ classId: target.id, token: 'garbage', feederEnrollmentId: fe })
  check('seam: forged token refused', !v.ok)
  v = await fo.validateFollowOnDiscount({ classId: target.id, code: 'qadeep50', parentEmail: 'QA-PL279-PARENT@example.com' })
  check('seam: typed code validates (case-insensitive both sides)', v.ok && v.amount === 50, JSON.stringify(v))
  v = await fo.validateFollowOnDiscount({ classId: target.id, code: 'WRONG', parentEmail: 'qa-pl279-parent@example.com' })
  check('seam: wrong code refused with spelling hint', !v.ok && /doesn't match/.test(v.reason), v.reason)
  v = await fo.validateFollowOnDiscount({ classId: target.id, code: 'QADEEP50', parentEmail: 'stranger@example.com' })
  check('seam: stranger email refused', !v.ok && /partner classes/.test(v.reason), v.reason)
  // Expire the cohort: move the last session far into the past.
  await db.from('sessions').update({ session_date: addDays(today, -40) }).eq('class_id', feeder.id)
  v = await fo.validateFollowOnDiscount({ classId: target.id, code: 'QADEEP50', parentEmail: 'qa-pl279-parent@example.com' })
  check('seam: expired cohort refused, registration still invited', !v.ok && /ended/.test(v.reason), v.reason)
} finally {
  await cleanup()
}

const { data: leftoverCls } = await db.from('classes').select('id').in('slug', ['qa-pl279-fo-target', 'qa-pl279-fo-feeder'])
check('cleanup: fixtures gone, templates back to draft', (leftoverCls ?? []).length === 0)
const { data: tpls } = await db.from('email_templates').select('template_key, live').in('template_key', FO_KEYS)
check('cleanup: all six FO templates are drafts', (tpls ?? []).every((t) => !t.live))

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
