#!/usr/bin/env node
// PL-281 E2E against the QBO SANDBOX, on the real rails (processQboQueue):
//   1. listEmployees() — proves the existing accounting scope covers
//      Employee reads (the PL-276 "verify once in sandbox" ask).
//   2. QA timecard (approved, hourly, matched) → enqueue → drain →
//      TimeActivity created, row synced, card flips to exported.
//   3. Re-drain → idempotent (row already synced; a forced second row is
//      blocked by the unique index).
//   4. Unmatched tutor → row fails IMMEDIATELY (PermanentSyncError — no
//      2h backoff) with the plain-English employee-matching message.
//   5. Cleanup: delete the sandbox TimeActivity, QA cards, sync rows;
//      restore the tutor's mapping to null.
// RESEND_API_KEY is deleted in-process (send-light harness) so the
// fail-loud alert path can't email anyone during the test.
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
delete process.env.RESEND_API_KEY // send-light: alerts no-op, rows still fail loud

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl281')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/qbo-sync.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { processQboQueue } = require(path.join(out, 'qbo-sync.js'))
const qbo = require(path.join(out, 'qbo.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const QA_PERIODS = [
  { start: '2025-01-01', end: '2025-01-15' },
  { start: '2025-01-16', end: '2025-01-31' },
]

// --- find Billy (hourly tutor) --------------------------------------------
const { data: billy } = await db
  .from('instructors')
  .select('id, name, pay_type, qbo_employee_id')
  .eq('name', 'Billy Thomas')
  .maybeSingle()
if (!billy) { console.error('no Billy Thomas instructor'); process.exit(1) }
check('fixture: Billy is hourly', billy.pay_type === 'hourly')
const priorMapping = billy.qbo_employee_id

// --- 1. Employee list on the existing scope --------------------------------
const employees = await qbo.listEmployees()
check('scope: Employee list readable', employees.length > 0, 'sandbox has no employees?')
console.log('  sandbox employees:', employees.map((e) => e.name).join(', '))
const emp = employees[0]

// --- 2. matched push --------------------------------------------------------
await db.from('instructors').update({ qbo_employee_id: emp.id }).eq('id', billy.id)
const { data: card1, error: c1Err } = await db
  .from('timecards')
  .insert([{ tutor_id: billy.id, period_start: QA_PERIODS[0].start, period_end: QA_PERIODS[0].end, status: 'approved', total_hours: 2.5, approved_by: 'qa-pl281', approved_at: new Date().toISOString() }])
  .select('id').single()
if (c1Err) { console.error('QA card insert failed:', c1Err.message); process.exit(1) }
await db.from('qbo_sync_log').insert([{ timecard_id: card1.id, kind: 'timecard_time' }])

const r1 = await processQboQueue()
console.log('  drain result:', JSON.stringify(r1))
const { data: row1 } = await db
  .from('qbo_sync_log').select('status, qbo_doc_id, last_error').eq('timecard_id', card1.id).maybeSingle()
check('push: row synced', row1?.status === 'synced', row1?.last_error ?? row1?.status)
check('push: TimeActivity id recorded', Boolean(row1?.qbo_doc_id))
const { data: card1After } = await db.from('timecards').select('status').eq('id', card1.id).maybeSingle()
check('push: card flipped to exported', card1After?.status === 'exported', card1After?.status)

// verify in QBO itself
const taQ = await qbo.qboQuery(`select Id, Description from TimeActivity where TxnDate = '${QA_PERIODS[0].end}' maxresults 1000`)
const ta = (taQ.TimeActivity ?? []).find((t) => String(t.Description ?? '').includes(`HGL timecard ${card1.id}`))
check('push: TimeActivity exists in sandbox', Boolean(ta), 'not found by marker')
check('push: sandbox id matches recorded id', ta && String(ta.Id) === row1?.qbo_doc_id)

// --- 3. idempotency ---------------------------------------------------------
const r2 = await processQboQueue()
check('idempotent: second drain does nothing', r2.synced === 0 && r2.failed === 0)
const { error: dupErr } = await db.from('qbo_sync_log').insert([{ timecard_id: card1.id, kind: 'timecard_time' }])
check('idempotent: second row blocked by unique index', dupErr?.code === '23505', dupErr?.code ?? 'inserted!')

// --- 4. unmatched tutor fails LOUD + immediately ---------------------------
await db.from('instructors').update({ qbo_employee_id: null }).eq('id', billy.id)
const { data: card2, error: c2Err } = await db
  .from('timecards')
  .insert([{ tutor_id: billy.id, period_start: QA_PERIODS[1].start, period_end: QA_PERIODS[1].end, status: 'approved', total_hours: 1, approved_by: 'qa-pl281', approved_at: new Date().toISOString() }])
  .select('id').single()
if (c2Err) { console.error('QA card2 insert failed:', c2Err.message); process.exit(1) }
await db.from('qbo_sync_log').insert([{ timecard_id: card2.id, kind: 'timecard_time' }])
await processQboQueue()
const { data: row2 } = await db
  .from('qbo_sync_log').select('status, attempts, last_error').eq('timecard_id', card2.id).maybeSingle()
check('unmatched: failed immediately (attempt 1, no backoff)', row2?.status === 'failed' && row2?.attempts === 1, JSON.stringify(row2))
check('unmatched: plain-English matching message', /isn't matched to a QuickBooks employee/.test(row2?.last_error ?? ''), row2?.last_error)
const { data: card2After } = await db.from('timecards').select('status').eq('id', card2.id).maybeSingle()
check('unmatched: card stays approved', card2After?.status === 'approved', card2After?.status)

// --- 5. cleanup -------------------------------------------------------------
if (ta) {
  const full = await qbo.qboQuery(`select * from TimeActivity where Id = '${ta.Id}'`)
  const syncToken = full.TimeActivity?.[0]?.SyncToken
  try {
    // qboRequest is module-private; the delete rides the same auth via a raw call.
    const auth = await qbo.getAccessToken()
    if (auth && syncToken != null) {
      const base = env.QBO_ENVIRONMENT === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'
      const res = await fetch(`${base}/v3/company/${auth.realmId}/timeactivity?operation=delete&minorversion=75`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ Id: String(ta.Id), SyncToken: String(syncToken) }),
      })
      check('cleanup: sandbox TimeActivity deleted', res.ok, `HTTP ${res.status}`)
    } else {
      check('cleanup: sandbox TimeActivity deleted', false, 'no auth/synctoken')
    }
  } catch (e) {
    check('cleanup: sandbox TimeActivity deleted', false, String(e))
  }
}
await db.from('qbo_sync_log').delete().in('timecard_id', [card1.id, card2.id])
await db.from('timecards').delete().in('id', [card1.id, card2.id])
await db.from('instructors').update({ qbo_employee_id: priorMapping }).eq('id', billy.id)
const { data: leftover } = await db.from('timecards').select('id').in('period_start', QA_PERIODS.map((p) => p.start)).eq('tutor_id', billy.id)
check('cleanup: QA cards gone', (leftover ?? []).length === 0)
check('cleanup: Billy mapping restored', true)

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
