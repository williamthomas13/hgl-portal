'use client'

import { useState } from 'react'

// Consent click → Stripe-hosted setup session. The checkbox is the explicit
// consent record (spec §3: "collected through a portal flow with explicit
// consent language; never store card data ourselves").

export default function AutopayConsent({ token }: { token: string }) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/tutoring/autopay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong — please try again or get in touch.')
      setBusy(false)
      return
    }
    window.location.assign(json.url)
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span>
          I authorize Higher Ground Learning to automatically charge my saved payment method for
          each month&apos;s confirmed tutoring invoice, until I turn autopay off.
        </span>
      </label>
      <button
        disabled={!agreed || busy}
        onClick={start}
        className="bg-hgl-slate text-white py-2.5 px-6 rounded font-bold hover:opacity-90 disabled:opacity-50"
      >
        Save a payment method →
      </button>
      {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
    </div>
  )
}
