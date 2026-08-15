#!/usr/bin/env node
// PL-363 C: land the MailerLite UNSUBSCRIBE list in the portal's suppression
// handling BEFORE any campaign sends (the suppression gate in sendOnce
// honors marketing_suppressions at the choke point). Takes the MailerLite
// unsubscribed-subscribers CSV export (any CSV with an email column works).
// Idempotent: existing rows are left untouched (email is the primary key).
//
// Usage: node scripts/import-mailerlite-suppressions.mjs --csv <file.csv> [--dry-run]
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
const csvIdx = args.indexOf('--csv')
const csvPath = csvIdx >= 0 ? args[csvIdx + 1] : null
const dryRun = args.includes('--dry-run')
if (!csvPath) { console.error('Need --csv <file>.'); process.exit(1) }

const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean)
const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
const emailCol = headers.findIndex((h) => /e-?mail/i.test(h))
if (emailCol < 0) { console.error(`No email column found in: ${headers.join(' | ')}`); process.exit(1) }

const emails = [...new Set(
  lines.slice(1)
    .map((l) => l.split(',')[emailCol]?.trim().replace(/^"|"$/g, '').toLowerCase())
    .filter((e) => e && e.includes('@'))
)]
console.log(`${emails.length} unique unsubscribed addresses${dryRun ? ' [DRY RUN]' : ''}`)
if (dryRun) process.exit(0)

let added = 0
for (const email of emails) {
  const { error } = await db.from('marketing_suppressions').insert([{
    email,
    reason: 'unsubscribed',
    source: 'mailerlite-import',
  }])
  if (!error) added++
  else if (error.code !== '23505') console.error(`FAIL ${email}: ${error.message}`)
}
console.log(`Done — ${added} added, ${emails.length - added} already suppressed.`)
