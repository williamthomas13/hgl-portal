#!/usr/bin/env node
// PL-220 + PL-222: publish T8_WELCOME_HANDOFF v(N+1) by patching the CURRENT
// active body (Scarlett edits live templates; we never re-seed over her copy).
// Two exact-string anchor-guarded insertions:
//   1. PL-222 all-set payload (calendar subscribe + PDF + reschedule line)
//      BEFORE the "One thing we need before sessions can start:" paragraph —
//      T8 absorbs T_SCHEDULE_SET's unique content so a first-time family's
//      activation sends only the extended T8.
//   2. PL-220 family-portal discovery block (tutoring-flavored contents line)
//      BEFORE {contactBlock}.
// Idempotent: refuses if either block is already present; refuses if an
// anchor is missing (body drifted — patch by hand).
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

const KEY = 'T8_WELCOME_HANDOFF'

const ANCHOR_1 = '**One thing we need before sessions can start:**'
const BLOCK_1 = `A couple of things to make life easier:

[button:Add to your calendar]({calendarLink})

Subscribe once and every session (and any future change) shows up automatically.

[button:Download the schedule (PDF)]({schedulePdfLink})

You can reschedule any single session yourself from your parent portal — no need to email us for the small stuff.

${ANCHOR_1}`

const ANCHOR_2 = '{contactBlock}'
const BLOCK_2 = `**One more thing worth knowing: you have a family portal.** [Open it any time]({portalLink}) — it's yours for the whole tutoring journey. Inside you'll find {studentFirstName}'s schedule, your receipts and invoices, session notes on what {studentFirstName} worked on, one-click rescheduling for any single session, and a calendar feed you can subscribe to. Signing in never needs a password — just this email address.

${ANCHOR_2}`

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

if (v.body_markdown.includes('you have a family portal') && v.body_markdown.includes('{calendarLink}')) {
  console.log(`unchanged ${KEY} v${v.version_number} — both blocks already present`)
  process.exit(0)
}
if (!v.body_markdown.includes(ANCHOR_1)) {
  console.error(`FAIL ${KEY} v${v.version_number}: anchor 1 ("One thing we need before sessions can start") not found — the active body has drifted; patch by hand.`)
  process.exit(1)
}
if (!v.body_markdown.includes(ANCHOR_2)) {
  console.error(`FAIL ${KEY} v${v.version_number}: anchor 2 ({contactBlock}) not found — the active body has drifted; patch by hand.`)
  process.exit(1)
}

let nextBody = v.body_markdown
if (!nextBody.includes('{calendarLink}')) nextBody = nextBody.replace(ANCHOR_1, BLOCK_1)
if (!nextBody.includes('you have a family portal')) nextBody = nextBody.replace(ANCHOR_2, BLOCK_2)

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
    notes: 'PL-220: family-portal block (tutoring contents) · PL-222: all-set payload folded in (calendar subscribe, PDF, reschedule line) — T_SCHEDULE_SET now sends only on the repeat path',
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
console.log(`published ${KEY} v${nextNumber} (live=${t.live}) — only changes: the two inserted blocks`)
