#!/usr/bin/env node
// PL-363 A/B: mid-flight class import — bring a class's existing registrants
// (the Sheets/MailerLite export CSV) into the portal WITHOUT firing a single
// email. Families/students go through THE one path (upsertFamilyAndStudent —
// dedupes against QBO-imported and existing families by parent email),
// enrollments are created in the right state (Paid where they paid via the
// old system; Pending otherwise; Waitlisted supported), stamped
// source='import', with the STAFF-SUPPLIED original-registration schedule as
// the schedule-change baseline (the standing rule depends on it). Lifecycle
// emails join IN PROGRESS: every already-due sequence step is CLAIMED
// (cancelled email_sends rows — the same fold mechanism as the LR welcome),
// so nothing retroactive ever sends; future steps fire on their natural
// schedule. Imported Paid rows do NOT enqueue QBO (the old system already
// booked that money — importing it again would double-book). Idempotent by
// student+class: re-running (the final handoff sweep) skips existing rows.
//
// Usage:
//   node scripts/import-class-registrations.mjs \
//     --class <class id or slug> --csv <file.csv> \
//     --mapping <mapping.json>        (or omit for interactive mapping on a TTY)
//     --baseline <baseline.json>      ({"location": "...", "sessions": [{"session_date","start_time","end_time","location"}]})
//   | --baseline-current              (explicitly: today's class schedule IS what they saw)
//     [--all-paid | --all-pending]    (when the CSV has no paid column)
//     [--by <staff email>] [--dry-run]
//
// Mapping file: { "parentFirst": "Parent First Name", "parentLast": "...",
//   "parentEmail": "Email", "studentFirst": "...", "studentLast": "...",
//   "studentEmail": null, "graduatingYear": null, "paid": "Paid?",
//   "paidAmount": null, "registeredAt": "Timestamp", "notes": null,
//   "waitlist": null, "parentName": null, "studentName": null }
// (parentName/studentName split a single full-name column on the last space.)

import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1]?.startsWith('--') ? true : args[i + 1] ?? true) : null
}
const has = (name) => args.includes(`--${name}`)
const classRef = flag('class')
const csvPath = flag('csv')
const dryRun = has('dry-run')
const recordedBy = (typeof flag('by') === 'string' ? flag('by') : 'import-script').toLowerCase()
if (!classRef || typeof classRef !== 'string' || !csvPath || typeof csvPath !== 'string') {
  console.error('Need --class <id|slug> and --csv <file>.')
  process.exit(1)
}

// ---- CSV parse (RFC 4180-ish: quotes, embedded commas/newlines) ------------
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

const csvRaw = readFileSync(csvPath, 'utf8')
const table = parseCsv(csvRaw)
if (table.length < 2) { console.error('CSV has no data rows.'); process.exit(1) }
const headers = table[0].map((h) => h.trim())
const dataRows = table.slice(1)

// ---- column mapping --------------------------------------------------------
const FIELDS = [
  ['parentEmail', /parent.*e-?mail|^e-?mail|guardian.*mail/i, true],
  ['parentFirst', /parent.*first|guardian.*first/i, false],
  ['parentLast', /parent.*last|guardian.*last/i, false],
  ['parentName', /^parent(\s*name)?$|guardian(\s*name)?$|parent.*full/i, false],
  ['studentFirst', /student.*first|child.*first/i, false],
  ['studentLast', /student.*last|child.*last/i, false],
  ['studentName', /^student(\s*name)?$|child(\s*name)?$|student.*full/i, false],
  ['studentEmail', /student.*e-?mail|child.*e-?mail/i, false],
  ['graduatingYear', /grad|year/i, false],
  ['paid', /^paid|payment(\s*status)?/i, false],
  ['paidAmount', /amount|total|price/i, false],
  ['registeredAt', /timestamp|registered|submitted|date/i, false],
  ['notes', /notes|comment/i, false],
  ['waitlist', /waitlist/i, false],
]

