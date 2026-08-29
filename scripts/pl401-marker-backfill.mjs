#!/usr/bin/env node
// PL-401 one-time backfill: legacy events predate the hglSessionId identity
// marker (they only gain it when next patched). Re-enqueue every FUTURE
// synced session and drain the real worker — each patch stamps the marker,
// so a later lost pointer ADOPTS instead of duplicating. Then the adoption
// E2E: null one QA session's pointer, re-sync, and prove the SAME event id
// comes back (adopted, not re-created).
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const env = Object.fromEntries(
  readFileSync(path.join(root, '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
delete process.env.RESEND_API_KEY

const out = path.join(root, 'scripts', '.tmp-build-pl401b')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/gcal-sync.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require_ = createRequire(import.meta.url)
const sync = require_(path.join(out, 'gcal-sync.js'))
const gcal = require_(path.join(out, 'gcal.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: future } = await db
  .from('tutoring_sessions')
  .select('id, starts_at, status, gcal_event_id, students ( first_name )')
  .not('gcal_event_id', 'is', null)
  .in('status', ['confirmed', 'proposed'])
  .gt('starts_at', new Date().toISOString())
console.log(`backfilling markers onto ${future.length} future synced sessions`)
for (const s of future) await sync.enqueueGcalSync(s.id, 'PL-401 marker backfill')
let total = 0
for (let i = 0; i < 10; i++) {
  const r = await sync.processGcalQueue()
  total += r.synced
  if (r.synced === 0 && r.deferred === 0) break
}
console.log(`drained: ${total} synced`)

// ---- adoption E2E on a QA (Fakey) session ---------------------------------
const qa = future.find((s) => s.students?.first_name === 'Fakey')
if (!qa) { console.log('no Fakey session — skipping adoption E2E'); process.exit(0) }
const before = qa.gcal_event_id
console.log(`adoption E2E: session ${qa.id} (${qa.starts_at}), event ${before}`)
await db.from('tutoring_sessions').update({ gcal_event_id: null }).eq('id', qa.id)
await sync.enqueueGcalSync(qa.id, 'PL-401 adoption E2E — pointer lost on purpose')
for (let i = 0; i < 3; i++) { const r = await sync.processGcalQueue(); if (r.synced > 0) break }
const { data: after } = await db.from('tutoring_sessions').select('gcal_event_id').eq('id', qa.id).maybeSingle()
const { data: log } = await db
  .from('gcal_sync_log')
  .select('reason, status, gcal_event_id')
  .eq('session_id', qa.id)
  .order('created_at', { ascending: false })
  .limit(1)
console.log('pointer after re-sync:', after?.gcal_event_id, '| worker note:', log?.[0]?.reason)
if (after?.gcal_event_id === before && /adopted/.test(log?.[0]?.reason ?? '')) {
  console.log('ADOPTION E2E: PASS — same event id, adopted (no twin created)')
} else if (after?.gcal_event_id === before) {
  console.log('ADOPTION E2E: PASS (same id) — note did not say adopted:', log?.[0]?.reason)
} else {
  console.log('ADOPTION E2E: FAIL — pointer changed', before, '→', after?.gcal_event_id)
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
