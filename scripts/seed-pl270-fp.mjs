#!/usr/bin/env node
// PL-270: FP_DEADLINE_PUSH full-body rewrite (Scarlett's exact copy, Aug 3).
// A FULL replace still refuses on drift: every distinctive phrase of the
// body we EXPECT to be live must be present in the current active version,
// or we stop and say "patch by hand" — never re-seed over unseen edits.
// Idempotent: new body already live → no-op. Code twin + seed mirror ride
// the same commit; the composer supplies the two new variables
// ({enrolledCountPhrase}/{minStudentsPhrase}).
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

const KEY = 'FP_DEADLINE_PUSH'
// Anchors that must ALL exist in the current live body before we replace it.
const EXPECT = [
  'Quick heads-up: registration for the {className} class closes soon ({deadlineCountdown})',
  'a nudge from the school makes the difference',
  '[{registrationLink}]({registrationLink})',
  'Current count: {enrolledCountLine}.',
  'the class calendar and materials go out on schedule',
  'Thanks for the assist!',
]
const NEW_BODY = `Hi {counselorFirstName},

Quick heads-up: registration for the {className} class closes soon ({deadlineCountdown}), and there are still {spotsLeftPhrase} open.

This is the window where a nudge from the school makes the difference — parents who've been meaning to register usually just need one reminder, and one from you carries real weight.

Here's the link, ready to forward:

[{registrationLink}]({registrationLink})

Current count: {enrolledCountPhrase} enrolled. The course requires a minimum of {minStudentsPhrase} to run. After the minimum is reached, late registrations may still be possible while spots remain.

Thanks for the assist!

Higher Ground Learning`

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

if (v.body_markdown === NEW_BODY) {
  console.log(`unchanged ${KEY} v${v.version_number} — rewrite already live`)
  process.exit(0)
}
const missing = EXPECT.filter((a) => !v.body_markdown.includes(a))
if (missing.length) {
  console.error(`FAIL ${KEY} v${v.version_number}: the active copy has drifted (missing: "${missing[0].slice(0, 50)}…") — patch by hand, not by this script.`)
  process.exit(1)
}

const nextNumber = v.version_number + 1
const { data: inserted, error: vErr } = await db
  .from('email_template_versions')
  .insert([{
    template_key: KEY,
    version_number: nextNumber,
    subject: v.subject,
    preheader: v.preheader,
    body_markdown: NEW_BODY,
    footer_note: v.footer_note,
    notes: 'PL-270 (Scarlett, Aug 3): full body rewrite — enrolled count vs class MINIMUM, softer close',
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
console.log(`published ${KEY} v${nextNumber} (live=${t.live})`)
