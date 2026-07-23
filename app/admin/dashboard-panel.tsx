'use client'

import { useCallback, useEffect, useState } from 'react'

// PL-100: the landing dashboard. Needs Attention mirrors the alert family
// but is STATE-DRIVEN — the API recomputes every row from live state, and
// this panel refetches on a light interval, so resolving a condition from
// ANY path (email link, record page, portal) clears its row here without
// anyone touching the dashboard. Recent Activity is read-only.

type AttentionRow = { id: string; kind: string; text: string; href: string; urgent?: boolean }
type ActivityRow = { id: string; when: string; text: string; href: string }
type UpcomingClass = {
  id: string
  label: string
  startDate: string
  paid: number
  min: number | null
  href: string
}

export default function DashboardPanel() {
  const [attention, setAttention] = useState<AttentionRow[] | null>(null)
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [upcoming, setUpcoming] = useState<UpcomingClass[]>([])
  const [weekSessions, setWeekSessions] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/dashboard')
    if (!res.ok) {
      setError('Could not load the dashboard.')
      return
    }
    const json = await res.json()
    setAttention(json.attention)
    setActivity(json.activity)
    setUpcoming(json.upcoming)
    setWeekSessions(json.weekSessions)
    setError('')
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60000) // rows clear as conditions resolve anywhere
    return () => clearInterval(t)
  }, [load])

  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Needs Attention — the star */}
      <div className="bg-white rounded-lg shadow-md border-t-4 border-amber-500 p-5 lg:row-span-2">
        <h2 className="text-lg font-bold text-hgl-slate mb-1">
          Needs attention
          {attention !== null && attention.length > 0 && (
            <span className="ml-2 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
              {attention.length}
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Live conditions, not sent emails — fixing something anywhere clears its row here.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {attention === null ? (
          <p className="text-sm text-gray-400 animate-pulse">Checking every condition…</p>
        ) : attention.length === 0 ? (
          <p className="text-sm text-green-700">✓ Nothing needs attention right now.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {attention.map((r) => (
              <li key={r.id} className="py-2">
                <a href={r.href} className="block group">
                  <span
                    className={`text-[10px] uppercase tracking-wide font-bold ${
                      r.urgent ? 'text-red-700' : 'text-amber-700'
                    }`}
                  >
                    {r.kind}
                  </span>
                  <span className="block text-gray-700 group-hover:text-hgl-blue">{r.text}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-5">
        <h2 className="text-lg font-bold text-hgl-slate mb-1">Recent activity</h2>
        <p className="text-xs text-gray-400 mb-3">Informational — nothing here needs action.</p>
        {activity.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Quiet so far.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {activity.map((r) => (
              <li key={r.id} className="py-1.5">
                <a href={r.href} className="block text-gray-700 hover:text-hgl-blue">
                  <span className="text-xs text-gray-400 mr-2">{fmtWhen(r.when)}</span>
                  {r.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Restrained extras */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-5">
          <h2 className="text-sm font-bold text-hgl-slate mb-2">Upcoming classes</h2>
          {upcoming.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No classes starting soon.</p>
          ) : (
            <ul className="text-xs space-y-1.5">
              {upcoming.map((c) => (
                <li key={c.id}>
                  <a href={c.href} className="text-gray-700 hover:text-hgl-blue">
                    <span className="font-semibold text-hgl-slate">{c.label}</span> · starts {c.startDate} ·{' '}
                    {c.paid} paid{c.min != null ? ` / min ${c.min}` : ''}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-md border-t-4 border-purple-400 p-5">
          <h2 className="text-sm font-bold text-hgl-slate mb-2">This week&apos;s tutoring</h2>
          <p className="text-3xl font-bold text-hgl-slate">{weekSessions}</p>
          <p className="text-xs text-gray-400">confirmed 1-on-1 sessions in the next 7 days</p>
          <a href="/admin/tutoring" className="text-xs text-hgl-blue underline">
            open the tutoring page →
          </a>
        </div>
      </div>
    </div>
  )
}
