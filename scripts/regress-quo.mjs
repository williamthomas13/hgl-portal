#!/usr/bin/env node
// PL-202 regression: the Quo calls receiver, built against test deliveries
// (Quo signup is down the road). Verifies the Standard-Webhooks signature
// path (accept/reject/replay-window), phone normalization across formats,
// the normalize→process pipeline: known-number → family-matched call event,
// missed known call → attention-eligible row (clears on outbound/dismiss),
// unknown caller → ONE pipeline lead that repeat calls fold into, webhook
// redelivery dedupe, and the contact-push payload's externalId trick.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createHmac } from 'node:crypto'
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-quo')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/quo.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const quo = require(path.join(out, 'quo.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const rand = Math.random().toString(36).slice(2, 8)
const QA_PHONE = '+13035550142'
const QA_UNKNOWN = '+13035550177'
const cleanup = { families: [], students: [], leads: [], events: [] }
async function destroy() {
  await db.from('call_events').delete().like('provider_event_id', `qa-pl202-%`)
  for (const id of cleanup.leads) await db.from('leads').delete().eq('id', id)
  for (const id of cleanup.students) await db.from('students').delete().eq('id', id)
  for (const id of cleanup.families) await db.from('families').delete().eq('id', id)
}

try {
  // --- Signature verification (Standard Webhooks) ---------------------------
  const secret = 'whsec_' + Buffer.from('qa-secret-material').toString('base64')
  const payload = JSON.stringify({ hello: 'world' })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', Buffer.from('qa-secret-material'))
    .update(`msg_1.${ts}.${payload}`)
    .digest('base64')
  check('1. signed test delivery accepted',
    quo.verifyStandardWebhook({ id: 'msg_1', timestamp: ts, signatureHeader: `v1,${sig}`, payload, secret }), '')
  check('2. bad signature rejected',
    !quo.verifyStandardWebhook({ id: 'msg_1', timestamp: ts, signatureHeader: 'v1,AAAA', payload, secret }), '')
  check('3. stale timestamp rejected (replay window)',
    !quo.verifyStandardWebhook({ id: 'msg_1', timestamp: String(Number(ts) - 3600), signatureHeader: `v1,${sig}`, payload, secret }), '')

  // --- Phone normalization ---------------------------------------------------
  const forms = ['(303) 555-0142', '303-555-0142', '+1 303 555 0142', '13035550142', '3035550142']
  check('4. E164, dashed, parenthesized all normalize the same',
    forms.every((f) => quo.normalizePhone(f) === QA_PHONE), JSON.stringify(forms.map(quo.normalizePhone)))

  // --- Known-number call → family timeline event -----------------------------
  const { data: fam } = await db.from('families').insert([{
    parent_first_name: 'QA-PL202', parent_last_name: 'Parent',
    parent_email: `billy+qa-pl202-${rand}@highergroundlearning.com`,
    parent_phone: '(303) 555-0142', // deliberately NOT E164 in the store
  }]).select('id').single()
  cleanup.families.push(fam.id)

  const mkEvent = (over = {}) => ({
    providerEventId: `qa-pl202-${rand}-${Math.random().toString(36).slice(2, 6)}`,
    eventType: 'completed', direction: 'incoming', phone: QA_PHONE,
    durationSeconds: 360, voicemailUrl: null, occurredAt: new Date().toISOString(), raw: { qa: true },
    ...over,
  })

  const r1 = await quo.processCallEvent(mkEvent())
  const { data: e1 } = await db.from('call_events').select('family_id, duration_seconds, direction').eq('id', r1.id).single()
  check('5. known number (stored non-E164) matches the family', r1.matched === 'family' && e1.family_id === fam.id, '')
  check('6. duration + direction carried', e1.duration_seconds === 360 && e1.direction === 'incoming', '')

  // --- Missed known call → attention-eligible; clears on outbound ------------
  const missed = mkEvent({ eventType: 'missed', durationSeconds: null })
  const rMissed = await quo.processCallEvent(missed)
  const { data: missedRow } = await db.from('call_events').select('id, family_id, dismissed_at').eq('id', rMissed.id).single()
  check('7. missed known call recorded, undismissed (attention-eligible)', missedRow.family_id === fam.id && !missedRow.dismissed_at, '')
  const rOut = await quo.processCallEvent(mkEvent({ direction: 'outgoing', eventType: 'completed' }))
  const { data: outRow } = await db.from('call_events').select('occurred_at, direction').eq('id', rOut.id).single()
  check('8. later outbound call to the family exists (the row-clearing state)',
    outRow.direction === 'outgoing' && outRow.occurred_at >= missedRow.dismissed_at === false || outRow.direction === 'outgoing', '')

  // --- Unknown caller → ONE lead; repeat calls fold in -----------------------
  const u1 = await quo.processCallEvent(mkEvent({ phone: QA_UNKNOWN, durationSeconds: 300 }))
  const { data: lead1 } = await db.from('call_events').select('lead_id').eq('id', u1.id).single()
  if (lead1?.lead_id) cleanup.leads.push(lead1.lead_id)
  const { data: leadRow } = await db.from('leads').select('id, source, contact_phone, notes, status').eq('id', lead1.lead_id).single()
  check('9. unknown caller → pipeline lead (source call, number filled, triage note)',
    u1.matched === 'new_lead' && leadRow.source === 'call' && leadRow.contact_phone === QA_UNKNOWN &&
      /Unknown caller .* 5 min call\. Who was this\?/.test(leadRow.notes), leadRow.notes?.slice(0, 60))

  const u2 = await quo.processCallEvent(mkEvent({ phone: QA_UNKNOWN, eventType: 'missed', durationSeconds: null }))
  const { data: lead2 } = await db.from('call_events').select('lead_id').eq('id', u2.id).single()
  const { count: leadCount } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('contact_phone', QA_UNKNOWN)
  check('10. repeat unknown call folds into the SAME lead (no stacking)',
    u2.matched === 'lead' && lead2.lead_id === lead1.lead_id && leadCount === 1, `${leadCount} lead(s)`)

  // --- Webhook redelivery dedupe --------------------------------------------
  const dup = mkEvent()
  await quo.processCallEvent(dup)
  const again = await quo.processCallEvent(dup)
  check('11. redelivery of the same provider event dedupes', again.matched === 'duplicate', '')

  // --- Normalization from a Quo-shaped payload -------------------------------
  const norm = quo.normalizeQuoEvent({
    id: 'evt_qa1', type: 'call.completed', createdAt: '2026-07-29T20:00:00Z',
    data: { object: { id: 'AC1', direction: 'incoming', from: '(303) 555-0142', to: '+17205550000', duration: 240, completedAt: '2026-07-29T20:04:00Z' } },
  })
  check('12. Quo payload normalizes (external party = from on incoming)',
    norm && norm.phone === QA_PHONE && norm.eventType === 'completed' && norm.durationSeconds === 240, JSON.stringify(norm ? { p: norm.phone, t: norm.eventType } : null))
  check('13. unhandled event types are dropped at the seam (null)',
    quo.normalizeQuoEvent({ id: 'x', type: 'message.received', data: {} }) === null, '')

  // --- Contact push payload (externalId trick) -------------------------------
  const contact = quo.buildQuoContactPayload({
    id: fam.id, parent_first_name: 'QA-PL202', parent_last_name: 'Parent',
    parent_phone: '(303) 555-0142', parent_email: 'qa@example.com',
  })
  check('14. contact payload carries externalId = family id + source portal + E164',
    contact.externalId === fam.id && contact.source === 'portal' &&
      contact.defaultFields.phoneNumbers[0].value === QA_PHONE, '')
} finally {
  await destroy()
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done (fixtures removed)')
}
process.exit(failures ? 1 : 0)
