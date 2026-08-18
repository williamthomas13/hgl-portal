#!/usr/bin/env node
// PL-391: the VFAQ "Are you still here?" bridge becomes compositional —
// {vfaqBridgeLine} renders only when a gated Q&A (diagnostics or strategy)
// actually follows, so the joke never introduces a list that isn't there.
// Publishes E3_VFAQ v(next) from the CURRENT active body under an exact
// anchor (refuse on drift). Idempotent.
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

const ANCHOR = 'Are you still here? You are? Okay, here are a few regular FAQs, just for you:'

const { data: tpl } = await db.from('email_templates').select('template_key, live, active_version_id').eq('template_key', 'E3_VFAQ').maybeSingle()
if (!tpl?.active_version_id) { console.error('FAIL: no active version'); process.exit(1) }
const { data: v } = await db.from('email_template_versions').select('*').eq('id', tpl.active_version_id).single()
if (v.body_markdown.includes('{vfaqBridgeLine}')) { console.log(`skip — v${v.version_number} already composes the bridge`); process.exit(0) }
if (v.body_markdown.split(ANCHOR).length !== 2) { console.error('FAIL: bridge anchor not found exactly once — hand-review'); process.exit(1) }
const body = v.body_markdown.replace(ANCHOR, '{vfaqBridgeLine}')

const { data: latest } = await db.from('email_template_versions').select('version_number').eq('template_key', 'E3_VFAQ').order('version_number', { ascending: false }).limit(1)
const nextNumber = (latest?.[0]?.version_number ?? 0) + 1
const { data: inserted, error } = await db.from('email_template_versions').insert([{
  template_key: 'E3_VFAQ', version_number: nextNumber,
  subject: v.subject, preheader: v.preheader, body_markdown: body,
  footer_note: v.footer_note, variables_used: v.variables_used,
  notes: 'PL-391: the "Are you still here?" bridge composes away when no gated Q&A follows it (Deep-Dive shape)',
  created_by: 'claude',
}]).select('id').single()
if (error) { console.error(`FAIL insert: ${error.message}`); process.exit(1) }
await db.from('email_templates').update({ active_version_id: inserted.id, updated_at: new Date().toISOString() }).eq('template_key', 'E3_VFAQ')
console.log(`published E3_VFAQ v${nextNumber} (live=${tpl.live})`)
