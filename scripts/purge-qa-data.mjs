#!/usr/bin/env node
// PL-48 → PL-458: the ONE cutover purge. "Everything transactional goes,
// configuration stays." DO NOT run casually — part of the cutover runbook
// (docs/cutover-decommission-checklist.md step 3b).
//
//   node scripts/purge-qa-data.mjs             # DRY RUN (default): counts + every class row, nothing deleted
//   node scripts/purge-qa-data.mjs --snapshot-only  # guards + snapshot file, no deletes (rehearsal of D)
//   node scripts/purge-qa-data.mjs --apply     # snapshot → delete (Scarlett + Claude run this together)
//
// Why whole-table (PL-458, Sep 20): the July name-list approach is obsolete —
// a read-only prod inventory showed every family, lead, contact, engagement,
// invoice, score, sync-log row and email send in this database is QA- or
// staff-addressed. No real family has ever been in it. So the transactional
// tables are wiped WHOLE, in FK-safe order, plus the class rows Scarlett
// lists in PURGE_CLASS_IDS (she decides per class; the dry run prints every
// class row with status, dates, enrollment count so she can).
//
// KEPT, never touched: schools, instructors (+ tutor_notes — staff notes on
// the instructor rows), templates + versions, app_settings, staff prefs +
// alert subscriptions, saved segments, tutoring_offers, tutoring_packages,
// products, subjects, agreement_templates, short_links / evergreen codes /
// course_meta / short_link_clicks, site content blocks not tied to a purged
// class, logos/crests + storage objects, gcal + qbo connections, admin/
// manager profiles, team_access_audit, and every class not listed.
//
// Guards (C): refuses to run at all — even dry — past CUTOFF_DATE; refuses
// --apply if any enrollment is a cutover import, if any stored Stripe
// PaymentIntent is NOT a test-mode object, if the Stripe key is live, or if
// QuickBooks points at production. Snapshot (D): --apply first writes every
// row it is about to delete to a gitignored local JSON file and aborts if
// that write fails. External systems are left alone on purpose: Stripe test
// PaymentIntents, QBO sandbox documents, storage files, and the gcal events
// of deleted QA sessions (sweep Billy's tutor calendar by hand).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
// --snapshot-only: everything --apply does UP TO the first delete (guards +
// snapshot file), then stops. Proves D without touching a row.
const SNAPSHOT_ONLY = process.argv.includes('--snapshot-only')

// ---- review at cutover -------------------------------------------------------
// C: hard stop. After this date the script refuses to run in ANY mode — once
// real families are in, a purge must be a deliberate new decision, not a
// stale runbook step.
const CUTOFF_DATE = '2026-10-15'

// G (Scarlett, Sep 20): keep ONLY mis-sat-prep-fall26. Every other class row
// that existed on Sep 20 goes. Classes created AFTER Sep 20 (the real SLS /
// ASF / Leone XIII cohorts she is adding) are NOT listed and are KEPT — the
// dry run flags them so she can add an id here if one should go too.
const KEEP_CLASS_IDS = [
  'f7446506-aa14-4729-bba5-e563f378f6b2', // mis-sat-prep-fall26 (Tue/Thu Sep 8→Oct 1 — verified vs hgl.co/mis)
]
const PURGE_CLASS_IDS = [
  'ef4b8ae6-0d04-4cfd-a44f-a4e25e0a7f3c', // asf-sat-prep-spring26 (April QA cohort, 0 sessions)
  'a996f604-9731-4b9c-8f94-2b2938caf872', // mis-sat-prep-summer26 (July, cancelled QA cohort)
  'ca303f03-fca4-419c-8a4c-56e45ea54885', // colegio-nido-de-aguilas-sat-prep-fall26 (cancelled)
  '5fac1a68-1b4f-4064-b456-425518636b1f', // sls-sat-prep-fall26 (Aug 5–8, cancelled — NOT the current SLS cohort)
  'aaa5490f-1609-4699-aad3-9b19a2628d75', // psat-prep-fall26
  'efa3ae76-f99c-49b5-8379-9648559ce146', // sat-deep-dive-mastering-the-reading-and-writing-sections-fall26 (cancelled)
  '20f41e6b-3645-4995-ad64-a814f1ac16cc', // american-international-school-of-cape-town-sat-prep-fall26 (cancelled)
  '38d79c4f-0fd4-4a35-9f21-c93da00fc324', // isd-sat-prep-fall26
  '5f8a66de-d947-4c56-a263-f3894a6212de', // sat-deep-dive-mastering-advanced-math-concepts-winter26
]
// E: QA parent logins go; staff logins never do. Eric Brown is HGL's
// manager + an instructor (role promoted to manager on prod Sep 20).
const PROTECTED_LOGINS = ['eric@highergroundlearning.com']
// -----------------------------------------------------------------------------

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim()
      let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const today = new Date().toISOString().slice(0, 10)

