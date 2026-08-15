#!/usr/bin/env node
// PL-362: consolidate every autopay ask into THE one composed block —
// publish new versions of the CURRENT active bodies with exact-string
// guards (refuse if the anchor is missing — Scarlett's edits win):
//   T1_MONTHLY_PROPOSAL  + {autopayBlock} before {contactBlock}
//   T1B_PROPOSAL_NUDGE   + {autopayBlock} before {contactBlock}
//   T2B_PAYMENT_REMINDER + {autopayBlock} before {contactBlock}
//   T8_WELCOME_HANDOFF   hand-written autopay sentence → {autopayBlock}
//   BL_CONTINUE_OUTCOME  + {autopayBlock} before "Thanks!"
// (T2_INVOICE already bodies {autopayBlock} — its composer now feeds from
// the one source; no version needed.) Idempotent: a body already carrying
// {autopayBlock} is skipped.
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

const T8_SENTENCE = "Prefer not to think about invoices? [Set up autopay]({autopayLink}) and each month's confirmed invoice charges your saved card or bank account automatically."

const EDITS = [
  { key: 'T1_MONTHLY_PROPOSAL', kind: 'before_contact' },
  { key: 'T1B_PROPOSAL_NUDGE', kind: 'before_contact' },
  { key: 'T2B_PAYMENT_REMINDER', kind: 'before_contact' },
  { key: 'T8_WELCOME_HANDOFF', kind: 'replace_sentence' },
  { key: 'BL_CONTINUE_OUTCOME', kind: 'before_thanks' },
]

let failures = 0
for (const edit of EDITS) {
  const { data: tpl } = await db
    .from('email_templates')
    .select('template_key, live, active_version_id')
    .eq('template_key', edit.key)
    .maybeSingle()
  if (!tpl?.active_version_id) { console.error(`FAIL ${edit.key}: no active version`); failures++; continue }
  const { data: v } = await db
    .from('email_template_versions')
    .select('*')
    .eq('id', tpl.active_version_id)
    .single()
  const body = v.body_markdown
  if (body.includes('{autopayBlock}')) { console.log(`skip ${edit.key} v${v.version_number} — already carries {autopayBlock}`); continue }

  let next
  if (edit.kind === 'before_contact') {
    const anchor = '\n\n{contactBlock}'
    if (!body.endsWith(anchor) && body.split(anchor).length !== 2) {
      console.error(`FAIL ${edit.key}: {contactBlock} anchor not found exactly once — hand-review needed`)
      failures++
      continue
    }
    next = body.replace(anchor, '\n\n{autopayBlock}' + anchor)
  } else if (edit.kind === 'replace_sentence') {
    if (!body.includes(T8_SENTENCE)) {
      console.error(`FAIL ${edit.key}: the hand-written autopay sentence is not in the active body (edited?) — hand-review needed`)
      failures++
      continue
    }
    next = body.replace(T8_SENTENCE, '{autopayBlock}')
  } else {
    const anchor = '{blockContinueOutcomeBlock}\n\nThanks!'
    if (!body.includes(anchor)) {
      console.error(`FAIL ${edit.key}: outcome-block anchor not found — hand-review needed`)
      failures++
      continue
    }
    next = body.replace(anchor, '{blockContinueOutcomeBlock}\n\n{autopayBlock}\n\nThanks!')
  }

  const { data: latest } = await db
    .from('email_template_versions')
    .select('version_number')
    .eq('template_key', edit.key)
    .order('version_number', { ascending: false })
    .limit(1)
  const nextNumber = (latest?.[0]?.version_number ?? 0) + 1
  const { data: inserted, error } = await db
    .from('email_template_versions')
    .insert([{
      template_key: edit.key,
      version_number: nextNumber,
      subject: v.subject,
      preheader: v.preheader,
      body_markdown: next,
      footer_note: v.footer_note,
      variables_used: v.variables_used,
      notes: 'PL-362: the autopay ask now composes from THE one nudge block (empty for autopay families)',
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (error) { console.error(`FAIL ${edit.key} insert: ${error.message}`); failures++; continue }
  await db
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', edit.key)
  console.log(`published ${edit.key} v${nextNumber} (live=${tpl.live}, unchanged)`)
}
process.exit(failures ? 1 : 0)
