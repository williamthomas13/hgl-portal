#!/usr/bin/env node
// PL-476: past classes backfill — HGL's real history (the Squarespace store's
// 20 school classes) lands in the portal as ENDED classes so /classes "Recent
// classes" and the school code pages reflect it. PUBLIC HISTORY ONLY: no
// instructor, no enrollments, no pay, no emails (an ended class is quiet by
// the PL-471 rule — the run ends by proving it with the real projector).
//
//   node scripts/backfill-past-classes.mjs --json <file> [--dry-run] [--by <email>]
//
// JSON shape (Claude supplies the dates/times from the calendar images —
// never guessed here):
//   [{ "school": { "nickname": "ISM", "name": "International School of Milan",
//                  "city": "Milan", "timezone": "Europe/Rome", "code": "ism" },
//      "classType": "SAT Prep", "mode": "online" | "in_person", "logo": "path/to/logo.png" (optional),
//      "price": 749, "capacity": 20, "minEnrollment": 5,
//      "sessions": [{ "date": "2026-06-08", "start": "18:30", "end": "20:30" }, …] }, …]
//
// Creation goes THROUGH THE SAME PATH THE WIZARD USES (class-wizard.tsx
// createClass): slug = slugify("{nickname}-{classType}-{term}") with the
// same -2/-3 collision suffixing, course_key null for school classes,
// registration_close_date + enrollment_deadline before the first session,
// sessions rows from the JSON, practice_test_count 2, has_diagnostics true,
// status 'open' ("open" is a registration status — the class ENDED because
// its last session has passed, which is what /classes and the code resolver
// read). Idempotent: a school is matched by nickname OR evergreen code; a
// class by (school, class_type, first session date). Missing schools are
// created with NO contact (PL-467) — never a message goes to anyone.
//
// Runs only after PL-471 is on prod; Scarlett + Claude run it, not Code.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

// PL-487: cleanup must never decide the exit code — a sandboxed shell cannot
// delete files (EPERM at the END of an otherwise successful run); warn and go on.
function safeRm(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.warn(`note: could not remove temp dir ${dir} (${e?.code ?? e}) — harmless, delete it by hand`)
  }
}


const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
Object.assign(process.env, env)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const args = process.argv.slice(2)
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const jsonPath = arg('--json', null)
const dryRun = args.includes('--dry-run')
const by = arg('--by', 'backfill')
if (!jsonPath) { console.error('Need --json <file>.'); process.exit(1) }
const rows = JSON.parse(readFileSync(jsonPath, 'utf8'))
if (!Array.isArray(rows) || rows.length === 0) { console.error('JSON must be a non-empty array.'); process.exit(1) }

// --- the wizard's own helpers, copied verbatim (class-wizard.tsx) ---------------
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const termFor = (startDate) => {
  const m = Number(startDate.slice(5, 7)); const year = Number(startDate.slice(0, 4))
  const season = m <= 4 ? 'spring' : m <= 7 ? 'summer' : m <= 10 ? 'fall' : 'winter'
  return `${season}${String(year).slice(-2)}`
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const todayIso = new Date().toISOString().slice(0, 10)

// --- validate every row BEFORE touching anything --------------------------------
const problems = []
for (const [i, r] of rows.entries()) {
  const s = r.school ?? {}
  if (!s.nickname || !s.name || !s.timezone || !s.code) problems.push(`row ${i + 1}: school needs nickname, name, timezone, code`)
  if (!/^[a-z0-9-]{1,32}$/.test(String(s.code ?? ''))) problems.push(`row ${i + 1}: code "${s.code}" must be lowercase letters/digits/dashes`)
  if (!r.classType) problems.push(`row ${i + 1}: classType missing`)
  if (!['online', 'in_person'].includes(r.mode)) problems.push(`row ${i + 1}: mode must be online | in_person`)
  if (!Array.isArray(r.sessions) || r.sessions.length === 0) problems.push(`row ${i + 1}: sessions missing`)
  for (const [j, x] of (r.sessions ?? []).entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date ?? ''))) problems.push(`row ${i + 1} session ${j + 1}: date must be YYYY-MM-DD`)
    if (x.start && !/^\d{2}:\d{2}$/.test(x.start)) problems.push(`row ${i + 1} session ${j + 1}: start must be HH:MM`)
    if (x.end && !/^\d{2}:\d{2}$/.test(x.end)) problems.push(`row ${i + 1} session ${j + 1}: end must be HH:MM`)
    if (String(x.date ?? '') >= todayIso) problems.push(`row ${i + 1} session ${j + 1}: ${x.date} is not in the past — this script backfills ENDED classes only`)
  }
}
if (problems.length) { console.error('REFUSED — fix the JSON first:\n  ' + problems.join('\n  ')); process.exit(1) }

