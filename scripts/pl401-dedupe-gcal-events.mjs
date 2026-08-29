#!/usr/bin/env node
// PL-401 one-time cleanup: delete DUPLICATE portal-synced tutoring events
// from tutors' real Google calendars. The sync's pointer-only identity let a
// lost pointer write (and retries after it) mint twins — Billy's calendar
// showed the same session 4×. The sync is now idempotent (identity marker +
// adopt-before-create + checked pointer write); this sweep removes the twins
// already on calendars.
//
// Deletion gate (portal-created events ONLY, per the batch-41 doc):
//   an event is deletable iff its title matches the portal's tutoring-title
//   grammar (isPortalSyncedTutoringTitle) AND it is NOT any session's current
//   gcal_event_id AND one of:
//     (a) it carries the PL-401 hglSessionId marker (portal-created by
//         construction — a marked event some session no longer points at is a
//         superseded twin), or
//     (b) its exact start/end instants equal a session of this tutor whose
//         student's first name appears in the title ("Tutoring: {First} — …")
//         — the shape only the portal writes.
//   Anything else portal-titled but unmatched is REPORTED, never deleted.
//
// Usage:  node scripts/pl401-dedupe-gcal-events.mjs           (dry run)
//         node scripts/pl401-dedupe-gcal-events.mjs --apply   (delete)
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const root = process.cwd()
const env = Object.fromEntries(
  readFileSync(path.join(root, '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
delete process.env.RESEND_API_KEY // belt & suspenders: this script must never email

const out = path.join(root, 'scripts', '.tmp-build-pl401')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/gcal.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const gcal = require(path.join(out, 'gcal.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const conn = await gcal.loadGcalConnection()
if (!conn || conn.status !== 'connected' || !conn.key) {
  console.error('Google connection not available — nothing to sweep.')
  process.exit(1)
}

const timeMin = new Date(Date.now() - 120 * 86400000).toISOString()
const timeMax = new Date(Date.now() + 180 * 86400000).toISOString()

// Every session that has ever synced, joined to student first names.
const { data: sessions, error } = await db
  .from('tutoring_sessions')
  .select('id, tutor_id, starts_at, ends_at, status, gcal_event_id, students ( first_name )')
if (error) throw new Error(error.message)
const pointers = new Set(sessions.filter((s) => s.gcal_event_id).map((s) => s.gcal_event_id))
const byId = new Map(sessions.map((s) => [s.id, s]))
const byTime = new Map() // `${tutor}|${start}|${end}` -> [session]
for (const s of sessions) {
  const k = `${s.tutor_id}|${new Date(s.starts_at).toISOString()}|${new Date(s.ends_at).toISOString()}`
  byTime.set(k, [...(byTime.get(k) ?? []), s])
}

const { data: tutors } = await db
  .from('instructors')
  .select('id, name, email, google_calendar_id')
  .not('email', 'is', null)
const tutorsWithSessions = tutors.filter((t) => sessions.some((s) => s.tutor_id === t.id))

let totalDup = 0, totalDeleted = 0, totalUnmatched = 0
for (const t of tutorsWithSessions) {
  let events
  try {
    events = await gcal.listCalendarEvents(conn.key, t.email, t.google_calendar_id || t.email, timeMin, timeMax)
  } catch (e) {
    console.error(`  ${t.name ?? t.email}: calendar list failed — ${e.message}`)
    continue
  }
  const portalTitled = events.filter((e) => gcal.isPortalSyncedTutoringTitle(e.summary))
  const dups = []
  const unmatched = []
  for (const ev of portalTitled) {
    if (pointers.has(ev.id)) continue // the live, pointed-at copy — keep
    if (ev.hglSessionId) {
      const s = byId.get(ev.hglSessionId)
      // Marked = portal-created by construction. Not the current pointer of
      // its session (or the session is gone) → superseded twin.
      if (!s || s.gcal_event_id !== ev.id) { dups.push(ev); continue }
      continue
    }
    const k = `${t.id}|${ev.start ? new Date(ev.start).toISOString() : ''}|${ev.end ? new Date(ev.end).toISOString() : ''}`
    const candidates = (byTime.get(k) ?? []).filter((s) =>
      (ev.summary ?? '').includes(`Tutoring: ${s.students?.first_name ?? ''} — `)
    )
    if (candidates.length > 0) dups.push(ev)
    else unmatched.push(ev)
  }
  totalDup += dups.length
  totalUnmatched += unmatched.length
  console.log(`\n${t.name ?? t.email}: ${events.length} events in window, ${portalTitled.length} portal-titled, ${dups.length} duplicate(s), ${unmatched.length} portal-titled-but-unmatched (left alone)`)
  for (const ev of dups) console.log(`  DUP  ${ev.start} ${ev.summary} (${ev.id}${ev.hglSessionId ? `, marker=${ev.hglSessionId}` : ''})`)
  for (const ev of unmatched) console.log(`  SKIP ${ev.start} ${ev.summary} (${ev.id}) — no matching session at this exact time`)
  if (APPLY) {
    for (const ev of dups) {
      await gcal.deleteGcalEvent(conn.key, t.email, t.google_calendar_id || null, ev.id)
      totalDeleted++
    }
  }
}
console.log(`\n${APPLY ? 'DELETED' : 'DRY RUN — would delete'} ${APPLY ? totalDeleted : totalDup} duplicate event(s); ${totalUnmatched} portal-titled event(s) left for review.`)
rmSync(out, { recursive: true, force: true })
