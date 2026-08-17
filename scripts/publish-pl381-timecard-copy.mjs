#!/usr/bin/env node
// PL-381: the timecard email's exception copy read as a contradiction
// ("correct any exception (a no-show)" … "no-shows are on the card on
// purpose"). New version says what actually happens: the card assumes the
// schedule happened; the tutor marks no-shows/duration changes for the
// records; pay is unchanged for reserved time. Publishes T5_TIMECARD_READY
// v(next) from the CURRENT active body under exact-string guards (refuse on
// anchor drift — Scarlett's edits win). Idempotent.
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

const REPLACEMENTS = [
  [
    'The portal built this from the hours you were scheduled to tutor during this pay period, so usually there is nothing to fill out — just glance over it, correct any exception (a no-show), and hit **Confirm timecard**.',
    "The card assumes every scheduled session happened as planned — the portal can't know when a student didn't show or a session ran a different length, so if that happened, mark it on the card to keep our records right. Then hit **Confirm timecard**.",
  ],
  [
    "Sessions cancelled inside 24 hours and no-shows are on the card on purpose — you're paid for reserved time.",
    "Marking a no-show doesn't change your pay — you're paid for the reserved time either way. That's also why sessions cancelled inside 24 hours stay on the card.",
  ],
]
const DONE = "The card assumes every scheduled session happened as planned"

const { data: tpl } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', 'T5_TIMECARD_READY')
  .maybeSingle()
if (!tpl?.active_version_id) { console.error('FAIL: no active version'); process.exit(1) }
const { data: v } = await db
  .from('email_template_versions')
  .select('*')
  .eq('id', tpl.active_version_id)
  .single()
let body = v.body_markdown
if (body.includes(DONE)) { console.log(`skip — v${v.version_number} already carries the new copy`); process.exit(0) }
for (const [anchor, replacement] of REPLACEMENTS) {
  if (body.split(anchor).length !== 2) {
    console.error(`FAIL: anchor not found exactly once — hand-review needed:\n  ${anchor.slice(0, 80)}`)
    process.exit(1)
  }
  body = body.replace(anchor, replacement)
}

const { data: latest } = await db
  .from('email_template_versions')
  .select('version_number')
  .eq('template_key', 'T5_TIMECARD_READY')
  .order('version_number', { ascending: false })
  .limit(1)
const nextNumber = (latest?.[0]?.version_number ?? 0) + 1
const { data: inserted, error } = await db
  .from('email_template_versions')
  .insert([{
    template_key: 'T5_TIMECARD_READY',
    version_number: nextNumber,
    subject: v.subject,
    preheader: v.preheader,
    body_markdown: body,
    footer_note: v.footer_note,
    variables_used: v.variables_used,
    notes: 'PL-381: exception copy says what actually happens — the card assumes the schedule ran; tutors mark no-shows/duration changes for the records; pay unchanged for reserved time',
    created_by: 'claude',
  }])
  .select('id')
  .single()
if (error) { console.error(`FAIL insert: ${error.message}`); process.exit(1) }
await db
  .from('email_templates')
  .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
  .eq('template_key', 'T5_TIMECARD_READY')
console.log(`published T5_TIMECARD_READY v${nextNumber} (live=${tpl.live})`)
