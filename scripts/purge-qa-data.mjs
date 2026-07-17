#!/usr/bin/env node
// PL-48: QA-data purge — part of the cutover runbook. DO NOT run casually.
//
//   node scripts/purge-qa-data.mjs             # DRY RUN (default): lists what it would delete
//   node scripts/purge-qa-data.mjs --apply     # actually delete (run at cutover, after review)
//
// Removes every QA fixture so the first real import starts clean:
//   * all QA families + students (matched by the explicit email list below) —
//     Reggie QAStudent, Scar Tissue, Roman Desmond, Bill Thom, Fakey
//     McFakerson, the April duplicate rows, QA Availability, QA Intake2, …
//   * their enrollments, add-ons, attendance, agreements, availability, scores
//   * the tutoring fixtures: engagements (Roman × SAT × Billy; Fakey × ASVAB
//     package), sessions, timecards, September invoice + lines
//   * the QA leads (Roman Thomas Sierra, QA Availability, QA Intake2)
//   * all email_sends/email_events to QA addresses or QA enrollments
//   * the QA class cohorts (ASF April, MIS July) + their sessions/requests.
//     The real fall classes (Nido, Cape Town, ISD) are KEPT — only their QA
//     enrollments go. The dry run lists any class left with zero enrollments
//     so you can add its id to QA_CLASS_IDS if it should go too.
//
// External systems are left alone on purpose: Stripe test PaymentIntents and
// QBO sandbox documents stay where they are — only the PORTAL rows go. The
// gcal events of deleted sessions are NOT touched here (rotate/clean the
// tutor calendar by hand if the QA events matter); everything else cascades
// in FK-safe order below. Idempotent: re-running deletes nothing new.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')

// ---- review these lists at cutover ----------------------------------------
const QA_FAMILY_EMAILS = [
  'slick@bruce.net',
  'desmond@john.com',
  'fake@fakest.org',
  'f@f.com',
  'williamraymondthomas@gmail.com',
  'bruce@bru.ce',
  'bru@ce.thomas',
  'billy@highergroundlearning.com',
  'qa-availability-pl19@example.com',
  'billy+qaparent@highergroundlearning.com',
  'billy+intake2@highergroundlearning.com',
]
const QA_CLASS_IDS = [
  'ef4b8ae6-0d04-4cfd-a44f-a4e25e0a7f3c', // ASF SAT Prep (April QA cohort)
  'a996f604-9731-4b9c-8f94-2b2938caf872', // MIS SAT Prep (July, cancelled QA cohort)
]
// ---------------------------------------------------------------------------

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let total = 0
async function wipe(table, filterLabel, applyFilter) {
  const countQ = applyFilter(db.from(table).select('*', { count: 'exact', head: true }))
  const { count, error } = await countQ
  if (error) {
    console.log(`  !! ${table} (${filterLabel}): ${error.message}`)
    return
  }
  total += count ?? 0
  console.log(`  ${APPLY ? 'deleting' : 'would delete'} ${count ?? 0} × ${table} (${filterLabel})`)
  if (APPLY && (count ?? 0) > 0) {
    const { error: delError } = await applyFilter(db.from(table).delete())
    if (delError) console.log(`  !! delete failed for ${table}: ${delError.message}`)
  }
}

console.log(APPLY ? 'APPLY MODE — deleting QA fixtures\n' : 'DRY RUN — nothing will be deleted (pass --apply at cutover)\n')

// Resolve the QA graph.
const { data: families } = await db.from('families').select('id, parent_email').in('parent_email', QA_FAMILY_EMAILS)
const familyIds = (families ?? []).map((f) => f.id)
const { data: students } = await db.from('students').select('id').in('family_id', familyIds.length ? familyIds : ['-'])
const studentIds = (students ?? []).map((s) => s.id)
const { data: enrollments } = await db.from('enrollments').select('id').in('student_id', studentIds.length ? studentIds : ['-'])
const enrollmentIds = (enrollments ?? []).map((e) => e.id)
const { data: engagements } = await db.from('tutoring_engagements').select('id').in('student_id', studentIds.length ? studentIds : ['-'])
const engagementIds = (engagements ?? []).map((e) => e.id)
const { data: sessions } = await db.from('tutoring_sessions').select('id').in('engagement_id', engagementIds.length ? engagementIds : ['-'])
const sessionIds = (sessions ?? []).map((s) => s.id)
const { data: invoices } = await db.from('tutoring_invoices').select('id').in('family_id', familyIds.length ? familyIds : ['-'])
const invoiceIds = (invoices ?? []).map((i) => i.id)
const { data: qaLeads } = await db.from('leads').select('id').in('contact_email', QA_FAMILY_EMAILS)
const leadIds = (qaLeads ?? []).map((l) => l.id)

