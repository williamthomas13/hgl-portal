#!/usr/bin/env node
// PL-394: the tutor schedule-change recap leads with WHAT CHANGED — the
// change is the point of the email; the full upcoming list follows as
// reference, glance line adjusted to bridge. Publishes T3_TUTOR_NOTICE
// v(next) from the CURRENT active body under exact anchors. Idempotent.
// (Audit: T3_SCHEDULE_CHANGE and SU_SCHEDULE_UPDATE — the family recaps —
// already lead with their change list; unchanged.)
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

const OLD = `{tutorScheduleBlock}

{tutorChangeBlock}

Worth a quick glance even if you live in your calendar — your Google Calendar is already updated, but this email is the recap of what moved.`
const NEW = `{tutorChangeBlock}

Your Google Calendar is already updated — below is the full upcoming schedule for reference, worth a quick glance even if you live in your calendar.

{tutorScheduleBlock}`

const { data: tpl } = await db.from('email_templates').select('template_key, live, active_version_id').eq('template_key', 'T3_TUTOR_NOTICE').maybeSingle()
if (!tpl?.active_version_id) { console.error('FAIL: no active version'); process.exit(1) }
const { data: v } = await db.from('email_template_versions').select('*').eq('id', tpl.active_version_id).single()
const idx = v.body_markdown.indexOf('{tutorChangeBlock}')
const schedIdx = v.body_markdown.indexOf('{tutorScheduleBlock}')
if (idx >= 0 && schedIdx > idx) { console.log(`skip — v${v.version_number} already leads with the change block`); process.exit(0) }
if (v.body_markdown.split(OLD).length !== 2) { console.error('FAIL: anchor not found exactly once — hand-review'); process.exit(1) }
const body = v.body_markdown.replace(OLD, NEW)

const { data: latest } = await db.from('email_template_versions').select('version_number').eq('template_key', 'T3_TUTOR_NOTICE').order('version_number', { ascending: false }).limit(1)
const nextNumber = (latest?.[0]?.version_number ?? 0) + 1
const { data: inserted, error } = await db.from('email_template_versions').insert([{
  template_key: 'T3_TUTOR_NOTICE', version_number: nextNumber,
  subject: v.subject, preheader: v.preheader, body_markdown: body,
  footer_note: v.footer_note, variables_used: v.variables_used,
  notes: 'PL-394: what-changed leads (the change IS the point); the upcoming list follows as reference',
  created_by: 'claude',
}]).select('id').single()
if (error) { console.error(`FAIL insert: ${error.message}`); process.exit(1) }
await db.from('email_templates').update({ active_version_id: inserted.id, updated_at: new Date().toISOString() }).eq('template_key', 'T3_TUTOR_NOTICE')
console.log(`published T3_TUTOR_NOTICE v${nextNumber} (live=${tpl.live})`)
