import { supabaseAdmin as supabase } from './supabase-admin'
import type { SystemHealth } from '../admin/system-health-card'

// PL-136 (extracted for PL-331): the three numbers that fail quietly when
// they fail — Resend quota, QBO sync queue, hourly-sweep freshness. ONE
// computation, two surfaces: the admin dashboard card and the manager's
// Settings → System health section can never disagree.

export type SweepRecovery = { at: string; gapMinutes: number } | null

export async function computeSystemHealth(
  now: Date
): Promise<{ health: SystemHealth; recovery: SweepRecovery }> {
  const dayStartDenver = new Date(
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) + 'T00:00:00-06:00'
  ).toISOString()
  const [
    { data: capRow },
    { count: sendsToday },
    { count: campaignToday },
    { count: qboPendingCount },
    { count: qboFailedCount },
    { data: sweepRows },
  ] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'resend_daily_cap').maybeSingle(),
    // Real sends AND test sends both consume the plan's quota.
    supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'delivered', 'bounced', 'complained'])
      .gte('sent_at', dayStartDenver),
    // PL-201: campaign volume shown distinctly on the health card
    // (campaign sends are the dedupe keys the engine mints).
    supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .like('dedupe_key', 'campaign:%')
      .in('status', ['sent', 'delivered', 'bounced', 'complained'])
      .gte('sent_at', dayStartDenver),
    supabase.from('qbo_sync_log').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('qbo_sync_log').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['cron_sweep_started_at', 'cron_sweep_finished_at', 'sweep_recovered_note']),
  ])
  const sweepMap = Object.fromEntries(
    (((sweepRows as { key: string; value: string }[] | null) ?? [])).map((r) => [r.key, r.value])
  )
  const finishedAt = sweepMap.cron_sweep_finished_at ?? null
  const startedAt = sweepMap.cron_sweep_started_at ?? null

  // PL-273: the sweep's own recovery note (the dashboard turns it into an
  // activity-feed line). An unparseable note is not worth failing over.
  let recovery: SweepRecovery = null
  try {
    const rec = sweepMap.sweep_recovered_note ? JSON.parse(sweepMap.sweep_recovered_note) : null
    if (rec?.at) recovery = { at: rec.at, gapMinutes: Number(rec.gapMinutes ?? 0) }
  } catch {
    recovery = null
  }

  const cap = Number(capRow?.value ?? 100)
  const used = sendsToday ?? 0
  const health: SystemHealth = {
    sends: {
      today: used,
      campaignToday: campaignToday ?? 0,
      cap,
      state: used >= cap ? 'full' : used >= cap * 0.8 ? 'warn' : 'ok',
    },
    qbo: { pending: qboPendingCount ?? 0, failed: qboFailedCount ?? 0 },
    sweep: {
      lastFinishedAt: finishedAt,
      // The sweep is HOURLY (GitHub Actions; the daily Vercel cron is only a
      // backstop) and the hourly assumption is load-bearing — PL-144 catch-up,
      // failed-send flushing, campaign resumes. GH Actions cron is
      // best-effort, so allow ~15 minutes of start slack: more than 75
      // minutes without finishing is a stall, and a stalled sweep stops the
      // whole email lifecycle silently.
      stale: !finishedAt || now.getTime() - new Date(finishedAt).getTime() > 75 * 60_000,
      // Started much later than it finished = the current run is hanging.
      hanging: Boolean(
        startedAt &&
          (!finishedAt || startedAt > finishedAt) &&
          now.getTime() - new Date(startedAt).getTime() > 20 * 60_000
      ),
    },
  }
  return { health, recovery }
}
