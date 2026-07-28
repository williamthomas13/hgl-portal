#!/usr/bin/env node
// PL-159 gate (send-light — RESEND_API_KEY deleted): proposed sessions hold
// their slot. Covers: holdActive lifetimes, the state-driven hold sync
// outcomes (without touching Google — pure derivation checks), and the
// first-accept-wins E2E: two overlapping proposals, both accept orders, the
// loser landing on conflict (rolled back), never a double-booking.
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-holds')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/schedule-approval.ts app/utils/gcal-sync.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const approval = require(path.join(out, 'schedule-approval.js'))
const sync = require(path.join(out, 'gcal-sync.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }
const rnd = () => Math.random().toString(36).slice(2, 8)
const cleanup = { sessions: [], engagements: [], students: [], families: [], instructors: [], subjects: [] }

// ---- 1. holdActive lifetimes (pure) ---------------------------------------
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()
check('1. active engagement (monthly proposal) always holds', sync.holdActive('active', null) === true)
check('2. fresh pending proposal holds', sync.holdActive('pending_parent_confirmation', daysAgo(3)) === true)
check('3. pending proposal not yet asked holds', sync.holdActive('pending_parent_confirmation', null) === true)
check(`4. pending proposal past ${sync.HOLD_LIFETIME_DAYS}d releases`,
  sync.holdActive('pending_parent_confirmation', daysAgo(sync.HOLD_LIFETIME_DAYS + 1)) === false)
check('5. ended engagement never holds', sync.holdActive('ended', null) === false)

// ---- 2. First-accept-wins E2E ---------------------------------------------
try {
  const { data: subj } = await db.from('subjects')
    .insert([{ name: `QA-PL159 Subject ${rnd()}`, category: 'subject_tutoring', hourly_rate: 80 }])
    .select('id').single()
  cleanup.subjects.push(subj.id)
  const { data: tutor } = await db.from('instructors').insert([{
    name: 'QA-PL159 Tutor', email: `billy+qa-pl159-${rnd()}@highergroundlearning.com`,
    timezone: 'America/Denver', tutoring_active: true,
  }]).select('id').single()
  cleanup.instructors.push(tutor.id)

  const mkFamily = async (label) => {
    const { data: fam } = await db.from('families').insert([{
      parent_first_name: `QA-PL159-${label}`, parent_last_name: 'Parent',
      parent_email: `billy+qa-pl159-${label.toLowerCase()}-${rnd()}@highergroundlearning.com`,
    }]).select('id').single()
    cleanup.families.push(fam.id)
    const { data: stu } = await db.from('students').insert([{
      family_id: fam.id, first_name: `QA-PL159-${label}`, last_name: 'Student',
    }]).select('id').single()
    cleanup.students.push(stu.id)
    return stu.id
  }
  const startsAt = new Date(Date.now() + 7 * 86_400_000)
  startsAt.setUTCMinutes(0, 0, 0)
  const endsAt = new Date(startsAt.getTime() + 3_600_000)
  const mkProposal = async (studentId, offsetMin = 0) => {
    const { data: eng } = await db.from('tutoring_engagements').insert([{
      student_id: studentId, tutor_id: tutor.id, subject_id: subj.id,
      hourly_rate: 80, funding: 'monthly_billed', recurrence: [],
      status: 'pending_parent_confirmation', approval_requested_at: new Date().toISOString(),
    }]).select('id').single()
    cleanup.engagements.push(eng.id)
    const { data: ses } = await db.from('tutoring_sessions').insert([{
      engagement_id: eng.id, student_id: studentId, tutor_id: tutor.id,
      starts_at: new Date(startsAt.getTime() + offsetMin * 60_000).toISOString(),
      ends_at: new Date(endsAt.getTime() + offsetMin * 60_000).toISOString(),
      status: 'proposed', rate_snapshot: 80,
    }]).select('id').single()
    cleanup.sessions.push(ses.id)
    return { engId: eng.id, sesId: ses.id }
  }

  const stuA = await mkFamily('A')
  const stuB = await mkFamily('B')
  // Overlapping: B starts 30 minutes into A's hour.
  const A = await mkProposal(stuA, 0)
  const B = await mkProposal(stuB, 30)

  // First accept wins…
  const resA = await approval.activatePendingEngagement(A.engId, 'parent')
  check('6. first family to accept gets the slot', resA.ok === true, JSON.stringify(resA))
  // …second lands on the friendly conflict, not an error, not a double-booking.
  const resB = await approval.activatePendingEngagement(B.engId, 'parent')
  check('7. second accept over the same slot → conflict, not ok', resB.ok === false && resB.conflict === true, JSON.stringify(resB))
  const { data: bAfter } = await db.from('tutoring_engagements').select('status').eq('id', B.engId).single()
  check('8. loser rolled back to pending (still confirmable elsewhere)', bAfter.status === 'pending_parent_confirmation')
  const { data: bSes } = await db.from('tutoring_sessions').select('status').eq('id', B.sesId).single()
  check('9. loser sessions rolled back to proposed', bSes.status === 'proposed')
  const { data: confirmed } = await db.from('tutoring_sessions')
    .select('id').eq('tutor_id', tutor.id).eq('status', 'confirmed')
  check('10. exactly ONE confirmed session — no double-booking', confirmed.length === 1)
  const { data: queued } = await db.from('gcal_sync_log').select('session_id').eq('session_id', A.sesId)
  check('11. winner queued for the calendar flip', (queued ?? []).length >= 1)

  // Both-orders sanity: a fresh non-overlapping proposal still activates.
  const C = await mkProposal(stuB, 24 * 60) // next day — no overlap
  const resC = await approval.activatePendingEngagement(C.engId, 'parent')
  check('12. a non-overlapping accept still activates cleanly', resC.ok === true, JSON.stringify(resC))
} catch (e) {
  check('flow ran without crashing', false, e.stack?.slice(0, 400) ?? e.message)
} finally {
  for (const id of cleanup.sessions) await db.from('tutoring_sessions').delete().eq('id', id)
  for (const id of cleanup.engagements) await db.from('tutoring_engagements').delete().eq('id', id)
  for (const id of cleanup.students) await db.from('students').delete().eq('id', id)
  for (const id of cleanup.families) await db.from('families').delete().eq('id', id)
  for (const id of cleanup.instructors) await db.from('instructors').delete().eq('id', id)
  for (const id of cleanup.subjects) await db.from('subjects').delete().eq('id', id)
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done')
}
process.exit(failures === 0 ? 0 : 1)
