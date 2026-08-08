#!/usr/bin/env node
// PL-315: the #0-P/#0-S registration-confirmation pair gains the composed
// {sessionScheduleBlock} — the same session facts the register page showed
// (dates, times, location, PL-305 zone line) + the course-calendar subscribe
// link. Anchor-guarded patch of the CURRENT active bodies; idempotent;
// refuses on drift. Seed mirror + code twins ride the commit.
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
    key: 'E0_CONFIRM_PARENT',
    notes: 'PL-315: full session schedule + calendar subscribe link after the what-you-will-get paragraph',
    edits: [{
      from: 'This includes {e0IncludesPhrase}.',
      to: `This includes {e0IncludesPhrase}.

{sessionScheduleBlock}`,
    }],
  },
  {
    key: 'E0_CONFIRM_STUDENT',
    notes: 'PL-315: full session schedule + calendar subscribe link after the diagnostic aside',
    edits: [{
      from: '{diagnosticDueLine}',
      to: `{diagnosticDueLine}

{sessionScheduleBlock}`,
    }],
  },
]

for (const plan of PLANS) {
  const { data: t } = await db
    .from('email_templates')
    .select('template_key, live, active_version_id')
    .eq('template_key', plan.key)
    .maybeSingle()
  if (!t) { console.log(`skip ${plan.key} — no template row`); continue }
  const { data: v } = await db
    .from('email_template_versions')
    .select('version_number, subject, preheader, body_markdown, footer_note')
    .eq('id', t.active_version_id)
    .single()

  let body = v.body_markdown
  let applied = 0
  let failed = false
  for (const e of plan.edits) {
    if (body.includes(e.to)) continue
    if (body.includes(e.from)) {
      body = body.replace(e.from, e.to)
      applied++
    } else {
      console.error(`FAIL ${plan.key} v${v.version_number}: anchor not found: "${e.from.slice(0, 55).replace(/\n/g, '\\n')}…" — patch by hand.`)
      failed = true
    }
  }
  if (failed) process.exit(1)
  if (applied === 0) {
    console.log(`unchanged ${plan.key} v${v.version_number} — block already present`)
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
  if (vErr) { console.error(`FAIL ${plan.key} insert: ${vErr.message}`); process.exit(1) }
  const { error: pErr } = await db
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', plan.key)
  if (pErr) { console.error(`FAIL ${plan.key} repoint: ${pErr.message}`); process.exit(1) }
  console.log(`published ${plan.key} v${nextNumber} (live=${t.live}) — ${applied} edit${applied === 1 ? '' : 's'}`)
}
