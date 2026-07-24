#!/usr/bin/env node
// PL-156 gate (send-light — RESEND_API_KEY deleted so nothing mails):
// the "Send {subFirstName} a note" button appears ONLY on the accepted
// coverage outcome; declined and withdrawn outcomes carry no button (there
// is nobody to hand off to). The note round-trips: sending it stores the
// text on the coverage request, which is what puts it on the substitute's
// handoff bundle. Tokens are request-scoped and reject cross-request reuse.
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-covnote')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/coverage.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const cov = require(path.join(out, 'coverage.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const cleanup = { requests: [], sessions: [], engagements: [], students: [], families: [], instructors: [], subjects: [] }
const rnd = () => Math.random().toString(36).slice(2, 8)

const mkTutor = async (label) => {
  const { data, error } = await db.from('instructors').insert([{
    name: `QA-PL156 ${label}`, email: `billy+qa-pl156-${label.toLowerCase()}-${rnd()}@highergroundlearning.com`,
    timezone: 'America/Denver', tutoring_active: true, subjects: ['QA-PL156 Subject'],
  }]).select('id, name, email').single()
  if (error) throw new Error('tutor: ' + error.message)
  cleanup.instructors.push(data.id)
  return data
}

try {
  // ---- Fixtures: an accepted coverage request -----------------------------
  const { data: subj, error: se } = await db.from('subjects')
    .insert([{ name: 'QA-PL156 Subject', category: 'subject_tutoring', hourly_rate: 80 }])
    .select('id, name').single()
  if (se) throw new Error('subject: ' + se.message)
  cleanup.subjects.push(subj.id)

  const requester = await mkTutor('Requester')
  const substitute = await mkTutor('Substitute')

  const { data: fam } = await db.from('families').insert([{
    parent_first_name: 'QA-PL156', parent_last_name: 'Parent',
    parent_email: `billy+qa-pl156-fam-${rnd()}@highergroundlearning.com`,
  }]).select('id').single()
  cleanup.families.push(fam.id)
  const { data: stu } = await db.from('students').insert([{
    family_id: fam.id, first_name: 'QA-PL156-Ana', last_name: 'Student',
  }]).select('id').single()
  cleanup.students.push(stu.id)
  const { data: eng } = await db.from('tutoring_engagements').insert([{
    student_id: stu.id, tutor_id: requester.id, subject_id: subj.id,
    hourly_rate: 80, funding: 'monthly_billed', recurrence: [], status: 'active',
    location: 'QA Room 1',
  }]).select('id').single()
  cleanup.engagements.push(eng.id)
  const startsAt = new Date(Date.now() + 7 * 86400000).toISOString()
  const { data: ses } = await db.from('tutoring_sessions').insert([{
    engagement_id: eng.id, student_id: stu.id, tutor_id: requester.id,
    starts_at: startsAt, ends_at: new Date(Date.parse(startsAt) + 3600000).toISOString(),
    status: 'confirmed', rate_snapshot: 80,
  }]).select('id').single()
  cleanup.sessions.push(ses.id)

  const mkRequest = async (status) => {
    const { data, error } = await db.from('coverage_requests').insert([{
      session_id: ses.id, requesting_tutor_id: requester.id,
      candidate_tutor_id: substitute.id, status,
      ...(status !== 'offered' ? { resolved_at: new Date().toISOString() } : {}),
    }]).select('id').single()
    if (error) throw new Error('request: ' + error.message)
    cleanup.requests.push(data.id)
    return data.id
  }

  // ---- 1. Tokens are request-scoped ---------------------------------------
  const acceptedId = await mkRequest('accepted')
  const token = cov.coverageNoteToken(acceptedId)
  const verified = cov.verifyCoverageNoteToken(token)
  check('1. a fresh note token verifies to its own request', verified?.id === acceptedId, JSON.stringify(verified))
  const otherId = await mkRequest('declined')
  const swapped = cov.coverageNoteToken(otherId).split('.').slice(1).join('.')
  check('2. a token from another request is rejected',
    cov.verifyCoverageNoteToken(`${acceptedId}.${swapped}`) === 'invalid')
  check('3. garbage is rejected', cov.verifyCoverageNoteToken('nonsense') === 'invalid')
  check('4. the note URL points at the form page',
    cov.coverageNoteUrlFor(acceptedId).includes(`/coverage/note/${acceptedId}.`))

  // ---- 2. Only an ACCEPTED request offers the form -------------------------
  const ctxAccepted = await cov.coverageNoteContext(acceptedId)
  check('5. accepted request has a note context', Boolean(ctxAccepted))
  check('6. context names the substitute, not the requester',
    ctxAccepted?.subFirstName === 'QA-PL156', ctxAccepted?.subFirstName)
  check('7. context carries the student + subject for the form copy',
    ctxAccepted?.studentFirst === 'QA-PL156-Ana' && ctxAccepted?.subjectName === 'QA-PL156 Subject',
    JSON.stringify({ s: ctxAccepted?.studentFirst, sub: ctxAccepted?.subjectName }))
  check('8. nothing sent yet', ctxAccepted?.alreadySent === null)

  check('9. DECLINED request has no note context (nobody to hand off to)',
    (await cov.coverageNoteContext(otherId)) === null)
  const withdrawnId = await mkRequest('cancelled')
  check('10. WITHDRAWN request has no note context',
    (await cov.coverageNoteContext(withdrawnId)) === null)
  const offeredId = await mkRequest('offered')
  check('11. still-OFFERED request has no note context (not covered yet)',
    (await cov.coverageNoteContext(offeredId)) === null)

  // ---- 3. Sending the note stores it on the request (= the handoff bundle) --
  const NOTE = 'Ana is midway through circle theorems and second-guesses herself.\n\nSkip nothing.'
  const sendRes = await cov.sendCoverageNote({ requestId: acceptedId, note: NOTE })
  check('12. sending the note succeeds', sendRes.ok === true, JSON.stringify(sendRes))
  const { data: after } = await db.from('coverage_requests')
    .select('handoff_note, handoff_note_at').eq('id', acceptedId).single()
  check('13. the note is stored on the request — this IS the handoff bundle',
    after?.handoff_note === NOTE, String(after?.handoff_note).slice(0, 40))
  check('14. the send is timestamped', Boolean(after?.handoff_note_at))
  const ctxAfter = await cov.coverageNoteContext(acceptedId)
  check('15. the form now knows a note was already sent', Boolean(ctxAfter?.alreadySent))

  // ---- 4. Refusals --------------------------------------------------------
  const emptyRes = await cov.sendCoverageNote({ requestId: acceptedId, note: '   ' })
  check('16. an empty note is refused', emptyRes.ok !== true && emptyRes.status === 400)
  const declinedSend = await cov.sendCoverageNote({ requestId: otherId, note: 'hello' })
  check('17. a note to a DECLINED request is refused', declinedSend.ok !== true, JSON.stringify(declinedSend))
  const longRes = await cov.sendCoverageNote({ requestId: acceptedId, note: 'x'.repeat(4001) })
  check('18. an over-long note is refused', longRes.ok !== true && longRes.status === 400)
} catch (e) {
  check('flow ran without crashing', false, e.stack?.slice(0, 400) ?? e.message)
} finally {
  for (const id of cleanup.requests) await db.from('coverage_requests').delete().eq('id', id)
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