console.log(`matched: ${familyIds.length} families · ${studentIds.length} students · ${enrollmentIds.length} enrollments · ${engagementIds.length} tutoring schedules · ${sessionIds.length} tutoring sessions · ${invoiceIds.length} invoices · ${leadIds.length} leads · ${QA_CLASS_IDS.length} QA classes\n`)

// FK-safe order: leaves → roots. email_events hangs off email_sends, so the
// send ids resolve first and both go together:
{
  const { data: sends } = await db
    .from('email_sends')
    .select('id')
    .or(
      [
        enrollmentIds.length ? `enrollment_id.in.(${enrollmentIds.join(',')})` : null,
        `recipient_email.in.(${QA_FAMILY_EMAILS.map((e) => `"${e}"`).join(',')})`,
        QA_CLASS_IDS.length ? `class_id.in.(${QA_CLASS_IDS.join(',')})` : null,
      ]
        .filter(Boolean)
        .join(',')
    )
  const sendIds = (sends ?? []).map((s) => s.id)
  // email_events keys on the recipient address, not the send row.
  await wipe('email_events', 'QA recipient addresses', (q) => q.in('email_address', QA_FAMILY_EMAILS))
  await wipe('email_sends', 'QA recipients/enrollments/classes', (q) => q.in('id', sendIds.length ? sendIds : ['-']))
}
await wipe('attendance_records', 'QA enrollments', (q) => q.in('enrollment_id', enrollmentIds.length ? enrollmentIds : ['-']))
await wipe('qbo_sync_log', 'QA enrollments (portal rows only — QBO sandbox docs stay)', (q) => q.in('enrollment_id', enrollmentIds.length ? enrollmentIds : ['-']))
await wipe('gcal_sync_log', 'QA tutoring sessions', (q) => q.in('session_id', sessionIds.length ? sessionIds : ['-']))
// Timecards aggregate hours from sessions with no session FK — at cutover
// every timecard is QA-derived, so they ALL go. Review this line if any real
// tutoring hours have been logged before you run --apply.
await wipe('timecards', 'ALL timecards (every one is QA-derived at cutover)', (q) => q.gte('created_at', '2020-01-01'))
await wipe('tutoring_invoice_lines', 'QA invoices', (q) => q.in('invoice_id', invoiceIds.length ? invoiceIds : ['-']))
await wipe('tutoring_sessions', 'QA engagements', (q) => q.in('engagement_id', engagementIds.length ? engagementIds : ['-']))
await wipe('tutoring_invoices', 'QA families', (q) => q.in('id', invoiceIds.length ? invoiceIds : ['-']))
await wipe('tutoring_engagements', 'QA students', (q) => q.in('id', engagementIds.length ? engagementIds : ['-']))
await wipe('enrollment_addons', 'QA enrollments', (q) => q.in('enrollment_id', enrollmentIds.length ? enrollmentIds : ['-']))
await wipe('enrollments', 'QA students', (q) => q.in('id', enrollmentIds.length ? enrollmentIds : ['-']))
await wipe('agreement_acceptances', 'QA families', (q) => q.in('family_id', familyIds.length ? familyIds : ['-']))
await wipe('student_availability', 'QA students', (q) => q.in('student_id', studentIds.length ? studentIds : ['-']))
await wipe('student_scores', 'QA students', (q) => q.in('student_id', studentIds.length ? studentIds : ['-']))
await wipe('leads', 'QA contacts', (q) => q.in('id', leadIds.length ? leadIds : ['-']))
await wipe('students', 'QA families', (q) => q.in('id', studentIds.length ? studentIds : ['-']))
await wipe('families', 'QA parent emails', (q) => q.in('id', familyIds.length ? familyIds : ['-']))
// QA class cohorts last (their enrollments are already gone above).
await wipe('classroom_requests', 'QA classes', (q) => q.in('class_id', QA_CLASS_IDS))
await wipe('sessions', 'QA classes', (q) => q.in('class_id', QA_CLASS_IDS))
await wipe('classes', 'QA cohorts (ASF April, MIS July)', (q) => q.in('id', QA_CLASS_IDS))

// Post-check: real classes left empty (candidates for QA_CLASS_IDS).
const { data: leftover } = await db.from('classes').select('id, class_type, start_date, schools ( nickname ), enrollments ( id )')
for (const c of leftover ?? []) {
  if (!QA_CLASS_IDS.includes(c.id) && (c.enrollments?.length ?? 0) === 0) {
    console.log(`\nnote: ${c.schools?.nickname} ${c.class_type} (${c.start_date}) keeps its class record with zero enrollments — add ${c.id} to QA_CLASS_IDS if it should go too.`)
  }
}

console.log(`\n${APPLY ? 'Deleted' : 'Would delete'} ${total} rows total.` + (APPLY ? '' : ' Re-run with --apply at cutover.'))
