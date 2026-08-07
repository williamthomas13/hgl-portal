#!/usr/bin/env node
// PL-273: schedule the sweep (and its watcher) on Supabase pg_cron — a
// scheduler independent of GitHub Actions (whose best-effort cron caused the
// Aug 6 outage) and of Vercel (whose Hobby crons are daily-only).
//
//   hgl-hourly-sweep : :05 every hour → /api/cron/reminders
//   hgl-sweep-watch  : :35 every hour → /api/cron/sweep-watch (cheap check;
//                      alerts once per outage on transition to overdue)
//
// The bearer secret rides inside the cron.job command (cron schema — not
// exposed through PostgREST/RLS; visible only to dashboard SQL users, i.e.
// the same people who can read Vercel env vars). This script is idempotent:
// re-running replaces both jobs. Run after the 20260826000001 migration has
// enabled pg_cron + pg_net.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
const token = env.SUPABASE_ACCESS_TOKEN
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const secret = env.CRON_SECRET
if (!token || !secret) { console.error('need SUPABASE_ACCESS_TOKEN + CRON_SECRET in .env.local'); process.exit(1) }

const BASE = 'https://hgl-portal.vercel.app'

const sql = `
do $$ begin perform cron.unschedule('hgl-hourly-sweep'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('hgl-sweep-watch'); exception when others then null; end $$;
select cron.schedule('hgl-hourly-sweep', '5 * * * *', $job$
  select net.http_get(
    url := '${BASE}/api/cron/reminders',
    headers := '{"Authorization": "Bearer ${secret}"}'::jsonb,
    timeout_milliseconds := 590000
  )
$job$);
select cron.schedule('hgl-sweep-watch', '35 * * * *', $job$
  select net.http_get(
    url := '${BASE}/api/cron/sweep-watch',
    headers := '{"Authorization": "Bearer ${secret}"}'::jsonb,
    timeout_milliseconds := 60000
  )
$job$);
select jobname, schedule, active from cron.job order by jobname;
`

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
const body = await res.text()
if (!res.ok) { console.error('FAIL', res.status, body.slice(0, 400)); process.exit(1) }
console.log('pg_cron jobs installed:', body)
