#!/usr/bin/env node
// PL-403 E2E on a throwaway fixture class (deadline = TODAY, first session
// +3d): the deadline briefing sends promptly (this sweep pass, hour-gated),
// re-running sends nothing, a straggler payment triggers ONE "+1" note,
// re-running again sends nothing. Real sends to billy@ ONLY (the standing
// test-send rule); fixture rows + their email_sends are deleted at the end.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const env = Object.fromEntries(
  readFileSync(path.join(root, '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim()
      let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v

const out = path.join(root, 'scripts', '.tmp-build-pl403')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/instructor-comms.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require_ = createRequire(import.meta.url)
const lifecycle = require_(path.join(out, 'lifecycle.js'))
const ic = require_(path.join(out, 'instructor-comms.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
const plus = (n) => {
  const d = new Date(Date.now() + n * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

const { data: billy } = await db.from('instructors').select('id, email').ilike('email', 'billy@highergroundlearning.com').maybeSingle()
const { data: students } = await db.from('students').select('id, first_name, last_name, family_id').ilike('first_name', 'Fakey')
const fakey = students?.[0]
if (!billy || !fakey) { console.error('need billy + Fakey QA student'); process.exit(1) }
const { data: more } = await db.from('students').select('id, first_name, last_name, family_id').eq('family_id', fakey.family_id).limit(3)

let ok = true
const check = (cond, msg) => { console.log(cond ? `  PASS ${msg}` : `  FAIL ${msg}`); if (!cond) ok = false }
let classId = null
try {
  const { data: cls, error: clsErr } = await db
    .from('classes')
    .insert({
      class_type: 'QA-PL403 Prep',
      status: 'open',
      start_date: plus(3),
      enrollment_deadline: today,
      instructor_id: billy.id,
      delivery_mode: 'online',
      timezone: 'America/Denver',
      price: 100,
      capacity: 10,
      min_enrollment: 1,
    })
    .select('id')
    .single()
  if (clsErr) throw new Error('class insert: ' + clsErr.message)
  classId = cls.id
  console.log('fixture class:', classId, 'deadline', today, 'first session', plus(3))

  const mkEnr = async (studentId, paidAtIso) => {
    const { data, error } = await db
      .from('enrollments')
      .insert({
        class_id: classId,
        student_id: studentId,
        payment_status: 'Paid',
        enrolled_at: new Date(Date.now() - 3 * 86400000).toISOString(),
        paid_at: paidAtIso,
      })
      .select('id')
      .single()
    if (error) throw new Error('enrollment insert: ' + error.message)
    return data.id
  }
  await mkEnr(fakey.id, new Date(Date.now() - 2 * 86400000).toISOString())

  const bundleFor = async () => (await lifecycle.loadClassBundles(classId))[0]

  let b = await bundleFor()
  const r1 = await ic.sweepInstructorComms(b)
  const { data: sends1 } = await db.from('email_sends').select('dedupe_key, status, recipient_email, subject_rendered').eq('class_id', classId)
  const brief = (sends1 ?? []).find((s) => s.dedupe_key.startsWith('in_digest_brief:'))
  check(Boolean(brief), `deadline briefing sent this pass (${brief?.dedupe_key ?? 'MISSING'}) → ${brief?.recipient_email}`)
  check(brief?.recipient_email === 'billy@highergroundlearning.com', 'recipient is billy@ (test-send rule)')
  console.log('  subject:', brief?.subject_rendered)

  const r2 = await ic.sweepInstructorComms(await bundleFor())
  const { data: sends2 } = await db.from('email_sends').select('dedupe_key').eq('class_id', classId)
  check((sends2 ?? []).length === (sends1 ?? []).length, 'second pass sends NOTHING new')

  // straggler joins now
  const second = (more ?? []).find((s) => s.id !== fakey.id) ?? fakey
  await mkEnr(second.id, new Date().toISOString())
  const r3 = await ic.sweepInstructorComms(await bundleFor())
  const { data: sends3 } = await db.from('email_sends').select('dedupe_key, subject_rendered, payload').eq('class_id', classId)
  const add = (sends3 ?? []).find((s) => s.dedupe_key.startsWith('in_roster_add:'))
  check(Boolean(add), `straggler → ONE roster-addition note (${add?.dedupe_key ?? 'MISSING'})`)

  const r4 = await ic.sweepInstructorComms(await bundleFor())
  const { data: sends4 } = await db.from('email_sends').select('dedupe_key').eq('class_id', classId)
  check((sends4 ?? []).length === (sends3 ?? []).length, 'fourth pass sends NOTHING new')
  void r1; void r2; void r3; void r4
} catch (e) {
  console.error('E2E error:', e.message)
  ok = false
} finally {
  if (classId) {
    await db.from('email_sends').delete().eq('class_id', classId)
    await db.from('enrollments').delete().eq('class_id', classId)
    await db.from('classes').delete().eq('id', classId)
    console.log('fixture cleaned up')
  }
}
rmSync(out, { recursive: true, force: true })
console.log(ok ? '\nPL-403 E2E: ALL PASS' : '\nPL-403 E2E: FAILURES')
process.exit(ok ? 0 : 1)
