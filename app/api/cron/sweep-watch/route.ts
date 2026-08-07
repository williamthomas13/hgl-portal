import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sendAdminAlert } from '../../../utils/email'
import { ADMIN_EMAIL } from '../../../utils/lifecycle'
import { emailBaseUrl } from '../../../utils/base-url'

// PL-273: the watcher for the watcher. The hourly sweep is load-bearing —
// reminders, counselor nudges, timecard creation, the whole comms cadence
// stop when it's down — and the Aug 6 outage showed the dashboard's
// "overdue" card is only useful if someone happens to look at it. This
// route is CHEAP (two app_settings reads, at most one email) and runs from
// pg_cron on Supabase — a scheduler independent of both GitHub Actions
// (which failed) and Vercel (whose Hobby crons are daily-only).
//
// Fires ON TRANSITION to overdue, not every check while it stays down: the
// latch key sweep_overdue_alerted_for records which last-finish stamp was
// alerted; the sweep's own recovery path clears it. Thresholds mirror the
// dashboard card exactly (75 min stale / 20 min hanging, PL-136).

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['cron_sweep_started_at', 'cron_sweep_finished_at', 'sweep_overdue_alerted_for'])
  const get = (k: string) => rows?.find((r) => r.key === k)?.value ?? null
  const startedAt = get('cron_sweep_started_at')
  const finishedAt = get('cron_sweep_finished_at')
  const alertedFor = get('sweep_overdue_alerted_for')

  const now = Date.now()
  const stale = !finishedAt || now - new Date(finishedAt).getTime() > 75 * 60_000
  const hanging = Boolean(
    startedAt &&
      (!finishedAt || startedAt > finishedAt) &&
      now - new Date(startedAt).getTime() > 20 * 60_000
  )

  if (!stale && !hanging) {
    return NextResponse.json({ ok: true, state: 'healthy' })
  }

  // One alert per outage: the latch is the last-finish stamp at alert time.
  const marker = finishedAt ?? 'never'
  if (alertedFor === marker) {
    return NextResponse.json({ ok: true, state: 'overdue', alerted: 'already' })
  }

  const ageMinutes = finishedAt ? Math.round((now - new Date(finishedAt).getTime()) / 60_000) : null
  const status = await sendAdminAlert({
    dedupeKey: `sweep_overdue:${marker}`,
    adminEmail: ADMIN_EMAIL,
    templateKey: 'AL_SWEEP_OVERDUE',
    vars: {},
    subject: 'Hourly sweep is DOWN — emails are not going out',
    body: `<p><strong>The hourly sweep is overdue.</strong> ${
      finishedAt
        ? `The last completed run finished <strong>${ageMinutes} minutes ago</strong> (${new Date(finishedAt).toLocaleString('en-US', { timeZone: 'America/Denver' })} Denver).`
        : 'No completed run is on record at all.'
    }${
      hanging
        ? ' A run started since then and has not finished — it may be hanging.'
        : ''
    }</p>
      <p>While it's down, nothing sends: reminders, counselor nudges, waitlist offers, billing
      generation, timecard creation — the whole cadence is paused. Nothing is lost — every send
      is deduped and claims are retry-safe, so the next successful run delivers the backlog.</p>
      <p><strong>To recover:</strong> re-run the sweep manually — GitHub → Actions → "hourly-sweep"
      → Run workflow (this is exactly what fixed the Aug 6 outage), or ask Code to hit the
      endpoint. The dashboard's health card shows live status.</p>
      <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin" style="display:inline-block;background:#b91c1c;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open the dashboard health card</a></p>
      <p>You'll get one email per outage (not one per hour); the next successful sweep notes its
      own recovery in the dashboard activity feed.</p>`,
  })

  await supabase.from('app_settings').upsert({ key: 'sweep_overdue_alerted_for', value: marker })
  return NextResponse.json({ ok: true, state: 'overdue', alerted: status })
}