// ---- C: guards --------------------------------------------------------------
if (today > CUTOFF_DATE) {
  console.error(`REFUSED: today (${today}) is past the purge cutoff ${CUTOFF_DATE}. This runbook step is over — a purge after launch is a new decision, not this script.`)
  process.exit(2)
}

async function applyGuards() {
  const why = []
  const { count: imported } = await db.from('enrollments').select('id', { count: 'exact', head: true }).eq('source', 'import')
  if ((imported ?? 0) > 0) why.push(`${imported} enrollment(s) have source='import' — the cutover import has already run; purging now would delete real families.`)
  if ((env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_')) why.push('STRIPE_SECRET_KEY is a LIVE key — Stripe is already live.')
  if ((env.QBO_ENVIRONMENT ?? 'sandbox') === 'production') why.push('QBO_ENVIRONMENT=production — QuickBooks is already out of sandbox.')
  const { data: qbo } = await db.from('qbo_connection').select('realm_name, status').limit(1).maybeSingle()
  if (qbo?.status === 'connected' && qbo.realm_name && !/sandbox/i.test(qbo.realm_name)) why.push(`QuickBooks is connected to a non-sandbox company ("${qbo.realm_name}").`)
  // Every stored PaymentIntent must be a TEST-mode object: retrieve each with
  // the test key — a live-mode id comes back resource_missing.
  const { data: pis } = await db.from('enrollments').select('id, stripe_payment_intent_id').not('stripe_payment_intent_id', 'is', null)
  const ids = [...new Set((pis ?? []).map((e) => e.stripe_payment_intent_id).filter(Boolean))]
  if (ids.length > 0) {
    if (!env.STRIPE_SECRET_KEY) why.push(`${ids.length} PaymentIntent id(s) stored but no STRIPE_SECRET_KEY to verify they are test-mode.`)
    else {
      for (const pi of ids) {
        const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(pi)}`, {
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        })
        if (res.status === 404) why.push(`PaymentIntent ${pi} is not a test-mode object (a LIVE payment is in this database).`)
        else if (!res.ok) why.push(`PaymentIntent ${pi} could not be verified (Stripe ${res.status}).`)
        else {
          const json = await res.json()
          if (json.livemode === true) why.push(`PaymentIntent ${pi} is livemode.`)
        }
      }
    }
  }
  return why
}

// ---- helpers ----------------------------------------------------------------
const CHUNK = 100
const chunks = (arr) => {
  const out = []
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK))
  return out
}
let total = 0
const snapshot = {}
const plan = []

/** Read every row a wipe would delete (paged), stash it in the snapshot. */
async function readAll(table, applyFilter) {
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await applyFilter(db.from(table).select('*')).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

/** Whole-table wipe. Deleted by key column in chunks (most tables key on
 *  `id`; the two drift tables key on session_id). */
const KEY_COLUMN = { calendar_drift: 'session_id', calendar_drift_alert_ledger: 'session_id' }
function wipeAll(table, label) {
  plan.push({ table, label, key: KEY_COLUMN[table] ?? 'id' })
}
/** Wipe rows whose `column` is in `ids` — CHUNKED (A: the unchunked .in()
 *  was the URL-too-long bug that crashed the Sep 20 dry run). */
function wipeIn(table, label, column, ids) {
  plan.push({ table, label, column, ids })
}

async function runPlan() {
  for (const step of plan) {
    let rows
    try {
      if (step.ids) {
        rows = []
        for (const part of chunks(step.ids)) rows.push(...(await readAll(step.table, (q) => q.in(step.column, part))))
      } else {
        rows = await readAll(step.table, (q) => q)
      }
    } catch (e) {
      console.log(`  !! ${step.table} (${step.label}): ${e.message}`)
      continue
    }
    total += rows.length
    snapshot[step.table] = [...(snapshot[step.table] ?? []), ...rows]
    console.log(`  ${APPLY ? 'deleting' : 'would delete'} ${String(rows.length).padStart(5)} × ${step.table} (${step.label})`)
    if (APPLY && rows.length > 0) {
      // Class-scoped wipes delete by the SAME chunked filter they were read
      // with (composite-keyed tables included); whole-table wipes delete by
      // their key column in chunks — the exact rows the snapshot holds.
      const column = step.ids ? step.column : step.key
      const values = step.ids ? step.ids : [...new Set(rows.map((r) => r[column]))]
      for (const part of chunks(values)) {
        const { error } = await db.from(step.table).delete().in(column, part)
        if (error) console.log(`  !! delete failed for ${step.table}: ${error.message}`)
      }
    }
  }
}

console.log(APPLY ? `APPLY MODE — purging transactional data (${today})\n` : `DRY RUN — nothing will be deleted (pass --apply at cutover)\n`)

// ---- the class decisions (G) ------------------------------------------------
const { data: classes } = await db
  .from('classes')
  .select('id, slug, class_type, status, start_date, created_at, schools ( nickname ), sessions ( session_date ), enrollments ( id, payment_status, source )')
  .order('start_date')
console.log('Class rows on prod (KEEP / PURGE / NEW = created after Sep 20 and not listed → kept unless you add it):')
const purgeClassIds = []
const unknownNew = []
for (const c of classes ?? []) {
  const d = (c.sessions ?? []).map((s) => s.session_date).sort()
  const verdict = KEEP_CLASS_IDS.includes(c.id) ? 'KEEP ' : PURGE_CLASS_IDS.includes(c.id) ? 'PURGE' : 'NEW  '
  if (verdict === 'PURGE') purgeClassIds.push(c.id)
  if (verdict === 'NEW  ') unknownNew.push(c)
  console.log(
    `  ${verdict} ${c.id} ${(c.slug ?? '-').padEnd(60)} ${c.status.padEnd(9)} ${d[0] ?? '—'}..${d[d.length - 1] ?? '—'} (${d.length} sessions) enr=${(c.enrollments ?? []).length}${(c.enrollments ?? []).some((e) => e.source === 'import') ? ' IMPORTED' : ''} created ${c.created_at.slice(0, 10)}`
  )
}
for (const id of PURGE_CLASS_IDS) if (!(classes ?? []).some((c) => c.id === id)) console.log(`  (already gone) ${id}`)
if (unknownNew.length) console.log(`  ${unknownNew.length} class row(s) not in either list — KEPT. Add an id to PURGE_CLASS_IDS if one should go.`)
console.log('')

// ---- E: QA logins ------------------------------------------------------------
const { data: profiles } = await db.from('profiles').select('id, email, role')
const parentProfiles = (profiles ?? []).filter((p) => p.role === 'parent' && !PROTECTED_LOGINS.includes(p.email))
console.log(`Logins: ${parentProfiles.length} parent-role profile(s) + their auth users go: ${parentProfiles.map((p) => p.email).join(', ') || '(none)'}`)
for (const p of (profiles ?? []).filter((p) => p.role !== 'parent' || PROTECTED_LOGINS.includes(p.email))) console.log(`  kept: ${p.email} (${p.role})`)
console.log('')

// ---- the wipe plan, FK-safe order (leaves → roots) ---------------------------
// Everything here is transactional by construction; comments say why where
// it isn't obvious. Cascades would take most of it anyway — listing every
// table means the snapshot holds every row and the counts are honest.
wipeAll('email_events', 'delivery events (address-keyed)')
wipeAll('email_sends', 'the send log — chunked by id (A)')
wipeAll('email_log', 'legacy send log')
wipeAll('campaign_recipients', 'campaign recipients')
wipeAll('campaigns', 'campaign runs (the FO run was QA)')
wipeAll('class_survey_responses', 'survey responses')
wipeAll('attendance_records', 'attendance')
wipeAll('availability_changes', 'availability change log')
wipeAll('calendar_drift_alert_ledger', 'drift alert ledger')
wipeAll('calendar_drift', 'drift rows (QA sessions)')
wipeAll('call_events', 'call log')
wipeAll('coverage_requests', 'coverage requests')
wipeAll('session_notes', 'tutor session notes (QA sessions)')
wipeAll('tutor_pending_notices', 'coalesced tutor notices (QA sessions)')
wipeAll('generation_failures', 'invoice generation failures')
wipeAll('product_orders', 'notebook orders')
wipeAll('record_matches', 'same-person prompts')
wipeAll('family_fact_edits', 'self-service edit trail')
wipeAll('student_materials', 'student materials (rows only — storage files stay; clean the bucket by hand if it matters)')
wipeAll('tutoring_schedule_drafts', 'schedule drafts')
wipeAll('dashboard_notes', 'dashboard sticky notes (all QA-era, all cleared)')
wipeAll('class_interest', '"tell me when a class opens" sign-ups (QA)')
wipeAll('qbo_sync_log', 'QBO sync log (portal rows only — sandbox docs stay)')
wipeAll('gcal_sync_log', 'gcal sync log')
wipeAll('timecards', 'timecards (every one is QA-derived)')
wipeAll('tutoring_invoice_lines', 'invoice lines')
wipeAll('tutoring_sessions', 'tutoring sessions')
wipeAll('tutoring_invoices', 'invoices')
wipeAll('tutoring_engagements', 'tutoring schedules')
wipeAll('enrollment_addons', 'add-ons')
wipeAll('enrollments', 'enrollments')
wipeAll('agreement_acceptances', 'agreement acceptances')
wipeAll('student_availability', 'availability windows')
wipeAll('student_scores', 'scores')
wipeAll('leads', 'leads (incl. the null-email ones the old email match missed)')
wipeAll('students', 'students')
wipeAll('families', 'families')
wipeAll('school_affiliations', 'school-contact affiliations (all QA/Billy aliases)')
wipeAll('contacts', 'contacts (all QA/Billy aliases)')
wipeAll('school_counselors', 'legacy counselors')
// Purged classes last (their enrollments are already gone above).
wipeIn('classroom_requests', 'purged classes', 'class_id', purgeClassIds)
wipeIn('class_page_daily', 'purged classes (page analytics)', 'class_id', purgeClassIds)
wipeIn('site_content_blocks', 'purged classes (class-scoped blocks only — global blocks stay)', 'class_id', purgeClassIds)
wipeIn('sessions', 'purged classes', 'class_id', purgeClassIds)
wipeIn('classes', 'PURGE_CLASS_IDS', 'id', purgeClassIds)

// ---- dry run: count only -------------------------------------------------------
if (!APPLY && !SNAPSHOT_ONLY) {
  await runPlan()
  console.log(`\nWould delete ${total} rows total + ${parentProfiles.length} parent login(s).`)
  const why = await applyGuards()
  console.log(why.length ? `\n--apply would be REFUSED:\n  - ${why.join('\n  - ')}` : '\n--apply guards: clear (no imports, Stripe test-mode only, QuickBooks sandbox).')
  await postCheck()
  process.exit(0)
}

// ---- apply: guards → snapshot → delete -------------------------------------------
const why = await applyGuards()
if (why.length) {
  console.error(`REFUSED --apply:\n  - ${why.join('\n  - ')}`)
  process.exit(2)
}
// Read everything first (the snapshot must be complete BEFORE any delete).
const readOnlyPlan = plan.slice()
for (const step of readOnlyPlan) {
  const rows = step.ids
    ? (await Promise.all(chunks(step.ids).map((part) => readAll(step.table, (q) => q.in(step.column, part))))).flat()
    : await readAll(step.table, (q) => q)
  snapshot[step.table] = rows
}
snapshot.profiles = parentProfiles
const dir = path.join(process.cwd(), 'scripts')
const file = path.join(dir, `.tmp-purge-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
try {
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(snapshot, null, 1))
  const back = JSON.parse(readFileSync(file, 'utf8'))
  const n = Object.values(back).reduce((a, rows) => a + rows.length, 0)
  console.log(`Snapshot written: ${file} (${n} rows across ${Object.keys(back).length} tables — gitignored)\n`)
} catch (e) {
  console.error(`ABORTED: snapshot write failed (${e.message}). Nothing was deleted.`)
  process.exit(3)
}
if (SNAPSHOT_ONLY) {
  console.log('--snapshot-only: stopping before any delete. Nothing was deleted.')
  process.exit(0)
}
// Snapshot already holds the rows — runPlan re-reads (cheap) and deletes by key.
Object.keys(snapshot).forEach((k) => (snapshot[k] = []))
await runPlan()
// E: logins.
for (const p of parentProfiles) {
  const { error: pe } = await db.from('profiles').delete().eq('id', p.id)
  const { error: ae } = await db.auth.admin.deleteUser(p.id)
  console.log(`  login removed: ${p.email}${pe ? ` (profile: ${pe.message})` : ''}${ae ? ` (auth: ${ae.message})` : ''}`)
}
console.log(`\nDeleted ${total} rows + ${parentProfiles.length} login(s). Snapshot: ${file}`)
await postCheck()

// ---- F: what the dry run must show afterwards -------------------------------------
async function postCheck() {
  const counts = {}
  for (const t of ['families', 'leads', 'contacts', 'email_sends', 'enrollments', 'students', 'tutoring_engagements', 'tutoring_invoices']) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true })
    counts[t] = count ?? 0
  }
  const { data: left } = await db.from('classes').select('id, slug, status, start_date').order('start_date')
  console.log(`\nState now: ${Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(' · ')}`)
  console.log(`Surviving class rows: ${(left ?? []).map((c) => `${c.slug ?? c.id} (${c.status}, ${c.start_date ?? '—'})`).join(' · ') || '(none)'}`)
}