// --- plan ---------------------------------------------------------------------
const { data: schools } = await db.from('schools').select('id, nickname, name, city, timezone, evergreen_code, logo_url')
const { data: existingClasses } = await db.from('classes').select('id, school_id, class_type, slug, status, sessions ( session_date )')
const { data: codeClash } = await db.from('course_meta').select('course_key, evergreen_code')
const { data: legacy } = await db.from('legacy_redirects').select('code')
const plan = []
const seenInJson = new Set()
for (const r of rows) {
  const s = r.school
  const school = (schools ?? []).find((x) => x.nickname.toLowerCase() === s.nickname.toLowerCase() || (x.evergreen_code && x.evergreen_code === s.code))
  const dates = r.sessions.map((x) => x.date).sort()
  const first = dates[0]; const last = dates[dates.length - 1]
  const codeTakenBy = (schools ?? []).find((x) => x.evergreen_code === s.code && x.id !== school?.id) ?? (codeClash ?? []).find((c) => c.evergreen_code === s.code) ?? (legacy ?? []).find((l) => l.code === s.code)
  const item = { r, school, first, last, verdict: null, notes: [] }
  const jsonKey = `${s.nickname.toLowerCase()}|${r.classType}|${first}`
  if (seenInJson.has(jsonKey)) { item.verdict = 'SKIP'; item.notes.push('duplicate row in the JSON (same school, class type, first session)'); plan.push(item); continue }
  seenInJson.add(jsonKey)
  if (codeTakenBy && !school) { item.verdict = 'REFUSED'; item.notes.push(`code "${s.code}" already belongs to another school/course/legacy forward`) }
  else {
    const dup = school ? (existingClasses ?? []).find((c) => c.school_id === school.id && c.class_type === r.classType && (c.sessions ?? []).map((x) => x.session_date).sort()[0] === first) : null
    if (dup) { item.verdict = 'SKIP'; item.notes.push(`class exists (${dup.slug}, ${dup.status})`) }
    else item.verdict = school ? 'CREATE class' : 'CREATE school + class'
    if (school && !school.evergreen_code) item.notes.push(`school gets code "${s.code}"`)
    if (school && school.evergreen_code && school.evergreen_code !== s.code) item.notes.push(`school already has code "${school.evergreen_code}" — JSON says "${s.code}", keeping the existing code`)
    if (school && !school.city && s.city) item.notes.push(`school city set to "${s.city}"`)
    // PL-476: the evergreen validator's collision warning, kept — a code that
    // is a LIVE main-site page today (ism, isd, …) means the portal page wins
    // after the DNS flip; Scarlett retires those Squarespace pages deliberately.
    if (!school?.evergreen_code) {
      try {
        const probe = await fetch(`https://highergroundlearning.com/${s.code}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(6000) })
        if (probe.status === 200) item.notes.push(`WARN highergroundlearning.com/${s.code} is a live main-site page — after the flip hgl.co/${s.code} serves the portal page instead (retire the sqsp page deliberately)`)
      } catch { item.notes.push('(main-site collision probe unavailable)') }
    }
  }
  plan.push(item)
}
console.log(`Backfill plan${dryRun ? ' [DRY RUN]' : ''} — ${plan.length} row(s):`)
console.log('school | code | class | mode | first → last | sessions | verdict | notes')
for (const it of plan) {
  console.log(`${it.r.school.nickname} | ${it.r.school.code} | ${it.r.classType} | ${it.r.mode} | ${it.first} → ${it.last} | ${it.r.sessions.length} | ${it.verdict} | ${it.notes.join('; ') || '—'}`)
}
// PL-471 proof on the plan: every backfilled class is ENDED → quiet by the
// class rule (nothing class-keyed can send or write a calendar for it).
const tmp = mkdtempSync(path.join(process.cwd(), 'scripts', '.tmp-backfill-'))
let classQuietReason, projectSends
try {
  execSync(`npx tsc app/utils/class-quiet.ts app/utils/send-projection.ts app/utils/logo-process.ts --outDir ${JSON.stringify(tmp)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`, { stdio: 'pipe' })
  const req = createRequire(import.meta.url)
  ;({ classQuietReason } = req(path.join(tmp, 'class-quiet.js')))
  ;({ projectSends } = req(path.join(tmp, 'send-projection.js')))
} catch (e) { console.error('compile failed:', String(e.stdout ?? e)); process.exit(1) }
console.log('\nPL-471 quiet verdict per planned class (the class rule, evaluated on the JSON):')
for (const it of plan) {
  const reason = classQuietReason({ status: 'open', timezone: it.r.school.timezone, firstSession: it.first, lastSession: it.last, enrollments: [] })
  console.log(`  ${it.r.school.nickname} ${it.r.classType}: ${reason ?? 'NOT QUIET — refusing'}`)
  if (!reason) { console.error('A planned class is not quiet — aborting.'); safeRm(tmp); process.exit(1) }
}
if (dryRun) { safeRm(tmp); console.log('\nDry run — nothing written.'); process.exit(0) }

// --- apply --------------------------------------------------------------------
const created = []
const schoolsMade = new Map() // nickname → row created earlier in THIS run
for (const it of plan) {
  if (it.verdict === 'SKIP' || it.verdict === 'REFUSED') continue
  const s = it.r.school
  let school = it.school ?? schoolsMade.get(s.nickname.toLowerCase()) ?? null
  if (!school) {
    const { data, error } = await db.from('schools').insert([{ name: s.name, nickname: s.nickname, city: s.city ?? null, timezone: s.timezone, evergreen_code: s.code, collateral_language: 'en' }]).select('id, nickname, evergreen_code, logo_url').single()
    if (error) { console.error(`FAIL school ${s.nickname}: ${error.message}`); continue }
    school = data; schoolsMade.set(s.nickname.toLowerCase(), data); console.log(`created school ${s.nickname} (${s.code}) — no contact, no digests, nobody emailed`)
  } else {
    const patch = {}
    if (!school.evergreen_code) patch.evergreen_code = s.code
    if (!school.city && s.city) patch.city = s.city
    if (Object.keys(patch).length) await db.from('schools').update(patch).eq('id', school.id)
  }
  // PL-479: optional `logo` (a local file path Claude supplies) → the SAME
  // processing + storage path as the school-logo route (background flood
  // fill + trim via processLogo, `school-assets/{schoolId}/logo-{ts}.png`);
  // only when the school has no logo yet. Schools without one get the
  // monogram tile on /classes.
  if (s.logo && !school.logo_url) {
    try {
      const { processLogo, looksLikeImage } = req(path.join(tmp, 'logo-process.js'))
      const original = readFileSync(s.logo)
      if (!looksLikeImage(original)) throw new Error('not an image')
      const png = await processLogo(original)
      if (!png) throw new Error('empty after background removal')
      const key = `${school.id}/logo-${Date.now()}.png`
      const { error: upErr } = await db.storage.from('school-assets').upload(key, png, { contentType: 'image/png', cacheControl: '3600', upsert: true })
      if (upErr) throw upErr
      const { data: pub } = db.storage.from('school-assets').getPublicUrl(key)
      await db.from('schools').update({ logo_url: pub.publicUrl }).eq('id', school.id)
      school.logo_url = pub.publicUrl
      console.log(`  logo uploaded for ${s.nickname}`)
    } catch (e) {
      console.warn(`  logo for ${s.nickname} NOT uploaded (${e?.message ?? e}) — the school gets the monogram tile; re-run with a fixed file`)
    }
  }
  const sorted = [...it.r.sessions].sort((a, b) => a.date.localeCompare(b.date))
  const newClass = {
    class_type: it.r.classType,
    status: 'open',
    school_id: school.id,
    instructor_id: null,
    price: Number(it.r.price ?? 749),
    capacity: Number(it.r.capacity ?? 20),
    min_enrollment: Number(it.r.minEnrollment ?? (it.r.mode === 'online' ? 3 : 8)),
    start_date: it.first,
    default_location: it.r.mode === 'online' ? 'Live online' : (it.r.room ?? null),
    venue: it.r.mode === 'online' ? null : (it.r.venue ?? null),
    delivery_mode: it.r.mode,
    timezone: s.timezone,
    enrollment_deadline: addDays(it.first, -7),
    registration_close_date: addDays(it.first, -1),
    slug: slugify(`${school.nickname}-${it.r.classType}-${termFor(it.first)}`),
    course_key: null,
    practice_test_count: 2,
    has_diagnostics: true,
    created_by: by,
  }
  let { data: cls, error } = await db.from('classes').insert([newClass]).select('id, slug').single()
  for (let n = 2; error?.code === '23505' && n <= 5; n++) {
    ;({ data: cls, error } = await db.from('classes').insert([{ ...newClass, slug: `${newClass.slug}-${n}` }]).select('id, slug').single())
  }
  if (error || !cls) { console.error(`FAIL class ${s.nickname} ${it.r.classType}: ${error?.message}`); continue }
  const { error: sessErr } = await db.from('sessions').insert(sorted.map((x) => ({ class_id: cls.id, session_date: x.date, start_time: x.start ? `${x.start}:00` : null, end_time: x.end ? `${x.end}:00` : null, location: x.location ?? null })))
  if (sessErr) { await db.from('classes').delete().eq('id', cls.id); console.error(`FAIL sessions for ${cls.slug} — class rolled back: ${sessErr.message}`); continue }
  created.push({ id: cls.id, slug: cls.slug, label: `${s.nickname} ${it.r.classType}` })
  console.log(`created ${cls.slug} (${sorted.length} sessions, ${it.first} → ${it.last})`)
}

// --- the PL-471 D projector on the REAL rows: zero sends, zero writes ----------
console.log('\nPL-471 D projection (30 days) over the created rows:')
let projected = 0
for (const c of created) {
  const rep = await projectSends({ hours: 24 * 30, classId: c.id })
  projected += rep.rows.length
  console.log(`  ${c.label}: ${rep.rows.length} projected send(s)/write(s) — ${rep.quiet.find((q) => q.classId === c.id)?.reason ?? 'not marked quiet'}`)
}
safeRm(tmp)
console.log(`\nDone — ${created.length} class(es) created; projector total: ${projected} (expected 0).`)
process.exit(projected === 0 ? 0 : 2)
