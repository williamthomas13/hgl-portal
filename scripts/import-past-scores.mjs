#!/usr/bin/env node
// PL-504: historical roster + score import from the Google Sheets — the 13
// backfilled past classes (PL-476) carry NO rosters or scores; marketing
// numbers need them. CSV in (one row per student per class), a DRY-RUN
// projector by default, --apply only after Scarlett has read the projection.
// SILENT by construction: this script never composes an email (no sendOnce),
// every enrollment it creates is comms_muted + source='import' (the PL-363
// historical-import value — enrollments.source is CHECK-constrained; the
// sheet provenance rides source_recorded_by='sheet_import:<by>' + the note)
// + payment_status 'Completed' (a finished class); every score row is
// source='sheet_import' (free text on student_scores — no migration). Idempotent: an enrollment that exists for
// student+class is kept; a score that exists for student+class+test label is
// skipped. Rows whose class is not found are REFUSED (listed, never guessed).
//
//   node scripts/import-past-scores.mjs --csv <file> [--apply] [--json] [--by <staff email>]
//
// CSV columns (Claude cleans each Sheet export into this layout — same
// pattern as scripts/.tmp-import/):
//   class              slug ("aisj-sat-prep-spring26") or school code ("aisj" —
//                      accepted only when the school has exactly ONE class;
//                      otherwise refused "ambiguous — use the slug")
//   student_first, student_last, parent_email, student_email,
//   parent_first, parent_last            (parent names only for NEW families)
//   d1_rw, d1_math, d1_total, d1_date    Diagnostic 1 (any may be blank)
//   d2_rw, d2_math, d2_total, d2_date    Diagnostic 2
//   final_rw, final_math, final_total, final_date
//   attendance                           sessions attended (count) — recorded
//                                        on the enrollment note (there is no
//                                        per-session record to build)
// Student matching: student_email → then parent_email + student name → else
// a NEW family + student via the one path (upsertFamilyAndStudent).
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

function safeRm(dir) { try { rmSync(dir, { recursive: true, force: true }) } catch (e) { console.warn(`note: could not remove temp dir ${dir} (${e?.code ?? e})`) } }
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const csvPath = opt('--csv')
const APPLY = flag('--apply')
const JSON_OUT = flag('--json')
const BY = opt('--by', 'import-past-scores')
if (!csvPath) { console.error('usage: node scripts/import-past-scores.mjs --csv <file> [--apply] [--json] [--by <email>]'); process.exit(2) }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// --- CSV --------------------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row) }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''))
  const keys = header.map((h) => h.trim().toLowerCase())
  return body.map((r, i) => ({ line: i + 2, ...Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? '').trim()])) }))
}
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null }
const date = (v) => { const s = String(v ?? '').trim(); if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }
const norm = (s) => String(s ?? '').trim().toLowerCase()

const rows = parseCsv(readFileSync(csvPath, 'utf8'))

// --- classes ----------------------------------------------------------------
const classCache = new Map()
async function resolveClass(ref) {
  const key = norm(ref)
  if (!key) return { error: 'blank class' }
  if (classCache.has(key)) return classCache.get(key)
  let out
  const { data: bySlug } = await db.from('classes').select('id, slug, class_type, start_date, school_id, status').eq('slug', key).maybeSingle()
  if (bySlug) out = { cls: bySlug }
  else {
    const { data: school } = await db.from('schools').select('id, nickname').eq('evergreen_code', key).maybeSingle()
    if (!school) out = { error: `class "${ref}" not found (no slug, no school code)` }
    else {
      const { data: list } = await db.from('classes').select('id, slug, class_type, start_date, school_id, status').eq('school_id', school.id)
      if (!list?.length) out = { error: `school code "${ref}" has no class` }
      else if (list.length > 1) out = { error: `school code "${ref}" is ambiguous (${list.length} classes) — use the slug: ${list.map((c) => c.slug).join(', ')}` }
      else out = { cls: list[0] }
    }
  }
  classCache.set(key, out)
  return out
}

