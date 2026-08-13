'use client'

import { useEffect, useState } from 'react'

// PL-309: Settings → Notifications — who receives which [HGL Admin] alert
// family. The admin grants/revokes categories per staff member and can
// toggle receipt; a manager (PL-332) can switch granted categories on/off
// for herself and other non-admin staff — an admin's rows render read-only
// with the explainer, and the API refuses them regardless. Every alert send
// resolves its recipients from these rows; zero subscribers for a category
// falls back to the legacy ops address so alerts never go nowhere.

type Category = { key: string; label: string }
type StaffRow = { email: string; role: 'admin' | 'manager'; name: string | null }
type SubRow = { email: string; category: string; granted: boolean; enabled: boolean }

export default function NotificationsPanel({
  simulatedManager = false,
}: {
  /** PL-326: render the manager variant regardless of the caller's real
   *  role — used by the view-as manager simulation (read-only anyway). */
  simulatedManager?: boolean
} = {}) {
  const [data, setData] = useState<{
    role: 'admin' | 'manager'
    self: string
    categories: Category[]
    staff: StaffRow[]
    rows: SubRow[]
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch('/api/admin/alert-subscriptions')
    if (!res.ok) return setErr('Could not load notification settings.')
    setData(await res.json())
  }
  useEffect(() => {
    load()
  }, [])

  if (err) return <p className="text-sm text-red-600">{err}</p>
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>

  const rowFor = (email: string, category: string) =>
    data.rows.find((r) => r.email === email && r.category === category)

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusyKey(key)
    setErr(null)
    const res = await fetch('/api/admin/alert-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusyKey(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErr(j.error ?? 'Save failed.')
      return
    }
    await load()
  }

  const isAdmin = data.role === 'admin' && !simulatedManager

  return (
    <div className="space-y-6 text-sm">
      <p className="text-gray-500">
        Every <span className="font-semibold">[HGL Admin]</span> alert belongs to one category
        below. Checked = that person receives those alerts.{' '}
        {isAdmin
          ? 'Granting a category lets a manager switch it on and off themselves; revoking takes it away entirely.'
          : 'You can switch granted categories on and off for yourself and other staff — granting new ones is the admin’s, and an admin’s own rows are read-only here.'}{' '}
        If nobody subscribes to a category, its alerts still go to the ops address — they never
        go nowhere.
      </p>
      {data.staff.map((s) => (
        <div key={s.email} className="border border-gray-200 rounded-lg p-4">
          <p className="font-bold text-hgl-slate mb-2">
            {s.email}{' '}
            <span className="text-xs font-normal text-gray-400 uppercase">{s.role}</span>
          </p>
          {/* PL-332: the plain-English explainer where the control would be. */}
          {!isAdmin && s.role === 'admin' && (
            <p className="text-xs text-gray-500 italic mb-2">
              Only {s.name ?? s.email} can change an owner&apos;s notifications.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {data.categories.map((c) => {
              const row = rowFor(s.email, c.key)
              const granted = row?.granted ?? false
              const enabled = (row?.enabled ?? false) && granted
              const key = `${s.email}:${c.key}`
              // PL-332: managers toggle granted categories for any NON-ADMIN
              // staff member (self included); an admin's rows are read-only.
              const canToggle = isAdmin || (granted && s.role !== 'admin')
              return (
                <div key={c.key} className="flex items-center gap-2">
                  <label className={`flex items-center gap-2 ${canToggle ? '' : 'opacity-60'}`}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={!canToggle || busyKey === key}
                      onChange={(e) =>
                        post(
                          isAdmin
                            ? { email: s.email, category: c.key, granted: true, enabled: e.target.checked }
                            : { email: s.email, category: c.key, enabled: e.target.checked },
                          key
                        )
                      }
                    />
                    <span>{c.label}</span>
                  </label>
                  {granted && !enabled && (
                    <span className="text-xs text-gray-400">granted — switched off</span>
                  )}
                  {!granted && !isAdmin && s.role !== 'admin' && (
                    <span className="text-xs text-gray-400">not granted</span>
                  )}
                  {isAdmin && s.role === 'manager' && granted && (
                    <button
                      type="button"
                      disabled={busyKey === key}
                      onClick={() => post({ email: s.email, category: c.key, granted: false }, key)}
                      className="text-xs text-gray-400 underline hover:text-red-700"
                      title="Take this category away entirely — they can no longer switch it on themselves"
                    >
                      revoke
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {data.staff.every((s) => s.role !== 'manager') && isAdmin && (
        <p className="text-xs text-gray-400">
          No manager account exists yet — when one is created, it starts with the tutoring-side
          categories (reschedule requests, timecards, coverage) plus duplicate-people prompts,
          and appears here automatically.
        </p>
      )}
    </div>
  )
}
