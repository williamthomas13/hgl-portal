#!/usr/bin/env node
// PL-243: CS_CLASS_CONFIRMED portal paragraph trimmed — the fresh-downloads
// clause goes away entirely (Scarlett, Jul 30 review of the live ISD send).
// Published as a new version by patching the CURRENT active body with an
// exact-string anchor guard (never re-seeded). Idempotent. After the edit,
// asserts the PL-237 no-collateral strip anchors are still present in the
// new body — the fail-closed strip must keep composing with the shorter
// paragraph. Seed mirror comms-template-seed.ts synced in the same commit.
//
// Also runs a read-only PL-245 premise check: E0_CONFIRM_PARENT's upsell
// sentence lives in the {addonTutoringBlock} COMPOSER, not the stored body,
// so E0 needs no version bump — this verifies that against the live body.
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

// Must match app/api/admin/class-confirmed/route.ts exactly (the fail-closed
// strip's anchors) — if these drift the send route 400s before any send.
const ATTACH_SENTENCE = " I've attached the materials for you:"
const ATTACH_BULLET_LETTER = '- A **letter** meant to be shared with parents'
const ATTACH_BULLET_FLYER = '- A **flyer** meant for students'

const PLAN = {
  key: 'CS_CLASS_CONFIRMED',
  notes: 'PL-243 (Scarlett, Jul 30): portal paragraph trimmed — fresh-downloads clause dropped',
  edits: [
    {
      from: 'In it you\'ll find live enrollment for {className}, attendance, and diagnostic scores once the class is underway, and fresh downloads of the letter and flyer in every format{collateralLanguagesPhrase} — always reflecting the latest class details, so you never have to worry about a stale copy.',
      to: 'In it you\'ll find live enrollment for {className}, attendance, and diagnostic scores once the class is underway.',
    },
  ],
}

const { data: t } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', PLAN.key)
  .single()
const { data: v } = await db
  .from('email_template_versions')
  .select('version_number, subject, preheader, body_markdown, footer_note')
  .eq('id', t.active_version_id)
  .single()

let body = v.body_markdown
let applied = 0
let already = 0
for (const e of PLAN.edits) {
  if (body.includes(e.from)) {
    body = body.replace(e.from, e.to)
    applied++
  } else if (body.includes(e.to)) {
    already++
  } else {
    console.error(`FAIL ${PLAN.key} v${v.version_number}: anchor not found: "${e.from.slice(0, 60)}…" — the active copy has drifted; patch by hand.`)
    process.exit(1)
  }
}

// PL-237 interplay: the no-collateral strip must still find its anchors.
for (const [name, anchor] of [
  ['ATTACH_SENTENCE', ATTACH_SENTENCE],
  ['letter bullet', ATTACH_BULLET_LETTER],
  ['flyer bullet', ATTACH_BULLET_FLYER],
]) {
  if (!body.includes(anchor)) {
    console.error(`FAIL ${PLAN.key}: after the trim, the PL-237 strip anchor (${name}) is missing from the body — the no-collateral send would fail closed. Not publishing.`)
    process.exit(1)
  }
}
console.log('strip-anchor check: all 3 PL-237 anchors still present in the new body')

if (applied === 0) {
  console.log(`unchanged ${PLAN.key} v${v.version_number} — edit already present (${already})`)
} else {
  const nextNumber = v.version_number + 1
  const { data: inserted, error: vErr } = await db
    .from('email_template_versions')
    .insert([{
      template_key: PLAN.key,
      version_number: nextNumber,
      subject: v.subject,
      preheader: v.preheader,
      body_markdown: body,
      footer_note: v.footer_note,
      notes: PLAN.notes,
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (vErr) { console.error(`FAIL ${PLAN.key} version insert: ${vErr.message}`); process.exit(1) }
  const { error: pErr } = await db
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', PLAN.key)
  if (pErr) { console.error(`FAIL ${PLAN.key} repoint: ${pErr.message}`); process.exit(1) }
  console.log(`published ${PLAN.key} v${nextNumber} (live=${t.live}) — ${applied} edit applied`)
}

// ---- PL-245 read-only premise check on E0_CONFIRM_PARENT ------------------
const { data: e0t } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', 'E0_CONFIRM_PARENT')
  .single()
const { data: e0v } = await db
  .from('email_template_versions')
  .select('version_number, body_markdown')
  .eq('id', e0t.active_version_id)
  .single()
const hasBlock = e0v.body_markdown.includes('{addonTutoringBlock}')
const hasOldCopy = e0v.body_markdown.includes('Want to start earlier instead')
console.log(`E0_CONFIRM_PARENT v${e0v.version_number} (live=${e0t.live}): {addonTutoringBlock} placeholder=${hasBlock}, literal upsell copy in body=${hasOldCopy}`)
if (hasOldCopy) {
  console.error('PL-245 NOTE: the live E0 body carries the upsell sentence LITERALLY — a version bump IS needed; the composer-only edit will not reach sends.')
  process.exit(2)
}
