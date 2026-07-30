#!/usr/bin/env node
// PL-235: Scarlett's Jul 29 test-render copy edits — four templates, each
// published as a new version by patching its CURRENT active body with
// exact-string anchor guards (never re-seeded). Idempotent per template:
// all-edits-already-present → no new version. Refuses on a missing anchor.
// Code twins updated in the same commit (email.ts SV + E0, intake-emails.ts
// T8, schedule-approval.ts T_SCHEDULE_SET, comms-template-seed.ts synced).
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

const PLANS = [
  {
    key: 'SV_CLASS_SURVEY',
    notes: 'PL-235 (Scarlett, Jul 29): "nicely done!" + lighter anonymous line',
    edits: [
      { from: 'nicely done.', to: 'nicely done!' },
      {
        from: "Rather not be named? There's an anonymous option right on the form.",
        to: '(You can even do it anonymously if you want.)',
      },
    ],
  },
  {
    key: 'T8_WELCOME_HANDOFF',
    notes: 'PL-235 (Scarlett, Jul 29): "if you don\'t want to"; portal intro re-voiced w/ inline link; "Open it any time" sentence folded into the intro',
    edits: [
      {
        from: 'no need to email us for the small stuff.',
        to: "no need to email us for the small stuff if you don't want to.",
      },
      {
        from: "**One more thing worth knowing: you have a family portal.** [Open it any time]({portalLink}) — it's yours for the whole tutoring journey. Inside",
        to: '**One more thing: we set up access for your family in the [Higher Ground Learning portal]({portalLink}).** Inside',
      },
    ],
  },
  {
    key: 'E0_CONFIRM_PARENT',
    notes: 'PL-235 (Scarlett, Jul 29): portal intro re-voiced in lockstep with T8 (button stays the link)',
    edits: [
      {
        from: '**One more thing worth knowing: you have a family portal.**',
        to: '**One more thing: we set up access for your family in the Higher Ground Learning portal.**',
      },
    ],
  },
  {
    key: 'T_SCHEDULE_SET',
    notes: "PL-235 (Scarlett, Jul 29): \"if you don't want to\" — lockstep with T8's folded copy (repeat-path families see this)",
    edits: [
      {
        from: 'no need to email us for the small stuff.',
        to: "no need to email us for the small stuff if you don't want to.",
      },
    ],
  },
]

for (const plan of PLANS) {
  const { data: t } = await db
    .from('email_templates')
    .select('template_key, live, active_version_id')
    .eq('template_key', plan.key)
    .single()
  const { data: v } = await db
    .from('email_template_versions')
    .select('version_number, subject, preheader, body_markdown, footer_note')
    .eq('id', t.active_version_id)
    .single()

  let body = v.body_markdown
  let applied = 0
  let already = 0
  let failed = false
  for (const e of plan.edits) {
    if (body.includes(e.from)) {
      body = body.replace(e.from, e.to)
      applied++
    } else if (body.includes(e.to)) {
      already++
    } else {
      console.error(`FAIL ${plan.key} v${v.version_number}: anchor not found: "${e.from.slice(0, 60)}…" — the active copy has drifted; patch by hand.`)
      failed = true
    }
  }
  if (failed) process.exit(1)
  if (applied === 0) {
    console.log(`unchanged ${plan.key} v${v.version_number} — all ${already} edits already present`)
    continue
  }
  const nextNumber = v.version_number + 1
  const { data: inserted, error: vErr } = await db
    .from('email_template_versions')
    .insert([{
      template_key: plan.key,
      version_number: nextNumber,
      subject: v.subject,
      preheader: v.preheader,
      body_markdown: body,
      footer_note: v.footer_note,
      notes: plan.notes,
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (vErr) { console.error(`FAIL ${plan.key} version insert: ${vErr.message}`); process.exit(1) }
  const { error: pErr } = await db
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', plan.key)
  if (pErr) { console.error(`FAIL ${plan.key} repoint: ${pErr.message}`); process.exit(1) }
  console.log(`published ${plan.key} v${nextNumber} (live=${t.live}) — ${applied} edits${already ? `, ${already} already present` : ''}`)
}
