'use client'

import { useCallback, useEffect, useState } from 'react'

// PL-213: Team access — the manager role finally has a UI (it used to be a
// hand-edited profiles.role in SQL). Admin-only: the GET 403s managers, so
// the panel never renders for them (the ContactSettingsPanel pattern).
// Admins are read-only here BY DESIGN — admin comes from the ADMIN_EMAILS
// env allowlist, and keeping it out of the UI keeps privilege escalation
// impossible. Tutors/counselors/parents aren't managed here either: their
// access derives from data (tutors panel, affiliations, family records).

type ProfileRow = { email: string; role: 'admin' | 'manager'; allowlisted: boolean }
type AuditRow = { at: string; actor_email: string; action: string; target_email: string; detail: string | null }

export default function TeamAccessPanel() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [allowlistOnly, setAllowlistOnly] = useState<string[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [visible, setVisible] = useState(false)
  const [grantEmail, setGrantEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(() => {
    fetch('/api/admin/team-access')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return
        setProfiles(json.profiles ?? [])
        setAllowlistOnly(json.allowlistOnly ?? [])
        setAudit(json.audit ?? [])
        setVisible(true)
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function change(action: 'grant' | 'revoke', email: string) {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/team-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email }),
      })
      const json = await res.json().catch(() => ({}))
      setMessage(
        res.ok
          ? action === 'grant'
            ? `${email} is now a manager — they can sign in with just that email.`
            : `Manager access removed for ${email} — their login falls back to whatever their record grants (${json.demotedTo}).`
          : 'Error: ' + json.error
      )
      if (res.ok) {
        setGrantEmail('')
        load()
      }
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  const admins = profiles.filter((p) => p.role === 'admin')
  const managers = profiles.filter((p) => p.role === 'manager')

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-6 space-y-5">
      <div>
        <h2 className="text-lg font-bold text-hgl-slate">Team access</h2>
        {/* PL-236: matches the PL-213/223/226 access model — the login gate
            is instructors.active, edited on Contacts → Instructors; the
            tutors panel's retire is access-aware. */}
        <p className="text-xs text-gray-500 mt-1">
          Who can open the admin side, and how everyone else&apos;s access works. Instructors and
          tutors sign in while they&apos;re active on Contacts → Instructors (deactivating them
          there ends their login; retiring a tutor-only person from the tutors panel ends it
          too — the retire dialog says which applies); school contacts sign in while their
          affiliation is open; families always can. Nothing here deletes history — access ends,
          records stay.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-bold text-hgl-slate mb-1">Admins</h3>
        <p className="text-xs text-gray-500 mb-2">
          {/* PL-221: {' '} — the compiler eats a bare inline-boundary space (PL-215 rule). */}
          Admin access comes from the <code>ADMIN_EMAILS</code>{' '}environment allowlist (changed in
          Vercel, not here) — read-only by design, so there&apos;s no way to escalate access from
          inside the portal.
        </p>
        <ul className="text-sm text-gray-700 space-y-0.5">
          {admins.map((p) => (
            <li key={p.email}>
              {p.email}
              {!p.allowlisted && (
                <span className="text-xs text-amber-700 ml-2">
                  — not on the current allowlist (their admin role predates it; it stands until
                  the allowlist says otherwise)
                </span>
              )}
            </li>
          ))}
          {allowlistOnly.map((e) => (
            <li key={e}>
              {e} <span className="text-xs text-gray-500 ml-1">— allowlisted, hasn&apos;t signed in yet</span>
            </li>
          ))}
          {admins.length === 0 && allowlistOnly.length === 0 && (
            <li className="text-gray-500 italic">No admins found — check ADMIN_EMAILS.</li>
          )}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-bold text-hgl-slate mb-1">Managers</h3>
        <p className="text-xs text-gray-500 mb-2">
          Managers see the whole admin side except the owner-level corners (QuickBooks connection,
          revenue, pay-type edits). Grant it to a teammate the portal already knows — a tutor,
          school contact, or family email.
        </p>
        <ul className="text-sm text-gray-700 space-y-1 mb-3">
          {managers.map((p) => (
            <li key={p.email} className="flex items-center gap-3">
              {p.email}
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove manager access for ${p.email}? Their login falls back to whatever their record grants (tutor, school contact, or family view).`))
                    change('revoke', p.email)
                }}
                className="text-xs text-red-700 underline"
              >
                remove
              </button>
            </li>
          ))}
          {managers.length === 0 && <li className="text-gray-500 italic">No managers yet.</li>}
        </ul>
        <div className="flex gap-2 items-center">
          <input
            type="email"
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            placeholder="teammate@highergroundlearning.com"
            className="border border-gray-300 rounded-md p-2 text-sm w-72"
          />
          <button
            disabled={busy || !grantEmail.trim()}
            onClick={() => change('grant', grantEmail.trim())}
            className="bg-hgl-slate text-white text-sm font-semibold rounded-md px-4 py-2 disabled:opacity-50"
          >
            Grant manager
          </button>
        </div>
      </div>

      {audit.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-hgl-slate mb-1">Recent changes</h3>
          <ul className="text-xs text-gray-600 space-y-0.5">
            {audit.map((a, i) => (
              <li key={i}>
                {new Date(a.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{' '}
                — {a.actor_email} {a.action === 'grant_manager' ? 'granted manager to' : 'removed manager from'}{' '}
                {a.target_email}
                {a.detail ? <span className="text-gray-500"> ({a.detail})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <div
          className={`p-3 rounded text-center font-semibold text-sm ${
            message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
