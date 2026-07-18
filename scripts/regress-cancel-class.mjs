#!/usr/bin/env node
// PL-55 regression: cancelling a class with a populated email schedule must be
// ONE atomic outcome — status cancelled, CX composed and attempted, and ZERO
// scheduled/held sends left for the class (the Nido bug: 9 rows survived with
// #4 due the next morning).
//
//   npm run dev   (in another terminal)
//   node scripts/regress-cancel-class.mjs
//
// Builds a throwaway QA class + a PAID enrollment (payment is a synthetic
// signed webhook — no card is ever entered; test-mode-guarded), which gives
// the class a real materialized schedule (PR rows at registration, sequence
// rows at payment), then cancels it as a signed-in admin and asserts. Fully
// self-cleaning.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
if (!env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  throw new Error('Refusing to run: STRIPE_SECRET_KEY is not a test-mode key.')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = new Stripe(env.STRIPE_SECRET_KEY)
const ref = env.NEXT_PUBLIC_SUPABASE_URL.replace('https://', '').split('.')[0]

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// --- staff session cookie (admin magic link → session → @supabase/ssr cookie)
async function staffCookie() {
  const { data: profiles } = await db.from('profiles').select('id').eq('role', 'admin')
  const { data: users } = await db.auth.admin.listUsers()
  const admin = users.users.find((u) => profiles.some((p) => p.id === u.id))
  if (!admin) throw new Error('no admin user found')
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: admin.email })
  if (error) throw error
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const { data: verified, error: vErr } = await anon.auth.verifyOtp({
    type: 'email',
    token_hash: link.properties.hashed_token,
  })
  if (vErr || !verified.session) throw vErr ?? new Error('no session from verifyOtp')
  const encoded = 'base64-' + Buffer.from(JSON.stringify(verified.session)).toString('base64url')
  // @supabase/ssr chunks long cookies at ~3180 chars: name.0, name.1, …
  const name = `sb-${ref}-auth-token`
  const CHUNK = 3180
  if (encoded.length <= CHUNK) return `${name}=${encoded}`
  const parts = []
  for (let i = 0; i * CHUNK < encoded.length; i++) {
    parts.push(`${name}.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`)
  }
  return parts.join('; ')
}

// --- arrange: throwaway class with sessions ---------------------------------
const { data: school } = await db.from('schools').select('id, nickname').limit(1).single()
const { data: cls, error: clsErr } = await db
  .from('classes')
  .insert([{
    school_id: school.id,
    class_type: 'SAT Prep',
    status: 'open',
    price: 500,
    capacity: 10,
    start_date: '2026-09-01',
  }])
  .select('id')
  .single()
if (clsErr) throw clsErr
await db.from('sessions').insert([
  { class_id: cls.id, session_date: '2026-09-01', start_time: '16:00', end_time: '18:00' },
  { class_id: cls.id, session_date: '2026-09-08', start_time: '16:00', end_time: '18:00' },
])
console.log(`QA class ${cls.id} (${school.nickname} SAT Prep) created\n`)

