// PL-287: CS_CLASS_CONFIRMED said "Registration closes {enrollmentDeadline}"
// — the words of the automatic sign-up cutoff filled with the DEADLINE (the
// commit-by date the flyer prints as "Registration deadline"). The counselor
// and the flyer were naming the same date differently, and IN_DIGEST uses
// "registration closes" for the actual close date. Two anchor-guarded edits
// make the label honest; the seed source carries the same text (twin rule).
//
// Anchor-guard pattern (seed-pl274-conditioning.mjs): each `from` must match
// the CURRENT active body exactly; already-applied edits count as done;
// anything else refuses rather than guessing. Idempotent.
//
// Usage: node scripts/seed-pl287-cs-deadline.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2]
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const PLAN = {
  key: 'CS_CLASS_CONFIRMED',
  notes:
    'PL-287: label honesty — this date is the registration DEADLINE (the commit-by date the flyer prints), not the automatic sign-up cutoff. Wording only; the date is unchanged.',
  edits: [
    {
      from: 'Registration closes **{enrollmentDeadline}**, and the first session is {firstSessionDate}.',
      to: 'The registration deadline is **{enrollmentDeadline}**, and the first session is {firstSessionDate}.',
    },
    {
      from: '**Register here: [{salesPageLink}]({salesPageLink})** — registration closes {enrollmentDeadline}.',
      to: '**Register here: [{salesPageLink}]({salesPageLink})** — the registration deadline is {enrollmentDeadline}.',
    },
  ],
}

const { data: tmpl, error: tErr } = await supabase
  .from('email_templates')
  .select('template_key, active_version_id, live')
  .eq('template_key', PLAN.key)
  .maybeSingle()
if (tErr || !tmpl) {
  console.error(`${PLAN.key}: template not found${tErr ? ' — ' + tErr.message : ''}`)
  process.exit(1)
}
const { data: v, error: vErr } = await supabase
  .from('email_template_versions')
  .select('id, version_number, subject, preheader, body_markdown, footer_note')
  .eq('id', tmpl.active_version_id)
  .maybeSingle()
if (vErr || !v) {
  console.error(`${PLAN.key}: active version not found`)
  process.exit(1)
}

let body = v.body_markdown
let applied = 0
for (const e of PLAN.edits) {
  if (body.includes(e.from)) {
    body = body.replace(e.from, e.to)
    applied++
  } else if (body.includes(e.to)) {
    console.log(`${PLAN.key}: one edit already applied`)
  } else {
    console.error(`${PLAN.key}: anchor not found — the live body has drifted; refusing to guess.\nMissing: ${e.from}`)
    process.exit(1)
  }
}
if (applied === 0) {
  console.log(`${PLAN.key}: unchanged (all edits already in v${v.version_number})`)
  process.exit(0)
}

const { data: inserted, error: iErr } = await supabase
  .from('email_template_versions')
  .insert({
    template_key: PLAN.key,
    version_number: v.version_number + 1,
    subject: v.subject,
    preheader: v.preheader,
    body_markdown: body,
    footer_note: v.footer_note,
    notes: PLAN.notes,
    created_by: 'claude',
  })
  .select('id, version_number')
  .single()
if (iErr || !inserted) {
  console.error(`${PLAN.key}: insert failed — ${iErr?.message}`)
  process.exit(1)
}
const { error: uErr } = await supabase
  .from('email_templates')
  .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
  .eq('template_key', PLAN.key)
if (uErr) {
  console.error(`${PLAN.key}: repoint failed — ${uErr.message}`)
  process.exit(1)
}
console.log(`${PLAN.key}: published v${inserted.version_number} (${applied} edit(s); live=${tmpl.live})`)