// --- students ---------------------------------------------------------------
async function findStudent(r) {
  if (r.student_email) {
    const { data } = await db.from('students').select('id, family_id, first_name, last_name').ilike('student_email', r.student_email).limit(1).maybeSingle()
    if (data) return { student: data, how: 'student email' }
  }
  if (r.parent_email) {
    const { data: fam } = await db.from('families').select('id').ilike('parent_email', r.parent_email).limit(1).maybeSingle()
    if (fam) {
      const { data: kids } = await db.from('students').select('id, family_id, first_name, last_name').eq('family_id', fam.id)
      const kid = (kids ?? []).find((s) => norm(s.first_name) === norm(r.student_first) && norm(s.last_name) === norm(r.student_last))
      if (kid) return { student: kid, how: 'parent email + name' }
      return { student: null, familyId: fam.id, how: 'family exists, new student' }
    }
  }
  return { student: null, how: 'new family + student' }
}

const TESTS = [
  ['Diagnostic 1', 'd1'],
  ['Diagnostic 2', 'd2'],
  ['Final', 'final'],
]
function scoresFor(r) {
  const out = []
  for (const [label, p] of TESTS) {
    const rw = num(r[`${p}_rw`]); const math = num(r[`${p}_math`]); let total = num(r[`${p}_total`])
    if (total == null && rw != null && math != null) total = rw + math
    if (total == null && rw == null && math == null) continue
    const sections = {}
    if (rw != null) sections['Reading & Writing'] = rw
    if (math != null) sections['Math'] = math
    out.push({ test_label: label, section_scores: Object.keys(sections).length ? sections : null, total, taken_at: date(r[`${p}_date`]) })
  }
  return out
}

