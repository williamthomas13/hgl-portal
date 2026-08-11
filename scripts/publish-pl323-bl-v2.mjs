#!/usr/bin/env node
// PL-323E: publish Scarlett's BL_BLOCK_CONFIRM copy as v2 — shipped in the
// SAME deploy as the flow it describes (chooser + auto-drop + reservation).
// Guarded full-body replace (PL-270 pattern): refuses unless the current
// active body is exactly the v1 copy we expect (or already v2). The seed is
// the copy source of truth — the version publishes from TEMPLATE_SEEDS so
// the two can never drift.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-bl-v2')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-template-seed.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { TEMPLATE_SEEDS } = require(path.join(out, 'comms-template-seed.js'))
const seed = TEMPLATE_SEEDS.find((t) => t.template_key === 'BL_BLOCK_CONFIRM')
if (!seed) { console.error('FAIL: BL_BLOCK_CONFIRM not in seeds'); process.exit(1) }

// The v1 anchor: the sentence that only exists in the pre-PL-323 copy.
const V1_ANCHOR = 'use the "Continue after the hours" button'
const V2_ANCHOR = 'use the "Continue tutoring" button'

const { data: t } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', 'BL_BLOCK_CONFIRM')
  .maybeSingle()
if (!t) { console.error('FAIL: no template row'); process.exit(1) }
const { data: v } = await db
  .from('email_template_versions')
  .select('version_number, body_markdown')
  .eq('id', t.active_version_id)
  .single()

if (v.body_markdown.includes(V2_ANCHOR)) {
  console.log(`unchanged — v${v.version_number} already carries the PL-323 copy`)
  process.exit(0)
}
if (!v.body_markdown.includes(V1_ANCHOR)) {
  console.error(`FAIL: active v${v.version_number} matches neither v1 nor v2 copy — someone edited it; publish by hand.`)
  process.exit(1)
}

const next = v.version_number + 1
const { data: inserted, error } = await db
  .from('email_template_versions')
  .insert([{
    template_key: 'BL_BLOCK_CONFIRM',
    version_number: next,
    subject: seed.subject,
    preheader: seed.preheader,
    body_markdown: seed.body_markdown,
    footer_note: seed.footer_note,
    notes: "PL-323E: Scarlett's copy — ships with the chooser/auto-drop/reservation flow",
    created_by: 'claude',
  }])
  .select('id')
  .single()
if (error) { console.error('FAIL insert:', error.message); process.exit(1) }
await db
  .from('email_templates')
  .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
  .eq('template_key', 'BL_BLOCK_CONFIRM')
rmSync(out, { recursive: true, force: true })
console.log(`published BL_BLOCK_CONFIRM v${next} (live=${t.live}) — Scarlett's PL-323 copy`)
