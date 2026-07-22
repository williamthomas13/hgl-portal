#!/usr/bin/env node
// PL-52 regression: register + add-on → abandon → resume → pay → the add-on
// SURVIVES. Runs against a local dev server + Stripe TEST mode; the "payment"
// is a synthetic checkout.session.completed event signed with the webhook
// secret — no card is ever entered. Self-cleaning: every QA row it creates is
// deleted at the end.
//
//   npm run dev   (in another terminal)
//   node scripts/regress-resume-addon.mjs
//
// Asserts:
//   1. checkout stamps pending_package_id + pending_checkout_total
//   2. the resumed session carries BOTH line items with the original total
//   3. after payment, the enrollment is Paid, the enrollment_addons row
//      exists with the right hours/price, and the pending marker is cleared

import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
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

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// --- arrange: an open class + an active pre-class package ------------------
const { data: cls } = await db
  .from('classes')
  .select('id, price, status, registration_close_date, start_date')
  .eq('status', 'open')
  .order('start_date', { ascending: false })
  .limit(1)
  .single()
const { data: pkg } = await db
  .from('tutoring_packages')
  .select('id, name, hours, package_price')
  .eq('phase', 'pre_class')
  .eq('active', true)
  .limit(1)
  .single()
if (!cls || !pkg) throw new Error('need an open class and an active pre-class package')
const expectedTotal = Number(cls.price) + Number(pkg.package_price)
console.log(`class ${cls.id} ($${cls.price}) + package "${pkg.name}" ($${pkg.package_price}) → expect $${expectedTotal}\n`)

// --- act 1: register -------------------------------------------------------
const reg = await fetch(`${BASE}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    classId: cls.id,
    parentFirst: 'QA-PL52-Parent', parentLast: 'Parent', parentEmail: 'qa-pl52@example.com',
    studentFirst: 'QA-PL52-Student', studentLast: 'Student',
  }),
})
const { enrollmentId, error: regError } = await reg.json()
if (!enrollmentId) throw new Error('register failed: ' + regError)

// --- act 2: build checkout WITH the add-on, then abandon -------------------
const co = await fetch(`${BASE}/api/checkout`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ enrollmentId, packageId: pkg.id }),
})
const coJson = await co.json()
check('checkout session created', co.ok && !!coJson.url)

const { data: afterCheckout } = await db
  .from('enrollments')
  .select('pending_package_id, pending_checkout_total')
  .eq('id', enrollmentId).single()
check('pending_package_id persisted', afterCheckout.pending_package_id === pkg.id)
check('pending_checkout_total persisted', Number(afterCheckout.pending_checkout_total) === expectedTotal,
  `$${afterCheckout.pending_checkout_total}`)

// (abandon: simply never open coJson.url)

// --- act 3: resume from the reminder link ----------------------------------
const resumeSig = createHmac('sha256', env.CRON_SECRET).update(`resume:${enrollmentId}`).digest('hex').slice(0, 32)
const resume = await fetch(`${BASE}/api/resume-payment?e=${enrollmentId}&t=${resumeSig}`, { redirect: 'manual' })
const location = resume.headers.get('location') ?? ''
const resumedSessionId = location.match(/cs_test_[A-Za-z0-9]+/)?.[0]
check('resume redirects to Stripe', resume.status === 303 && !!resumedSessionId, resumedSessionId ?? location.slice(0, 80))

// --- assert 2: the rebuilt cart --------------------------------------------
const items = await stripe.checkout.sessions.listLineItems(resumedSessionId, { limit: 10 })
const session = await stripe.checkout.sessions.retrieve(resumedSessionId)
check('resumed session has BOTH line items', items.data.length === 2,
  items.data.map((i) => `${i.description} $${(i.amount_total ?? 0) / 100}`).join(' + '))
check('resumed total matches the original cart', session.amount_total === Math.round(expectedTotal * 100),
  `$${(session.amount_total ?? 0) / 100}`)
check('resumed metadata carries package_id', session.metadata?.package_id === pkg.id)

// --- act 4: "pay" — synthetic signed webhook event -------------------------
const payload = JSON.stringify({
  id: 'evt_regress_pl52',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { ...session, payment_intent: 'pi_regress_pl52', payment_status: 'paid' } },
})
const header = stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET })
const hook = await fetch(`${BASE}/api/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'stripe-signature': header },
  body: payload,
})
check('webhook accepted', hook.ok)

// --- assert 3: paid + add-on recorded + pending cleared --------------------
const { data: paid } = await db
  .from('enrollments')
  .select('payment_status, amount_paid, pending_package_id, pending_checkout_total')
  .eq('id', enrollmentId).single()
check('enrollment is Paid', paid.payment_status === 'Paid')
check('amount_paid matches the full cart', Number(paid.amount_paid) === expectedTotal, `$${paid.amount_paid}`)
check('pending marker cleared', paid.pending_package_id === null && paid.pending_checkout_total === null)

const { data: addon } = await db
  .from('enrollment_addons')
  .select('hours, price_paid')
  .eq('enrollment_id', enrollmentId)
  .eq('package_id', pkg.id)
  .maybeSingle()
check('enrollment_addons row exists', !!addon)
check('addon hours/price correct', addon && Number(addon.hours) === Number(pkg.hours) && Number(addon.price_paid) === Number(pkg.package_price))

// --- cleanup ---------------------------------------------------------------
await new Promise((r) => setTimeout(r, 2500)) // let after() work (comms pass, QBO) settle
const { data: student } = await db.from('students').select('id, family_id').ilike('first_name', 'QA-PL52-Student').maybeSingle()
await db.from('email_sends').delete().eq('enrollment_id', enrollmentId)
await db.from('qbo_sync_log').delete().eq('enrollment_id', enrollmentId)
await db.from('enrollment_addons').delete().eq('enrollment_id', enrollmentId)
await db.from('enrollments').delete().eq('id', enrollmentId)
if (student) {
  await db.from('student_availability').delete().eq('student_id', student.id)
  await db.from('students').delete().eq('id', student.id)
  await db.from('families').delete().eq('id', student.family_id).eq('parent_email', 'qa-pl52@example.com')
}
await stripe.checkout.sessions.expire(resumedSessionId).catch(() => {})
console.log('\ncleaned up QA rows.')

process.exit(failures === 0 ? 0 : 1)