let enrollmentId = null
let sessionId = null
try {
  // --- act 1: register + pay (synthetic signed webhook) ---------------------
  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      classId: cls.id,
      parentFirst: 'QA-PL55', parentLast: 'Parent',
      parentEmail: 'billy+pl55qa@highergroundlearning.com',
      studentFirst: 'QA-PL55', studentLast: 'Student',
    }),
  })
  ;({ enrollmentId } = await reg.json())
  check('registered', !!enrollmentId)

  const co = await fetch(`${BASE}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId }),
  })
  check('checkout created', co.ok)
  const { data: enr } = await db.from('enrollments').select('stripe_session_id').eq('id', enrollmentId).single()
  sessionId = enr.stripe_session_id
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const payload = JSON.stringify({
    id: 'evt_regress_pl55', object: 'event', type: 'checkout.session.completed',
    data: { object: { ...session, payment_intent: 'pi_regress_pl55', payment_status: 'paid' } },
  })
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET })
  const hook = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': header },
    body: payload,
  })
  check('paid via signed webhook', hook.ok)
  await new Promise((r) => setTimeout(r, 3000)) // let the PL-51 inline pass materialize

  const { count: before } = await db
    .from('email_sends')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', cls.id)
    .in('status', ['scheduled', 'held'])
  check('schedule is populated before cancelling', (before ?? 0) > 0, `${before} scheduled rows`)

  // PL-54a: a waitlisted family must join the interest list at cancellation.
  const { data: wlFam } = await db
    .from('families')
    .insert([{ parent_first_name: 'QA-PL54', parent_last_name: 'Waitlister', parent_email: 'billy+pl54wl@highergroundlearning.com' }])
    .select('id').single()
  const { data: wlStudent } = await db
    .from('students')
    .insert([{ family_id: wlFam.id, first_name: 'QA-PL54', last_name: 'Student' }])
    .select('id').single()
  await db.from('enrollments').insert([{ student_id: wlStudent.id, class_id: cls.id, payment_status: 'Waitlisted' }])

  // --- act 2: cancel as a signed-in admin -----------------------------------
  const cookie = await staffCookie()
  const cancel = await fetch(`${BASE}/api/admin/cancel-class`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ classId: cls.id, offerHours: 8, creditTerm: null }),
  })
  const cancelJson = await cancel.json()
  check('cancel route succeeded', cancel.ok, JSON.stringify(cancelJson))

  // --- assert: one atomic outcome -------------------------------------------
  const { data: after } = await db.from('classes').select('status').eq('id', cls.id).single()
  check('class status is cancelled', after.status === 'cancelled')
  const { count: leftover } = await db
    .from('email_sends')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', cls.id)
    .in('status', ['scheduled', 'held'])
  check('ZERO scheduled/held sends remain', (leftover ?? 0) === 0, `${leftover} left`)
  const { data: cx } = await db
    .from('email_sends')
    .select('status')
    .eq('enrollment_id', enrollmentId)
    .in('template_key', ['CX_FAMILY', 'CLASS_CANCELLED'])
  check('CX composed and attempted', (cx ?? []).length > 0, (cx ?? []).map((r) => r.status).join(','))
  check('route reported the bulk-cancel', typeof cancelJson.sendsCancelled === 'number' && cancelJson.sendsCancelled > 0,
    `sendsCancelled=${cancelJson.sendsCancelled}`)
  // PL-54a: waitlisted family landed on the interest list, CX-W attempted.
  const { data: interest } = await db
    .from('class_interest')
    .select('source, notified_at')
    .eq('email', 'billy+pl54wl@highergroundlearning.com')
    .eq('school_id', school.id)
    .eq('class_type', 'SAT Prep')
  check('waitlisted family joined the interest list', (interest ?? []).length === 1 && interest[0].source === 'cancellation')
  check('CX-W attempted', cancelJson.emails?.cxw === 1, `cxw=${cancelJson.emails?.cxw}`)
} finally {
  // --- cleanup ---------------------------------------------------------------
  await new Promise((r) => setTimeout(r, 1500))
  const { data: student } = await db.from('students').select('id, family_id').ilike('first_name', 'QA-PL55').maybeSingle()
  // PL-54 fixtures
  await db.from('class_interest').delete().ilike('email', 'billy+pl54wl@%')
  const { data: wlSt } = await db.from('students').select('id, family_id').ilike('first_name', 'QA-PL54').maybeSingle()
  if (wlSt) {
    await db.from('enrollments').delete().eq('student_id', wlSt.id)
    await db.from('students').delete().eq('id', wlSt.id)
    await db.from('families').delete().eq('id', wlSt.family_id).ilike('parent_email', 'billy+pl54wl@%')
  }
  if (enrollmentId) {
    await db.from('email_sends').delete().eq('enrollment_id', enrollmentId)
    await db.from('qbo_sync_log').delete().eq('enrollment_id', enrollmentId)
    await db.from('enrollments').delete().eq('id', enrollmentId)
  }
  await db.from('email_sends').delete().eq('class_id', cls.id)
  await db.from('sessions').delete().eq('class_id', cls.id)
  await db.from('classroom_requests').delete().eq('class_id', cls.id)
  await db.from('classes').delete().eq('id', cls.id)
  if (student) {
    await db.from('students').delete().eq('id', student.id)
    await db.from('families').delete().eq('id', student.family_id).ilike('parent_email', 'billy+pl55qa@%')
  }
  if (sessionId) await stripe.checkout.sessions.expire(sessionId).catch(() => {})
  console.log('\ncleaned up QA rows.')
}

process.exit(failures === 0 ? 0 : 1)
