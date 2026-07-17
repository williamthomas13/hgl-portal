#!/usr/bin/env node
// PL-34: one-time QBO → portal family importer.
//
//   node scripts/import-qbo-families.mjs            # dry run (default): lists what would happen
//   node scripts/import-qbo-families.mjs --apply    # actually create the missing families
//
// Pulls Customers from the connected QuickBooks company (sandbox or prod —
// whatever the portal is connected to) and creates a portal family for each
// one that has an email and no existing family row. Matching is by parent
// email (the Phase 6 decision), so re-running never duplicates. QBO knows
// families, not students — Kelsie adds the student(s) per family afterwards.
//
// Runs the app's own QBO client (compiled on the fly with the repo's
// TypeScript), so token refresh/rotation behaves exactly like the portal.
// Requires .env.local (or the same vars in the environment).

import { execSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apply = process.argv.includes('--apply')

// Load .env.local into the environment (values may contain '=').
const envPath = path.join(root, '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0 && !line.trimStart().startsWith('#')) {
      const k = line.slice(0, i).trim()
      if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim()
    }
  }
}

// Compile the QBO client + supabase admin util to CJS in a temp dir.
const out = mkdtempSync(path.join(tmpdir(), 'hgl-qbo-import-'))
execSync(
  `npx tsc app/utils/qbo.ts app/utils/supabase-admin.ts --outDir ${JSON.stringify(out)} ` +
    `--module commonjs --target es2022 --skipLibCheck --esModuleInterop`,
  { cwd: root, stdio: 'inherit' }
)
const require_ = createRequire(import.meta.url)
process.env.NODE_PATH = path.join(root, 'node_modules')
require_('node:module').Module._initPaths()
const { qboQuery } = require_(path.join(out, 'qbo.js'))
const { supabaseAdmin } = require_(path.join(out, 'supabase-admin.js'))

// Page through every active Customer.
const customers = []
for (let start = 1; ; start += 100) {
  const qr = await qboQuery(`select * from Customer startposition ${start} maxresults 100`)
  const batch = qr.Customer ?? []
  customers.push(...batch)
  if (batch.length < 100) break
}
console.log(`QBO returned ${customers.length} customer(s)`)

const { data: families } = await supabaseAdmin.from('families').select('id, parent_email')
const known = new Set((families ?? []).map((f) => String(f.parent_email).trim().toLowerCase()))

let created = 0
let skippedNoEmail = 0
let matched = 0
for (const c of customers) {
  const email = c.PrimaryEmailAddr?.Address?.trim().toLowerCase()
  const label = c.DisplayName ?? `${c.GivenName ?? ''} ${c.FamilyName ?? ''}`.trim()
  if (!email) {
    skippedNoEmail++
    console.log(`  skip (no email): ${label}`)
    continue
  }
  if (known.has(email)) {
    matched++
    continue
  }
  // Names: prefer the structured fields; fall back to splitting DisplayName
  // (QBO DisplayNames often carry the email — strip anything with an @).
  const displayWords = (c.DisplayName ?? '').split(/\s+/).filter((w) => w && !w.includes('@'))
  const first = c.GivenName?.trim() || displayWords[0] || email
  const last = c.FamilyName?.trim() || displayWords.slice(1).join(' ') || null
  const phone = c.PrimaryPhone?.FreeFormNumber?.trim() || null

  if (!apply) {
    console.log(`  would create: ${first} ${last ?? ''} <${email}>${phone ? ` · ${phone}` : ''}`)
    created++
    continue
  }
  const { error } = await supabaseAdmin.from('families').insert([
    {
      parent_first_name: first,
      parent_last_name: last,
      parent_email: email,
      parent_phone: phone,
    },
  ])
  if (error) {
    console.error(`  FAILED for ${email}: ${error.message}`)
  } else {
    console.log(`  created: ${first} ${last ?? ''} <${email}>`)
    created++
  }
  known.add(email)
}

console.log(
  `\n${apply ? 'Created' : 'Would create'} ${created} famil${created === 1 ? 'y' : 'ies'} · ` +
    `${matched} already exist (matched by email) · ${skippedNoEmail} skipped without an email` +
    (apply ? '' : '\nRe-run with --apply to create them. Kelsie adds the student(s) per family afterwards.')
)
