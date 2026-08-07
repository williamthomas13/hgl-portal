#!/usr/bin/env node
// PL-282: publish Scarlett's FINAL returning-family thank-you copy (Aug 7)
// over the PL-274A placeholder drafts — new version from TEMPLATE_SEEDS
// (which now carries her exact strings), subject+preheader updated on the
// template row, and the pair goes LIVE (the item's instruction: these
// replace the placeholders as the live templates). Idempotent: byte-identical
// latest version → only the live flag is ensured.
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-seed-pl282')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-template-seed.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { TEMPLATE_SEEDS } = require(path.join(out, 'comms-template-seed.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const KEYS = ['E1_RETURNING_PARENT', 'E1_RETURNING_STUDENT']
for (const key of KEYS) {
  const seed = TEMPLATE_SEEDS.find((t) => t.template_key === key)
  if (!seed) { console.error(`FAIL ${key}: not in TEMPLATE_SEEDS`); process.exit(1) }
  if (/PLACEHOLDER/.test(seed.body_markdown)) {
    console.error(`FAIL ${key}: seed still carries placeholder copy — refusing to publish`)
    process.exit(1)
  }

  const { data: tpl } = await db
    .from('email_templates')
    .select('template_key, live, active_version_id')
    .eq('template_key', key)
    .maybeSingle()
  if (!tpl) { console.error(`FAIL ${key}: template row missing (run seed-pl274-returning.mjs first)`); process.exit(1) }

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
        notes: "PL-282: Scarlett's final returning-family copy (Aug 7) — replaces the PL-274A placeholder; goes live",
        created_by: 'claude',
      }])
      .select('id')
      .single()
    if (vErr) { console.error(`FAIL version: ${vErr.message}`); process.exit(1) }
    const { error: pErr } = await db
      .from('email_templates')
      .update({ active_version_id: inserted.id, live: true, updated_at: new Date().toISOString() })
      .eq('template_key', key)
    if (pErr) { console.error(`FAIL repoint: ${pErr.message}`); process.exit(1) }
    console.log(`published ${key} v${nextNumber} LIVE`)
  } else if (!tpl.live) {
    const { error: lErr } = await db
      .from('email_templates')
      .update({ live: true, updated_at: new Date().toISOString() })
      .eq('template_key', key)
    if (lErr) { console.error(`FAIL set live: ${lErr.message}`); process.exit(1) }
    console.log(`unchanged ${key} v${latest.version_number} — set LIVE`)
  } else {
    console.log(`unchanged ${key} v${latest.version_number} (already live)`)
  }
}
rmSync(out, { recursive: true, force: true })
