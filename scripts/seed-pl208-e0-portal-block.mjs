#!/usr/bin/env node
// PL-208: publish E0_CONFIRM_PARENT v(N+1) — the "you have a family portal"
// block, inserted into the CURRENT active body (Scarlett edits live
// templates; we patch her active version, never re-seed over it). Exact-
// string guard: refuses if the insertion anchor is missing. Idempotent:
// refuses if the block is already present.
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

const KEY = 'E0_CONFIRM_PARENT'
const ANCHOR = '[button:View your registration]({portalLink})'
const BLOCK = `**One more thing worth knowing: you have a family portal.** The button below opens it — and it's yours for the whole journey, not just this class. Inside you'll find {studentFirstName}'s schedule, your receipts, diagnostic scores once they're in, a calendar feed you can subscribe to, and 1-on-1 tutoring whenever you want it. Signing in never needs a password — just this email address.

${ANCHOR}`

const { data: t } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', KEY)
  .single()
const { data: v } = await db
  .from('email_template_versions')
  .select('version_number, subject, preheader, body_markdown, footer_note')
  .eq('id', t.active_version_id)
  .single()

if (v.body_markdown.includes('you have a family portal')) {
  console.log(`unchanged ${KEY} v${v.version_number} — portal block already present`)
  process.exit(0)
}
if (!v.body_markdown.includes(ANCHOR)) {
  console.error(`FAIL ${KEY} v${v.version_number}: anchor not found — the active body has drifted; patch by hand.`)
  process.exit(1)
}

const nextBody = v.body_markdown.replace(ANCHOR, BLOCK)
const nextNumber = v.version_number + 1
const { data: inserted, error: vErr } = await db
  .from('email_template_versions')
  .insert([{
    template_key: KEY,
    version_number: nextNumber,
    subject: v.subject,
    preheader: v.preheader,
    body_markdown: nextBody,
    footer_note: v.footer_note,
    notes: 'PL-208: "you have a family portal" block above the registration button (portal discovery)',
    created_by: 'claude',
  }])
  .select('id')
  .single()
if (vErr) { console.error(`FAIL version insert: ${vErr.message}`); process.exit(1) }
const { error: pErr } = await db
  .from('email_templates')
  .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
  .eq('template_key', KEY)
if (pErr) { console.error(`FAIL repoint: ${pErr.message}`); process.exit(1) }
console.log(`published ${KEY} v${nextNumber} (live=${t.live}) — only change: the portal block above the button`)