let mapping = {}
const mappingPath = typeof flag('mapping') === 'string' ? flag('mapping') : null
if (mappingPath) {
  mapping = JSON.parse(readFileSync(mappingPath, 'utf8'))
  for (const key of Object.keys(mapping)) {
    if (mapping[key] != null && !headers.includes(mapping[key])) {
      console.error(`Mapping error: column "${mapping[key]}" (for ${key}) is not in the CSV. Headers: ${headers.join(' | ')}`)
      process.exit(1)
    }
  }
} else if (process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  console.log(`CSV columns: ${headers.map((h, i) => `[${i}] ${h}`).join('  ')}\n`)
  for (const [key, guessRe, required] of FIELDS) {
    const guess = headers.find((h) => guessRe.test(h))
    const answer = await rl.question(
      `${key}${required ? ' (required)' : ''} — column number${guess ? ` [enter = "${guess}"]` : ' [enter = none]'}: `
    )
    if (answer.trim() === '') mapping[key] = guess ?? null
    else if (/^\d+$/.test(answer.trim())) mapping[key] = headers[Number(answer.trim())] ?? null
    else mapping[key] = headers.includes(answer.trim()) ? answer.trim() : null
  }
  rl.close()
  const saveTo = path.join(process.cwd(), 'scripts', `.tmp-import-mapping-${Date.now()}.json`)
  writeFileSync(saveTo, JSON.stringify(mapping, null, 2))
  console.log(`\nMapping saved to ${saveTo} — pass it next time with --mapping.\n`)
} else {
  console.error('No --mapping and no TTY for interactive mapping.')
  process.exit(1)
}
if (!mapping.parentEmail) { console.error('parentEmail mapping is required.'); process.exit(1) }

const col = (row, key) => {
  const h = mapping[key]
  if (!h) return null
  const v = row[headers.indexOf(h)]
  return typeof v === 'string' ? v.trim() : null
}
const splitName = (full) => {
  const parts = String(full ?? '').trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}
const truthy = (v) => /^(y|yes|true|paid|x|1|complete|completed)$/i.test(String(v ?? '').trim())

// ---- class + baseline ------------------------------------------------------
const isUuid = /^[0-9a-f-]{36}$/i.test(classRef)
const { data: cls } = await db
  .from('classes')
  .select('id, slug, class_type, status, price, capacity, timezone, default_location, school_id, schools ( nickname, timezone ), sessions ( session_date, start_time, end_time, location )')
  .eq(isUuid ? 'id' : 'slug', classRef)
  .maybeSingle()
if (!cls) { console.error(`Class not found: ${classRef}`); process.exit(1) }
if (cls.status === 'cancelled') { console.error('This class is cancelled — refusing to import into it.'); process.exit(1) }
const school = Array.isArray(cls.schools) ? cls.schools[0] : cls.schools
const tz = cls.timezone ?? school?.timezone ?? 'America/Denver'
const label = `${school?.nickname ?? 'HGL'} ${cls.class_type}`

let baselineSessions, baselineLocation
const baselinePath = typeof flag('baseline') === 'string' ? flag('baseline') : null
if (baselinePath) {
  const b = JSON.parse(readFileSync(baselinePath, 'utf8'))
  if (!Array.isArray(b.sessions) || b.sessions.length === 0 || b.sessions.some((s) => !s.session_date)) {
    console.error('Baseline file must carry sessions: [{session_date, start_time, end_time, location?}, …]')
    process.exit(1)
  }
  baselineSessions = b.sessions
  baselineLocation = b.location ?? cls.default_location ?? null
} else if (has('baseline-current')) {
  baselineSessions = [...(cls.sessions ?? [])]
    .sort((a, b) => (a.session_date + (a.start_time ?? '')).localeCompare(b.session_date + (b.start_time ?? '')))
    .map((s) => ({ session_date: s.session_date, start_time: s.start_time, end_time: s.end_time, location: s.location }))
  baselineLocation = cls.default_location ?? null
  console.log('⚠ --baseline-current: using TODAY\'s class schedule as the registration baseline — only right if the schedule has not changed since these families registered.')
} else {
  console.error('The schedule-change baseline is required: pass --baseline <file.json> (what these families were shown when they registered) or --baseline-current.')
  process.exit(1)
}
const snapshot = {
  origin: 'registration',
  imported: true,
  first_session: baselineSessions.map((s) => s.session_date).sort()[0],
  location: baselineLocation,
  sessions: baselineSessions.map((s) => ({
    session_date: s.session_date,
    start_time: s.start_time ?? null,
    end_time: s.end_time ?? null,
    location: s.location ?? null,
  })),
  seq: 0,
}

