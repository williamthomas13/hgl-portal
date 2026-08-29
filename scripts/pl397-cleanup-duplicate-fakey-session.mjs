#!/usr/bin/env node
// PL-397/PL-401 one-time cleanup: the [Mon 16:00 ×2] duplicated-recurrence
// bug (fixed at the generator in batch 40) left ONE duplicate live session
// pair in the data — Fakey, Mon Aug 31 2026 16:00 Denver, two confirmed
// uninvoiced rows created together on Jul 28. This deletes the second row
// (03be6d61…) and its Google event; the first (f71d414e…) stays. The
// duplicate-pair scan that found it: group live sessions by
// (engagement_id, starts_at) — exactly one group had two rows.
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

const out = path.join(root, 'scripts', '.tmp-build-dupclean')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/gcal.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
  { stdio: 'inherit' }
)
const require_ = createRequire(import.meta.url)
const gcal = require_(path.join(out, 'gcal.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const DOOMED = '03be6d61-a5c4-434b-872f-daa894940649' // the second twin row
const KEEP = 'f71d414e-fbfa-44d0-afbb-009ceee5e71f'

const { data: doomed } = await db
  .from('tutoring_sessions')
  .select('id, starts_at, status, invoice_id, gcal_event_id, instructors ( email, google_calendar_id )')
  .eq('id', DOOMED)
  .maybeSingle()
const { data: keep } = await db.from('tutoring_sessions').select('id, starts_at, status').eq('id', KEEP).maybeSingle()
if (!doomed) { console.log('duplicate row already gone — nothing to do'); process.exit(0) }
if (!keep || keep.starts_at !== doomed.starts_at) { console.error('safety check failed: twin mismatch'); process.exit(1) }
if (doomed.invoice_id) { console.error('safety check failed: doomed row is invoiced'); process.exit(1) }

const conn = await gcal.loadGcalConnection()
const tutor = Array.isArray(doomed.instructors) ? doomed.instructors[0] : doomed.instructors
if (doomed.gcal_event_id && conn?.key && conn.status === 'connected' && tutor?.email) {
  await gcal.deleteGcalEvent(conn.key, tutor.email, tutor.google_calendar_id ?? null, doomed.gcal_event_id)
  console.log('google event deleted:', doomed.gcal_event_id)
}
const { error } = await db.from('tutoring_sessions').delete().eq('id', DOOMED)
if (error) { console.error('row delete failed:', error.message); process.exit(1) }
console.log('duplicate session row deleted:', DOOMED, '— kept', KEEP)
rmSync(out, { recursive: true, force: true })
