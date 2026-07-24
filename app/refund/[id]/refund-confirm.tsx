'use client'

import { useState } from 'react'

// PL-128: the one-tap refund request confirm. GET rendered this page with
// no side effect (bot prefetchers stamp nothing); the button POSTs the
// actual request. Copy rules: nothing to justify, a human off-ramp for the
// unsure, and the transferable/never-expire reassurance beside the choice.

export default function RefundConfirm({
  enrollmentId,
  token,
  studentFirst,
  classLabel,
  addonHours,
  contactEmail,
  initialState,
}: {
  enrollmentId: string
  token: string
  studentFirst: string
  classLabel: string
  addonHours: number
  contactEmail: string
  initialState: 'ready' | 'already_requested' | 'already_converted' | 'already_refunded'
}) {
  const [state, setState] = useState<string>(initialState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function requestRefund() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentId, token }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong — please reply to our email instead.')
      return
    }
    setState(json.state === 'requested' ? 'requested' : json.state)
  }

  if (state === 'already_refunded') {
    return <p className="text-gray-700">This refund has already been issued — nothing more to do. 💙</p>
  }
  if (state === 'already_converted') {
    return (
      <p className="text-gray-700">
        This payment was already converted to 1-on-1 tutoring hours — those are {studentFirst}&apos;s
        and never expire. If something doesn&apos;t look right, write to{' '}
        <a href={`mailto:${contactEmail}`} className="text-hgl-blue underline">{contactEmail}</a>.
      </p>
    )
  }
  if (state === 'already_requested' || state === 'requested') {
    return (
      <div className="space-y-3 text-gray-700">
        <p className="font-semibold text-hgl-slate">
          ✓ Your refund request is on our list{state === 'already_requested' ? ' (it already was)' : ''}.
        </p>
        <p>
          Nothing else to do — we issue it promptly and the refund lands back on your original
          payment method. You&apos;ll see it on your statement within a few business days of it
          being issued.
        </p>
        {addonHours > 0 && (
          <p className="text-sm text-gray-600">
            The {addonHours} discounted 1-on-1 tutoring hours you purchased are still{' '}
            {studentFirst}&apos;s to keep — they&apos;re transferable and never expire.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 text-gray-700">
      <p>
        One tap and the refund of {studentFirst}&apos;s {classLabel} fee goes on our list — no
        explanation needed, and we issue it promptly to your original payment method.
      </p>
      {addonHours > 0 && (
        <p className="text-sm text-gray-600">
          (The {addonHours} discounted 1-on-1 tutoring hours you already purchased stay{' '}
          {studentFirst}&apos;s either way — transferable, and they never expire.)
        </p>
      )}
      <button
        onClick={requestRefund}
        disabled={busy}
        className="bg-hgl-slate text-white font-bold py-3 px-6 rounded-md hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Request my refund'}
      </button>
      <p className="text-sm text-gray-500">
        Unsure which way to go? Write to{' '}
        <a href={`mailto:${contactEmail}`} className="text-hgl-blue underline">{contactEmail}</a>{' '}
        and we&apos;ll talk it through — there&apos;s no rush and no pressure either way.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