// ---- compile THE one family/student path + sequence helpers ----------------
const out = path.join(process.cwd(), 'scripts', '.tmp-build-import-class')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/registration.ts app/utils/lifecycle.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { upsertFamilyAndStudent } = require(path.join(out, 'registration.js'))
const { SEQUENCE, stepTargetDate, isDue } = require(path.join(out, 'lifecycle.js'))

const classSessions = [...(cls.sessions ?? [])].map((s) => s.session_date).sort()
const firstSession = classSessions[0] ?? null
const lastSession = classSessions[classSessions.length - 1] ?? firstSession
const dueSteps = firstSession
  ? SEQUENCE.filter((s) => isDue(tz, stepTargetDate(s, { firstSession, lastSession }), s.hour))
  : []

// ---- import ----------------------------------------------------------------
const allPaid = has('all-paid')
const allPending = has('all-pending')
const summary = { rows: 0, created: 0, paid: 0, pending: 0, waitlisted: 0, skippedExisting: 0, skippedBad: 0, claims: 0 }
console.log(`\nImporting into ${label} (${cls.id}) — ${dataRows.length} CSV rows, ${dueSteps.length} sequence step(s) already due will be claimed per Paid row${dryRun ? ' [DRY RUN]' : ''}.\n`)

for (const row of dataRows) {
  summary.rows++
  const parentEmail = (col(row, 'parentEmail') ?? '').toLowerCase()
  let pFirst = col(row, 'parentFirst') ?? ''
  let pLast = col(row, 'parentLast') ?? ''
  if (!pFirst && mapping.parentName) ({ first: pFirst, last: pLast } = splitName(col(row, 'parentName')))
  let sFirst = col(row, 'studentFirst') ?? ''
  let sLast = col(row, 'studentLast') ?? ''
  if (!sFirst && mapping.studentName) ({ first: sFirst, last: sLast } = splitName(col(row, 'studentName')))
  if (!parentEmail || !parentEmail.includes('@') || !sFirst) {
    console.log(`  SKIP (missing parent email or student name): ${JSON.stringify(row.slice(0, 4))}`)
    summary.skippedBad++
    continue
  }
  if (!pFirst) pFirst = parentEmail.split('@')[0]
  if (!sLast) sLast = pLast || '(unknown)'

  const isWaitlist = mapping.waitlist ? truthy(col(row, 'waitlist')) : false
  const isPaid = !isWaitlist && (allPaid ? true : allPending ? false : mapping.paid ? truthy(col(row, 'paid')) : false)
  const status = isWaitlist ? 'Waitlisted' : isPaid ? 'Paid' : 'Pending'
  const registeredAtRaw = col(row, 'registeredAt')
  const registeredAt = registeredAtRaw && !isNaN(Date.parse(registeredAtRaw)) ? new Date(registeredAtRaw).toISOString() : null
  const amountRaw = col(row, 'paidAmount')
  const amount = amountRaw && !isNaN(Number(amountRaw.replace(/[$,]/g, ''))) ? Number(amountRaw.replace(/[$,]/g, '')) : Number(cls.price)

  if (dryRun) {
    console.log(`  DRY: ${sFirst} ${sLast} (${parentEmail}) → ${status}${isPaid ? ` $${amount}` : ''}${registeredAt ? ` @ ${registeredAt.slice(0, 10)}` : ''}`)
    continue
  }

  const result = await upsertFamilyAndStudent({
    parentFirst: pFirst,
    parentLast: pLast || '(unknown)',
    parentEmail,
    studentFirst: sFirst,
    studentLast: sLast,
    studentEmail: (col(row, 'studentEmail') ?? '').toLowerCase() || null,
    schoolId: cls.school_id ?? null,
    graduatingYear: col(row, 'graduatingYear') || null,
    pronouns: null,
  })
  if ('error' in result) {
    console.error(`  FAIL ${parentEmail}: ${result.error}`)
    summary.skippedBad++
    continue
  }

  // Idempotency: student already live on this class → skip (re-import and
  // the final handoff sweep are harmless).
  const { data: existing } = await db
    .from('enrollments')
    .select('id, payment_status')
    .eq('student_id', result.studentId)
    .eq('class_id', cls.id)
    .in('payment_status', ['Pending', 'Paid', 'Completed', 'Waitlisted'])
    .maybeSingle()
  if (existing) {
    console.log(`  skip (already ${existing.payment_status}): ${sFirst} ${sLast}`)
    summary.skippedExisting++
    continue
  }

  const { data: enr, error: enrErr } = await db
    .from('enrollments')
    .insert([{
      student_id: result.studentId,
      class_id: cls.id,
      payment_status: status,
      ...(registeredAt ? { enrolled_at: registeredAt } : {}),
      ...(isPaid
        ? {
            paid_at: registeredAt ?? new Date().toISOString(),
            amount_paid: amount,
            class_price_paid: amount,
          }
        : {}),
      notes: col(row, 'notes') || null,
      source: 'import',
      source_recorded_by: recordedBy,
      schedule_snapshot: snapshot,
    }])
    .select('id')
    .single()
  if (enrErr || !enr) {
    console.error(`  FAIL enrollment for ${sFirst} ${sLast}: ${enrErr?.message}`)
    summary.skippedBad++
    continue
  }

  // NO emails — claim the whole confirmation flow and every already-due
  // sequence step (cancelled rows ARE the claim; sendOnce suppresses on
  // them, and the comms dashboard shows exactly why nothing went out).
  if (status === 'Paid') {
    const claimKeys = [
      `parent_confirmation:${enr.id}`,
      `student_confirmation:${enr.id}`,
      `thank_you:${enr.id}`,
      ...dueSteps.flatMap((s) => ['p', 's'].map((tag) => `${s.type}_${tag}:${enr.id}`)),
    ]
    for (const dedupe_key of claimKeys) {
      const { error: claimErr } = await db.from('email_sends').insert([{
        dedupe_key,
        template_key: 'SUPERSEDED',
        enrollment_id: enr.id,
        class_id: cls.id,
        recipient_email: parentEmail,
        status: 'cancelled',
        cancel_reason: 'imported mid-flight — the previous system already handled this step',
      }])
      if (claimErr && claimErr.code !== '23505') console.error(`  claim failed ${dedupe_key}: ${claimErr.message}`)
      else summary.claims++
    }
  }

  summary.created++
  summary[status === 'Paid' ? 'paid' : status === 'Waitlisted' ? 'waitlisted' : 'pending']++
  console.log(`  ok: ${sFirst} ${sLast} (${parentEmail}) → ${status}`)
}

console.log(`\nDone. ${JSON.stringify(summary)}`)
console.log('Reminder: imported Paid rows were NOT posted to QuickBooks (the old system already booked that revenue). Imported Pendings are exempt from automatic payment reminders/expiry — they surface on Needs Attention; send the payment link from the roster row when ready.')
