'use client'

import { useEffect, useState } from 'react'

// PL-422A: the family's email preferences — one honest switch (marketing &
// announcements) plus the "these always send" truth for transactional mail.
// The signed-in twin of the tokenized unsubscribe link, and the one place a
// family can turn marketing back ON.

export default function EmailPrefsFamily() {
  const [marketingOff, setMarketingOff] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/portal/family-prefs')
      .then((r) => r.json())
      .then((j) => setMarketingOff(Boolean(j.marketingOff)))
      .catch(() => setMarketingOff(null))
  }, [])

  async function toggle(next: boolean) {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/portal/family-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketingOff: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setMarketingOff(next)
        setMsg(next ? "Done — no more marketing emails to this address." : "Welcome back — announcements are on again.")
      } else {
        setMsg(`Error: ${json.error ?? res.status}`)
      }
    } catch {
      setMsg("Error: couldn't reach the server.")
    }
    setBusy(false)
  }

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-6">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">Email preferences</h2>
      <div className="flex items-start gap-3 mt-3">
        <input
          id="pref-marketing"
          type="checkbox"
          className="mt-1"
          disabled={busy || marketingOff === null}
          checked={marketingOff === false}
          onChange={(e) => toggle(!e.target.checked)}
        />
        <label htmlFor="pref-marketing" className="text-sm text-gray-700">
          <span className="font-semibold text-hgl-slate">Class announcements &amp; offers</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            New classes at your school, follow-up courses, and occasional offers. This covers
            emails to your address; a student who unsubscribed from their own decides separately.
          </span>
        </label>
      </div>
      <p className="text-xs text-gray-500 mt-4 bg-gray-50 rounded p-2.5">
        Emails about things you&apos;ve signed up for — registrations, schedules, session changes,
        billing and receipts — always send. They&apos;re how we run your student&apos;s program.
      </p>
      {msg && (
        <p className={`text-xs mt-2 font-semibold ${msg.startsWith('Error') ? 'text-red-700' : 'text-green-700'}`}>
          {msg}
        </p>
      )}
    </div>
  )
}
