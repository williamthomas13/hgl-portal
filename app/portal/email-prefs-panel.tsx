'use client'

import { useEffect, useState } from 'react'

// PL-327: the tutor's own email-preference card (Teaching view). Only the
// INFORMATIONAL emails are switchable — timecard confirms, schedule-change
// notices, and coverage emails always send (payroll and operations depend
// on them). Staff can see and override these choices on the Instructors
// panel; there is one set of switches, never two that can disagree.

type Prefs = {
  pref_notes_reminders: 'on' | 'weekly' | 'off'
  pref_class_digests: 'on' | 'weekly' | 'off'
  pref_fyi_copies: boolean
}

export default function EmailPrefsPanel() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/portal/tutoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_email_prefs' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPrefs(j?.prefs ?? null))
      .catch(() => {})
  }, [])

  if (!prefs) return null

  const save = async (patch: Partial<Prefs>) => {
    setBusy(true)
    setMsg('')
    const next = { ...prefs, ...patch }
    setPrefs(next)
    const res = await fetch('/api/portal/tutoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_email_prefs', prefs: patch }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setMsg(j.error ?? 'That didn’t save — try again.')
      setPrefs(prefs) // roll back the optimistic change
    } else {
      setMsg('Saved.')
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 text-sm">
      <h3 className="font-bold text-hgl-slate mb-1">Email preferences</h3>
      <p className="text-xs text-gray-500 mb-3">
        These cover the informational emails. Timecard confirmations, schedule-change notices,
        and coverage requests always send — payroll and scheduling depend on them.
      </p>
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Session-note reminders</span>
          <select
            value={prefs.pref_notes_reminders}
            disabled={busy}
            onChange={(e) => save({ pref_notes_reminders: e.target.value as Prefs['pref_notes_reminders'] })}
            className="mt-1 block border border-gray-300 rounded p-1.5 bg-white"
          >
            <option value="on">On — a reminder the evening a note is missing</option>
            <option value="weekly">Weekly digest — one Monday rollup</option>
            <option value="off">Off — timecard review still checks for notes</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Class enrollment digests & milestone pings</span>
          <select
            value={prefs.pref_class_digests}
            disabled={busy}
            onChange={(e) => save({ pref_class_digests: e.target.value as Prefs['pref_class_digests'] })}
            className="mt-1 block border border-gray-300 rounded p-1.5 bg-white"
          >
            <option value="on">On — weekly digest plus instant milestone pings</option>
            <option value="weekly">Weekly digest only</option>
            <option value="off">Off — class calendar events stop too</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={prefs.pref_fyi_copies}
            disabled={busy}
            onChange={(e) => save({ pref_fyi_copies: e.target.checked })}
          />
          <span className="text-xs font-semibold text-gray-600">
            FYI copies of the logistics emails your families receive
          </span>
        </label>
      </div>
      {msg && <p className="text-xs mt-2 text-gray-500">{msg}</p>}
    </div>
  )
}
