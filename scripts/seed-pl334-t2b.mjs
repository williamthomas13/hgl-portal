#!/usr/bin/env node
// PL-335 D: seed T2B_PAYMENT_REMINDER (the instructor minimum-enrollment decision
// note — run-anyway / deadline-extended) from TEMPLATE_SEEDS as a DRAFT. The
// code twin in instructor-comms.ts renders the same markdown through the
// comms-md pipeline, so what sends before Scarlett flips it live is the same
// copy shape. Idempotent: byte-identical latest version → no-op.
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-seed-pl334')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-template-seed.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { TEMPLATE_SEEDS } = require(path.join(out, 'comms-template-seed.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const KEYS = ['T2B_PAYMENT_REMINDER']
for (const key of KEYS) {
const seed = TEMPLATE_SEEDS.find((t) => t.template_key === key)
if (!seed) { console.error(`FAIL ${key}: not in TEMPLATE_SEEDS`); process.exit(1) }

let { data: tpl } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', key)
  .maybeSingle()
if (!tpl) {
  const { error } = await db.from('email_templates').insert([{
    template_key: key,
    display_name: seed.display_name,
    sequence_number: seed.sequence_number,
    audience: seed.audience,
    from_identity: seed.from_identity,
    category: seed.category,
    live: false,
  }])
  if (error) { console.error(`FAIL template insert: ${error.message}`); process.exit(1) }
  ;({ data: tpl } = await db
    .from('email_templates')
    .select('template_key, live, active_version_id')
    .eq('template_key', key)
    .maybeSingle())
}

const { data: versions } = await db
  .from('email_template_versions')
  .select('id, version_number, subject, preheader, body_markdown, footer_note')
  .eq('template_key', key)
  .order('version_number', { ascending: false })
  .limit(1)
const latest = versions?.[0]
const same =
  latest &&
  latest.subject === seed.subject &&
  (latest.preheader ?? null) === (seed.preheader ?? null) &&
  latest.body_markdown === seed.body_markdown &&
  (latest.footer_note ?? null) === (seed.footer_note ?? null)
if (!same) {
  const nextNumber = (latest?.version_number ?? 0) + 1
  const { data: inserted, error: vErr } = await db
    .from('email_template_versions')
    .insert([{
      template_key: key,
      version_number: nextNumber,
      subject: seed.subject,
      preheader: seed.preheader,
      body_markdown: seed.body_markdown,
      footer_note: seed.footer_note,
      notes: 'PL-334 A: repeating unpaid-invoice payment reminder — seeded as a DRAFT; the code twin sends the same markdown until this goes live',
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (vErr) { console.error(`FAIL version: ${vErr.message}`); process.exit(1) }
  const { error: pErr } = await db
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', key)
  if (pErr) { console.error(`FAIL repoint: ${pErr.message}`); process.exit(1) }
  console.log(`seeded ${key} v${nextNumber} as a draft (live untouched)`)
} else {
  console.log(`unchanged ${key} v${latest.version_number} (live=${tpl.live})`)
}

}
rmSync(out, { recursive: true, force: true })
