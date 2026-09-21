#!/usr/bin/env node
// PL-486: void the four class-hours timecards that PL-471's incident left
// `open` — Gwen / Kevin / Rebecca (Sep 1–15, records-only classes) and
// Billy's MIS-placeholder card — through the new void transition (same
// writes the admin route makes), reason "records-only class — paid outside
// the portal". Idempotent; prints every card and refuses anything approved.
//   node scripts/pl486-void-records-only-timecards.mjs [--apply]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); return [k, v] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const apply = process.argv.includes('--apply')
const IDS = ['81001365-0b7f-40a4-9292-d53aaadf269e', '8e8bd4e7-fa83-41cc-ba10-777e347ece73', '0e7b30af-1070-479f-ab28-e819610d4895', '7be2b487-b01a-4bd3-a0a0-3eeae192ab19']
const REASON = 'records-only class — paid outside the portal'
const { data: cards } = await db.from('timecards').select('id, status, period_start, period_end, total_hours, void_reason, instructors ( name )').in('id', IDS)
for (const c of cards ?? []) console.log(`${c.instructors?.name} ${c.period_start}→${c.period_end} ${c.total_hours}h status=${c.status}${c.void_reason ? ` (${c.void_reason})` : ''}`)
const targets = (cards ?? []).filter((c) => ['open', 'tutor_confirmed'].includes(c.status))
console.log(`${targets.length} to void${apply ? '' : ' [dry run — pass --apply]'}`)
if (!apply) process.exit(0)
const ids = targets.map((c) => c.id)
if (ids.length) {
  const { error } = await db.from('timecards').update({ status: 'void', void_reason: REASON, voided_by: 'scripts/pl486 (Scarlett, batch 52)', voided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in('id', ids)
  if (error) { console.error('FAIL', error.message); process.exit(1) }
  await db.from('sessions').update({ timecard_id: null }).in('timecard_id', ids)
  await db.from('tutoring_sessions').update({ timecard_id: null }).in('timecard_id', ids)
}
console.log(`voided ${ids.length}`)
