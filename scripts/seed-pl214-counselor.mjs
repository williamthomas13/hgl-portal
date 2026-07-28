#!/usr/bin/env node
// PL-214: (1) seed CS_CLASS_CONFIRMED from the batch-22 appendix copy and
// set it LIVE — the copy is Scarlett's final text verbatim, the send is a
// manual admin button, and there is deliberately no code twin. (2) publish
// a new CD_COUNSELOR_DIGEST version adding the one-line portal pointer,
// patching the CURRENT active body (never re-seeding over edits) with an
// exact-string anchor guard. Idempotent both ways.
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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// --- 1) CS_CLASS_CONFIRMED from the seed file ------------------------------
const out = path.join(process.cwd(), 'scripts', '.tmp-build-seed-pl214')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-template-seed.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { TEMPLATE_SEEDS } = require(path.join(out, 'comms-template-seed.js'))
const seed = TEMPLATE_SEEDS.find((t) => t.template_key === 'CS_CLASS_CONFIRMED')
if (!seed) { console.error('FAIL: CS_CLASS_CONFIRMED not in TEMPLATE_SEEDS'); process.exit(1) }

const { data: existingCs } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', 'CS_CLASS_CONFIRMED')
  .maybeSingle()
if (!existingCs) {
  const { error } = await db.from('email_templates').insert([{
    template_key: seed.template_key,
    display_name: seed.display_name,
    sequence_number: seed.sequence_number,
    audience: seed.audience,
    from_identity: seed.from_identity,
    category: seed.category,
    live: true, // final approved copy; the send itself is a manual button
  }])
  if (error) { console.error(`FAIL CS insert: ${error.message}`); process.exit(1) }
  console.log('created CS_CLASS_CONFIRMED (live)')
}
const { data: csVersions } = await db
  .from('email_template_versions')
  .select('id, version_number, subject, preheader, body_markdown, footer_note')
  .eq('template_key', 'CS_CLASS_CONFIRMED')
  .order('version_number', { ascending: false })
  .limit(1)
const csLatest = csVersions?.[0]
const csSame =
  csLatest &&
  csLatest.subject === seed.subject &&
  (csLatest.preheader ?? null) === (seed.preheader ?? null) &&
  csLatest.body_markdown === seed.body_markdown &&
  (csLatest.footer_note ?? null) === (seed.footer_note ?? null)
if (csSame) {
  console.log(`unchanged CS_CLASS_CONFIRMED v${csLatest.version_number}`)
} else {
  const nextNumber = (csLatest?.version_number ?? 0) + 1
  const { data: ins, error: vErr } = await db
    .from('email_template_versions')
    .insert([{
      template_key: 'CS_CLASS_CONFIRMED',
      version_number: nextNumber,
      subject: seed.subject,
      preheader: seed.preheader,
      body_markdown: seed.body_markdown,
      footer_note: seed.footer_note,
      notes: "PL-214: Scarlett's final copy, verbatim (batch-22 appendix)",
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (vErr) { console.error(`FAIL CS version: ${vErr.message}`); process.exit(1) }
  const { error: pErr } = await db
    .from('email_templates')
    .update({ active_version_id: ins.id, updated_at: new Date().toISOString() })
    .eq('template_key', 'CS_CLASS_CONFIRMED')
  if (pErr) { console.error(`FAIL CS repoint: ${pErr.message}`); process.exit(1) }
  console.log(`seeded CS_CLASS_CONFIRMED v${nextNumber} (live)`)
}

// --- 2) CD portal line, patched into the CURRENT active body ---------------
const LINE = 'See live counts and scores any time — sign in at [{portalLink}]({portalLink}) with this email.'
const ANCHOR = '{digestClassListBlock}'
const { data: cd } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', 'CD_COUNSELOR_DIGEST')
  .single()
const { data: cdv } = await db
  .from('email_template_versions')
  .select('version_number, subject, preheader, body_markdown, footer_note')
  .eq('id', cd.active_version_id)
  .single()
if (cdv.body_markdown.includes('See live counts and scores')) {
  console.log(`unchanged CD_COUNSELOR_DIGEST v${cdv.version_number} — portal line already present`)
} else if (!cdv.body_markdown.includes(ANCHOR)) {
  console.error(`FAIL CD v${cdv.version_number}: anchor {digestClassListBlock} not found — patch by hand.`)
  process.exit(1)
} else {
  const nextBody = cdv.body_markdown.replace(ANCHOR, `${ANCHOR}\n\n${LINE}`)
  const nextNumber = cdv.version_number + 1
  const { data: ins, error: vErr } = await db
    .from('email_template_versions')
    .insert([{
      template_key: 'CD_COUNSELOR_DIGEST',
      version_number: nextNumber,
      subject: cdv.subject,
      preheader: cdv.preheader,
      body_markdown: nextBody,
      footer_note: cdv.footer_note,
      notes: 'PL-214: one-line portal pointer after the class list',
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (vErr) { console.error(`FAIL CD version: ${vErr.message}`); process.exit(1) }
  const { error: pErr } = await db
    .from('email_templates')
    .update({ active_version_id: ins.id, updated_at: new Date().toISOString() })
    .eq('template_key', 'CD_COUNSELOR_DIGEST')
  if (pErr) { console.error(`FAIL CD repoint: ${pErr.message}`); process.exit(1) }
  console.log(`published CD_COUNSELOR_DIGEST v${nextNumber} (live=${cd.live}) — only change: the portal line`)
}

rmSync(out, { recursive: true, force: true })
