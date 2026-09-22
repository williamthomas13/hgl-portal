#!/usr/bin/env node
// PL-475: the manual sweep trigger that replaced the GitHub Actions
// "Run workflow" button (the workflow was retired when the Vercel cron went
// hourly on Pro). Hits /api/cron/reminders on production with the bearer
// secret from .env.local and prints the sweep's own JSON. Safe to run any
// time — the sweep is idempotent (every send dedupes, claims are optimistic).
//
//   node scripts/run-sweep.mjs                 → production
//   node scripts/run-sweep.mjs http://localhost:3000   → a local server
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
const secret = env.CRON_SECRET
if (!secret) { console.error('need CRON_SECRET in .env.local'); process.exit(1) }

const base = (process.argv[2] ?? env.PRODUCTION_BASE_URL ?? 'https://hgl-portal.vercel.app').replace(/\/+$/, '')
const url = `${base}/api/cron/reminders`
console.log(`GET ${url}`)
const started = Date.now()
const res = await fetch(url, {
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(600_000),
})
const body = await res.text()
console.log(`HTTP ${res.status} in ${Math.round((Date.now() - started) / 1000)}s`)
console.log(body)
if (res.status !== 200) process.exit(1)
