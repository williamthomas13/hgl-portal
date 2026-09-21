#!/usr/bin/env node
// PL-477 (3): land the MailerLite College Prep Compass list as portal
// marketing subscribers — source + ORIGINAL opt-in date carried over, de-duped
// against families and leads by email (LINKED, never duplicated), and NEVER
// re-adding an unsubscribed address: any email present in
// marketing_suppressions (the PL-363 C import + the portal's own unsubscribes)
// is skipped and counted. Imported subscribers receive NOTHING until Scarlett
// sends a campaign that targets subscribers (the "Compass subscribers" chip).
//
//   node scripts/import-mailerlite-subscribers.mjs --csv <subscribers.csv> [--dry-run]
//
// Any MailerLite CSV works: needs an email column; uses "name"/"first name",
// "subscribed_at"/"opt-in"/"created"/"date" for the original opt-in when
// present. Idempotent: an existing subscriber row is left untouched.
// Run AFTER scripts/import-mailerlite-suppressions.mjs — the script refuses
// to run while marketing_suppressions is EMPTY (that means the unsubscribes
// have not landed yet), unless --allow-empty-suppressions is passed.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const args = process.argv.slice(2)
const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null
const dryRun = args.includes('--dry-run')
if (!csvPath) { console.error('Need --csv <file>.'); process.exit(1) }

// Minimal CSV parser (quoted fields, commas inside quotes).
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += ch
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}
const rows = parseCsv(readFileSync(csvPath, 'utf8'))
const headers = rows[0].map((h) => h.trim().toLowerCase())
const col = (...names) => headers.findIndex((h) => names.some((n) => h === n || h.includes(n)))
const emailCol = col('email')
const nameCol = col('first name', 'first_name', 'name')
const dateCol = col('subscribed_at', 'subscribed', 'opt-in', 'optin', 'signup', 'created', 'date')
if (emailCol < 0) { console.error(`No email column found in: ${headers.join(' | ')}`); process.exit(1) }

const { count: suppCount } = await db.from('marketing_suppressions').select('email', { count: 'exact', head: true })
if (!suppCount && !args.includes('--allow-empty-suppressions')) {
  console.error('REFUSED: marketing_suppressions is EMPTY — run scripts/import-mailerlite-suppressions.mjs with the MailerLite unsubscribed export FIRST (or pass --allow-empty-suppressions if the list truly has no unsubscribes).')
  process.exit(1)
}
const { data: supp } = await db.from('marketing_suppressions').select('email')
const suppressed = new Set((supp ?? []).map((s) => s.email.toLowerCase()))
const { data: existing } = await db.from('marketing_subscribers').select('email')
const have = new Set((existing ?? []).map((s) => s.email.toLowerCase()))
const { data: fams } = await db.from('families').select('id, parent_email')
const famByEmail = new Map((fams ?? []).map((f) => [String(f.parent_email).toLowerCase(), f.id]))
const { data: leads } = await db.from('leads').select('id, contact_email').not('contact_email', 'is', null)
const leadByEmail = new Map((leads ?? []).map((l) => [String(l.contact_email).toLowerCase(), l.id]))

const batch = `mailerlite-${new Date().toISOString().slice(0, 10)}`
const stats = { total: 0, added: 0, existing: 0, suppressed: 0, linkedFamily: 0, linkedLead: 0, invalid: 0 }
const seen = new Set()
for (const r of rows.slice(1)) {
  const email = (r[emailCol] ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) { stats.invalid++; continue }
  if (seen.has(email)) continue
  seen.add(email); stats.total++
  if (suppressed.has(email)) { stats.suppressed++; continue }
  if (have.has(email)) { stats.existing++; continue }
  const firstName = nameCol >= 0 ? (r[nameCol] ?? '').trim().split(/\s+/)[0] || null : null
  const rawDate = dateCol >= 0 ? (r[dateCol] ?? '').trim() : ''
  const optIn = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null
  const familyId = famByEmail.get(email) ?? null
  const leadId = familyId ? null : (leadByEmail.get(email) ?? null)
  if (familyId) stats.linkedFamily++
  if (leadId) stats.linkedLead++
  if (dryRun) { stats.added++; continue }
  const { error } = await db.from('marketing_subscribers').insert([{
    email, first_name: firstName, source: 'mailerlite-import', original_opt_in_at: optIn, consented_at: optIn,
    family_id: familyId, lead_id: leadId, imported_batch: batch,
  }])
  if (!error) stats.added++
  else if (error.code === '23505') stats.existing++
  else console.error(`FAIL ${email}: ${error.message}`)
}
console.log(`${dryRun ? '[DRY RUN] ' : ''}${stats.total} unique addresses — ${stats.added} ${dryRun ? 'would be added' : 'added'} · ${stats.existing} already subscribers · ${stats.suppressed} SKIPPED (unsubscribed — never re-added) · ${stats.linkedFamily} linked to a family · ${stats.linkedLead} linked to a lead · ${stats.invalid} invalid rows. No email is sent by this import.`)
