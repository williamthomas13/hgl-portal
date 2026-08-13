'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVisibleInterval } from '../components/use-visible-interval'

// PL-136/331: the System health numbers, rendered ONE way. The admin
// dashboard card and the manager's Settings → System health section both
// use SystemHealthBody, so the two surfaces can never drift. The type lives
// here (client-safe leaf) — the server computation in utils/system-health.ts
// imports it type-only.

export type SystemHealth = {
  sends: { today: number; campaignToday: number; cap: number; state: 'ok' | 'warn' | 'full' }
  qbo: { pending: number; failed: number }
  sweep: { lastFinishedAt: string | null; stale: boolean; hanging: boolean }
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function SystemHealthBody({ health }: { health: SystemHealth }) {
  return (
    <ul className="space-y-2 text-sm">
      <li className="flex items-baseline justify-between gap-3">
        <span className="text-gray-600">
          Emails sent today
          {health.sends.campaignToday > 0 && (
            <span className="text-gray-400"> ({health.sends.campaignToday} campaign)</span>
          )}
        </span>
        <span
          className={`font-bold ${
            health.sends.state === 'full'
              ? 'text-red-700'
              : health.sends.state === 'warn'
                ? 'text-amber-700'
                : 'text-gray-800'
          }`}
        >
          {health.sends.today} / {health.sends.cap}
          {health.sends.state === 'full' && (
            <span className="block text-[11px] font-normal">
              at the daily cap — sends are failing
            </span>
          )}
          {health.sends.state === 'warn' && (
            <span className="block text-[11px] font-normal">approaching the daily cap</span>
          )}
        </span>
      </li>
      <li className="flex items-baseline justify-between gap-3">
        <span className="text-gray-600">QuickBooks queue</span>
        <span className="font-bold text-gray-800 text-right">
          {health.qbo.pending} waiting
          {health.qbo.failed > 0 && (
            <>
              {' · '}
              {/* PL-298 audit: ?section= without ?tab= landed back on
                  the dashboard — the tab must ride along. */}
              <a href="/admin?tab=settings&section=qbo" className="text-red-700 underline">
                {health.qbo.failed} failed
              </a>
            </>
          )}
        </span>
      </li>
      <li className="flex items-baseline justify-between gap-3">
        <span className="text-gray-600">Hourly sweep</span>
        <span
          className={`font-bold text-right ${
            health.sweep.stale || health.sweep.hanging ? 'text-red-700' : 'text-gray-800'
          }`}
        >
          {health.sweep.lastFinishedAt
            ? `last ran ${fmtWhen(health.sweep.lastFinishedAt)}`
            : 'never recorded'}
          {health.sweep.hanging && (
            <span className="block text-[11px] font-normal">
              a run started and hasn&apos;t finished
            </span>
          )}
          {health.sweep.stale && !health.sweep.hanging && (
            <span className="block text-[11px] font-normal">
              overdue — emails stop going out while it&apos;s down
            </span>
          )}
        </span>
      </li>
    </ul>
  )
}

/** PL-331: the manager's Settings → System health section — same three
 *  numbers the admin dashboard card shows, from the same computation. */
export function SystemHealthSettingsPanel() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/system-health')
      if (!res.ok) {
        setError(`Could not load system health (the server returned ${res.status}).`)
        return
      }
      const json = await res.json().catch(() => null)
      setHealth(json?.health ?? null)
      setError('')
    } catch {
      setError('Could not reach the server — check your connection.')
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  const panelRef = useRef<HTMLDivElement | null>(null)
  useVisibleInterval(panelRef, load, 60000)

  return (
    <div ref={panelRef} className="space-y-3">
      <p className="text-xs text-gray-400">Three numbers that fail quietly when they fail.</p>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : health ? (
        <SystemHealthBody health={health} />
      ) : (
        <p className="text-sm text-gray-400">—</p>
      )}
    </div>
  )
}