// --- projection ---------------------------------------------------------------
const plan = { refused: [], rows: [] }
// In-file duplicates (the same student+class twice in one CSV) are planned
// ONCE — the second row's enrollment/scores read "duplicate row in this file".
const seenEnrollment = new Set()
const seenScore = new Set()
for (const r of rows) {
  if (!r.student_first || !r.student_last) { plan.refused.push({ line: r.line, reason: 'missing student first/last name' }); continue }
  if (!r.parent_email && !r.student_email) { plan.refused.push({ line: r.line, reason: 'no parent email and no student email — nothing to match or create a family on' }); continue }
  const c = await resolveClass(r.class)
  if (c.error) { plan.refused.push({ line: r.line, reason: c.error }); continue }
  const m = await findStudent(r)
  const scores = scoresFor(r)
  let enrollmentExists = false
  let existingLabels = new Set()
  if (m.student) {
    const { data: en } = await db.from('enrollments').select('id').eq('student_id', m.student.id).eq('class_id', c.cls.id).limit(1).maybeSingle()
    enrollmentExists = Boolean(en)
    const { data: sc } = await db.from('student_scores').select('test_label').eq('student_id', m.student.id).eq('class_id', c.cls.id)
    existingLabels = new Set((sc ?? []).map((s) => s.test_label))
  }
  const matchKey = m.student ? m.student.id : `${norm(r.student_email || r.parent_email)}|${norm(r.student_first)}|${norm(r.student_last)}`
  const enrollKey = `${matchKey}|${c.cls.id}`
  const dupRow = seenEnrollment.has(enrollKey)
  seenEnrollment.add(enrollKey)
  plan.rows.push({
    line: r.line, csv: r, cls: c.cls, match: m, matchKey,
    student: m.student ? `${m.student.first_name} ${m.student.last_name} (existing — ${m.how})` : `${r.student_first} ${r.student_last} (NEW — ${m.how})`,
    enrollment: dupRow ? 'duplicate row in this file' : enrollmentExists ? 'exists' : 'create',
    scores: scores.map((s) => {
      const k = `${enrollKey}|${s.test_label}`
      const action = existingLabels.has(s.test_label) ? 'skip (exists)' : seenScore.has(k) ? 'skip (duplicate row in this file)' : 'insert'
      seenScore.add(k)
      return { ...s, action }
    }),
    attendance: num(r.attendance),
  })
}
const summary = {
  csvRows: rows.length,
  refused: plan.refused.length,
  classes: [...new Set(plan.rows.map((p) => p.cls.slug))],
  studentsMatched: plan.rows.filter((p) => p.match.student).length,
  studentsNew: plan.rows.filter((p) => !p.match.student).length,
  enrollmentsToCreate: plan.rows.filter((p) => p.enrollment === 'create').length,
  enrollmentsExisting: plan.rows.filter((p) => p.enrollment === 'exists').length,
  scoresToInsert: plan.rows.reduce((n, p) => n + p.scores.filter((s) => s.action === 'insert').length, 0),
  scoresSkipped: plan.rows.reduce((n, p) => n + p.scores.filter((s) => s.action !== 'insert').length, 0),
}
if (!JSON_OUT) {
  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — ${csvPath}`)
  for (const p of plan.rows) console.log(`  line ${p.line}: ${p.cls.slug} · ${p.student} · enrollment ${p.enrollment} · scores ${p.scores.map((s) => `${s.test_label}=${s.total} ${s.action}`).join(', ') || 'none'}${p.attendance != null ? ` · attended ${p.attendance}` : ''}`)
  for (const r of plan.refused) console.log(`  REFUSED line ${r.line}: ${r.reason}`)
  console.log('\n' + JSON.stringify(summary))
}

// --- apply ----------------------------------------------------------------------
const applied = { familiesCreated: 0, studentsCreated: 0, enrollmentsCreated: 0, scoresInserted: 0, errors: [] }
if (APPLY && plan.rows.length) {
  const out = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-build-import-scores-'))
  let upsertFamilyAndStudent
  try {
    execSync(`npx tsc app/utils/registration.ts app/utils/lifecycle.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`, { stdio: 'inherit' })
    Object.assign(process.env, env)
    ;({ upsertFamilyAndStudent } = createRequire(import.meta.url)(path.join(out, 'registration.js')))
  } finally { safeRm(out) }
  const createdThisRun = new Map()
  for (const p of plan.rows) {
    try {
      let studentId = p.match.student?.id ?? createdThisRun.get(p.matchKey) ?? null
      if (!studentId) {
        const r = p.csv
        const { count: famBefore } = await db.from('families').select('id', { count: 'exact', head: true }).ilike('parent_email', r.parent_email || r.student_email)
        const res = await upsertFamilyAndStudent({
          parentFirst: r.parent_first || 'Parent', parentLast: r.parent_last || r.student_last,
          parentEmail: norm(r.parent_email || r.student_email),
          studentFirst: r.student_first, studentLast: r.student_last, studentEmail: r.student_email ? norm(r.student_email) : null,
          schoolId: p.cls.school_id ?? null, graduatingYear: null,
        })
        if ('error' in res) { applied.errors.push({ line: p.line, error: res.error }); continue }
        studentId = res.studentId
        createdThisRun.set(p.matchKey, studentId)
        if (!famBefore) applied.familiesCreated++
        applied.studentsCreated++
      }
      if (p.enrollment === 'create') {
        const note = [`Imported from the historical Google Sheet (PL-504).`, p.attendance != null ? `Attended ${p.attendance} session${p.attendance === 1 ? '' : 's'} (sheet count).` : null].filter(Boolean).join(' ')
        const { error } = await db.from('enrollments').insert([{ student_id: studentId, class_id: p.cls.id, payment_status: 'Completed', enrolled_at: (p.scores[0]?.taken_at ?? p.cls.start_date ?? new Date().toISOString().slice(0, 10)) + 'T12:00:00Z', source: 'import', source_recorded_by: `sheet_import:${BY}`, comms_muted: true, notes: note }])
        if (error) { applied.errors.push({ line: p.line, error: error.message }); continue }
        applied.enrollmentsCreated++
      }
      const inserts = p.scores.filter((s) => s.action === 'insert').map((s) => ({ student_id: studentId, class_id: p.cls.id, test_label: s.test_label, section_scores: s.section_scores, total: s.total, taken_at: s.taken_at, source: 'sheet_import', recorded_by: BY }))
      if (inserts.length) {
        const { error } = await db.from('student_scores').insert(inserts)
        if (error) { applied.errors.push({ line: p.line, error: error.message }); continue }
        applied.scoresInserted += inserts.length
      }
    } catch (e) { applied.errors.push({ line: p.line, error: String(e?.message ?? e) }) }
  }
  if (!JSON_OUT) console.log('applied: ' + JSON.stringify(applied))
}
if (JSON_OUT) console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', summary, refused: plan.refused, rows: plan.rows.map((p) => ({ line: p.line, class: p.cls.slug, student: p.student, enrollment: p.enrollment, scores: p.scores.map((s) => `${s.test_label}:${s.action}`) })), applied: APPLY ? applied : null }))
process.exit(applied.errors.length ? 1 : 0)
