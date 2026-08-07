// PL-292 + PL-293: FO template v2s via anchor guard.
//   PL-292 — pronoun-true copy: FO-2P "right for them" → {her_him_them},
//   FO-3P "their confidence" → {her_his_their}. (Audit found no other
//   hard-coded third-person student pronouns across the six bodies; unset
//   pronouns still render the original words exactly.)
//   PL-293 — {followOnInfoBlock} (the "More info" marketing-page pointer,
//   EMPTY when the class has no marketing_url) appended after the register
//   CTA in all six.
// Anchor-guard pattern (seed-pl274-conditioning.mjs): exact-match or refuse;
// already-applied counts as done. Seeds carry the same text (twin rule).
// Idempotent. Live flags untouched (these are Scarlett's flip).
//
// Usage: node scripts/seed-pl292-293-fo-v2.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2]
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const CTA_BOLD =
  'To register or learn more about the course, you can visit [{followOnRegistrationLink}]({followOnRegistrationLink}) and **use the code {discountCode} to get your discount.**'
const CTA_PLAIN =
  'To register or learn more about the course, you can visit [{followOnRegistrationLink}]({followOnRegistrationLink}) and use the code {discountCode} to get your discount.'
const CTA_ALLBOLD =
  '**To register or learn more about the course, you can visit [{followOnRegistrationLink}]({followOnRegistrationLink}) and use the code {discountCode} to get your discount.**'
const BARE_LINK = '[{followOnRegistrationLink}]({followOnRegistrationLink})'
const INFO = '{followOnInfoBlock}'

const PLANS = [
  {
    key: 'FO_ANNOUNCE_PARENT',
    notes: 'PL-293: More-info marketing-page pointer after the CTA (empty when no marketing page is set).',
    edits: [{ from: CTA_BOLD, to: `${CTA_BOLD}\n\n${INFO}` }],
  },
  {
    key: 'FO_ANNOUNCE_STUDENT',
    notes: 'PL-293: More-info marketing-page pointer after the CTA (empty when no marketing page is set).',
    edits: [{ from: CTA_BOLD, to: `${CTA_BOLD}\n\n${INFO}` }],
  },
  {
    key: 'FO_REMINDER_PARENT',
    notes: 'PL-292: "right for them" → {her_him_them} (pronoun-true; unset still reads "them"). PL-293: More-info pointer after the CTA.',
    edits: [
      {
        from: "If you're considering enrolling {studentFirstName}, but you're wondering if the course is right for them, you can reply to this message and ask anything you'd like.",
        to: "If you're considering enrolling {studentFirstName}, but you're wondering if the course is right for {her_him_them}, you can reply to this message and ask anything you'd like.",
      },
      { from: CTA_PLAIN, to: `${CTA_PLAIN}\n\n${INFO}` },
    ],
  },
  {
    key: 'FO_REMINDER_STUDENT',
    notes: 'PL-293: More-info marketing-page pointer after the CTA (empty when no marketing page is set).',
    edits: [{ from: CTA_ALLBOLD, to: `${CTA_ALLBOLD}\n\n${INFO}` }],
  },
  {
    key: 'FO_EXTENSION_PARENT',
    notes: 'PL-292: "their confidence" → {her_his_their} (pronoun-true; unset still reads "their"). PL-293: More-info pointer after the sign-up link.',
    edits: [
      {
        from: "Learning to solve these most difficult math problems is transformative – both for {studentFirstName}'s scores *and* their confidence.",
        to: "Learning to solve these most difficult math problems is transformative – both for {studentFirstName}'s scores *and* {her_his_their} confidence.",
      },
      { from: BARE_LINK, to: `${BARE_LINK}\n\n${INFO}` },
    ],
  },
  {
    key: 'FO_EXTENSION_STUDENT',
    notes: 'PL-293: More-info marketing-page pointer after the sign-up link.',
    edits: [{ from: BARE_LINK, to: `${BARE_LINK}\n\n${INFO}` }],
  },
]

for (const plan of PLANS) {
  const { data: tmpl } = await supabase
    .from('email_templates')
    .select('template_key, active_version_id, live')
    .eq('template_key', plan.key)
    .maybeSingle()
  if (!tmpl) { console.error(`${plan.key}: template not found`); process.exit(1) }
  const { data: v } = await supabase
    .from('email_template_versions')
    .select('id, version_number, subject, preheader, body_markdown, footer_note')
    .eq('id', tmpl.active_version_id)
    .maybeSingle()
  if (!v) { console.error(`${plan.key}: active version not found`); process.exit(1) }

  let body = v.body_markdown
  let applied = 0
  for (const e of plan.edits) {
    if (body.includes(e.from) && !body.includes(e.to)) {
      body = body.replace(e.from, e.to)
      applied++
    } else if (body.includes(e.to)) {
      console.log(`${plan.key}: one edit already applied`)
    } else {
      console.error(`${plan.key}: anchor not found — the live body has drifted; refusing to guess.\nMissing: ${e.from}`)
      process.exit(1)
    }
  }
  if (applied === 0) { console.log(`${plan.key}: unchanged (v${v.version_number})`); continue }

  const { data: inserted, error: iErr } = await supabase
    .from('email_template_versions')
    .insert({
      template_key: plan.key,
      version_number: v.version_number + 1,
      subject: v.subject,
      preheader: v.preheader,
      body_markdown: body,
      footer_note: v.footer_note,
      notes: plan.notes,
      created_by: 'claude',
    })
    .select('id, version_number')
    .single()
  if (iErr || !inserted) { console.error(`${plan.key}: insert failed — ${iErr?.message}`); process.exit(1) }
  const { error: uErr } = await supabase
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', plan.key)
  if (uErr) { console.error(`${plan.key}: repoint failed — ${uErr.message}`); process.exit(1) }
  console.log(`${plan.key}: published v${inserted.version_number} (${applied} edit(s); live=${tmpl.live})`)
}
