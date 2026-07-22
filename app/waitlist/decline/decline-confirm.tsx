'use client'

import { useState } from 'react'

// PL-72: the decline is a JS-executed POST behind one visible tap — a mail
// scanner prefetching the GET link can never silently give a spot away.

export default function DeclineConfirm({
  enrollmentId,
  token,
  classLabel,
}: {
  enrollmentId: string
  token: string
  classLabel: string
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState('')

  async function release() {
    setState('busy')
    setError('')
    try {
      const res = await fetch('/api/waitlist/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId, token }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again or just reply to our email.')
        setState('idle')
        return
      }
      setState('done')
    } catch {
      setError('Something went wrong — please try again or just reply to our email.')
      setState('idle')
    }
  }

  if (state === 'done') {
    return (
      <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
        <strong>Done — the spot is released.</strong> The next family in line is being offered it
        right now. You&apos;re still on our list for the next {classLabel} course. Thanks for
        letting us know!
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <button
        disabled={state === 'busy'}
        onClick={release}
        className="bg-hgl-slate text-white py-2.5 px-6 rounded font-bold hover:opacity-90 disabled:opacity-50"
      >
        {state === 'busy' ? 'Releasing…' : 'Release the spot'}
      </button>
      {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
    </div>
  )
}
