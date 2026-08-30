import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { runDebouncedPushAudit } from '../../../utils/gcal-sync'

// PL-410: the Google Calendar push doorbell. Google POSTs here when a
// watched calendar changes — with NO event details (headers only). We
// validate the channel id + token against our own gcal_watch_channels row
// (Google signs nothing; the high-entropy token WE minted at watch time is
// the shared secret) and treat anything unverifiable as noise, never as
// data: 200-and-drop, the quo-webhook pattern, so an unknown/forged/stale
// channel is acknowledged without action and Google doesn't retry-storm.
// A verified push stamps last_push_at and schedules the debounced per-
// calendar audit in after() — a mass-delete burst coalesces to ONE audit
// pass and (PL-402 once-only grouping) at most ONE email. The hourly poll
// remains the backstop; this route only accelerates it.

export const runtime = 'nodejs'
// The debounced audit sleeps 15s inside after() — the default 10s function
// window would kill it before the audit ran (found live in the E2E: the
// push stamped last_push_at and then died silently). 60s covers the sleep +
// the per-calendar Google list comfortably.
export const maxDuration = 60

export async function POST(req: Request) {
  const channelId = req.headers.get('x-goog-channel-id')
  const token = req.headers.get('x-goog-channel-token')
  const state = req.headers.get('x-goog-resource-state')

  if (!channelId || !token) {
    return NextResponse.json({ ok: true, ignored: 'missing channel headers' })
  }
  const { data: row } = await supabase
    .from('gcal_watch_channels')
    .select('id, channel_token')
    .eq('channel_id', channelId)
    .maybeSingle()
  if (!row || row.channel_token !== token) {
    console.warn(`gcal push dropped — unverifiable channel ${channelId.slice(0, 8)}…`)
    return NextResponse.json({ ok: true, ignored: 'unverifiable' })
  }
  // 'sync' = the registration handshake — acknowledge, nothing changed.
  if (state === 'sync') return NextResponse.json({ ok: true })

  const stamp = new Date().toISOString()
  await supabase
    .from('gcal_watch_channels')
    .update({ last_push_at: stamp, updated_at: stamp })
    .eq('id', row.id)
  // INLINE (see runDebouncedPushAudit's comment): the E2E proved after()
  // callbacks die silently on this platform, so the ~5s coalesce + audit run
  // before the response. Google tolerates the slower 200 (and its retries
  // are dropped harmlessly by the ownership check).
  let audit: string = 'skipped'
  try {
    audit = await runDebouncedPushAudit(row.id, stamp)
  } catch (e) {
    console.error('gcal push audit failed (hourly poll backstops):', e)
  }
  return NextResponse.json({ ok: true, audit })
}
