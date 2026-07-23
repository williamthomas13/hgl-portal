'use client'

import { useEffect, useState } from 'react'

// PL-92: the webhook-mismatch alert's "Match to an enrollment" landing —
// the enrollments view pre-filtered to the payer's email, with the
// one-click "Attach this payment" that runs the full paid-webhook
// consequences (admin-authed; the email button never acts by itself).

type Candidate = {
  id: string
  status: string
  enrolledAt: string
  alreadyThisSession: boolean
  student: string
  classLabel: string
  emails: string[]
}

type Payload = {
  session: {
    id: string
    paid: boolean
    amount: number | null
    payerEmail: string | null
    payerName: string | null
    created: string | null
  }
  matching: Candidate[]
  unpaid: Candidate[]
}

export default function MatchPayment() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState('')

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const s = q.get('session')
    if (!s) {
      setError('No Stripe session in the link — open this page from the payment-mismatch alert.')
      return
    }
    setSessionId(s)
    fetch(`/api/admin/attach-payment?session=${encodeURIComponent(s)}&email=${encodeURIComponent(q.get('email') ?? '')}`)
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok) setError(json.error ?? 'Could not load the payment.')
        else setData(json)
      })
      .catch(() => setError('Could not load the payment.'))
  }, [])

  async function attach(c: Candidate) {
    if (
      !confirm(
        `Attach this payment to ${c.student} — ${c.classLabel}?\n\nThis runs everything the webhook would have: confirmation email, class sequence, payment-reminder cancellation, QuickBooks.`
      )
    )
      return
    setBusy(c.id)
    const res = await fetch('/api/admin/attach-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, enrollmentId: c.id }),
    })
    const json = await res.json()
    setBusy('')
    if (!res.ok) setError(json.error ?? 'Attach failed.')
    else setDone(`${c.student} — ${c.classLabel}${json.already ? ' (was already attached)' : ''}`)
  }

  const Row = ({ c }: { c: Candidate }) => (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded bg-gray-50 border border-gray-200">
      <span className="font-semibold text-hgl-slate">{c.student}</span>
      <span className="text-gray-600 text-sm">{c.classLabel}</span>
      <span className="text-xs text-gray-400">{c.emails[0] ?? ''}</span>
      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 font-semibold">{c.status}</span>
      {c.alreadyThisSession && (
        <span className="text-xs text-emerald-700 font-semibold">already carries this session id</span>
      )}
      <button
        disabled={busy !== ''}
        onClick={() => attach(c)}
        className="ml-auto px-3 py-1.5 rounded bg-hgl-blue text-white text-sm font-bold disabled:opacity-50"
      >
        {busy === c.id ? 'Attaching…' : 'Attach this payment'}
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-bold text-hgl-slate">Match a Stripe payment</h1>
          <a href="/admin" className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate">
            ← Back to admin
          </a>
        </div>
        {error && <div className="p-3 rounded bg-red-100 text-red-700 font-semibold text-sm">{error}</div>}
        {done && (
          <div className="p-4 rounded bg-green-100 text-green-800 font-semibold">
            Attached to {done}. Confirmation, sequence scheduling, reminder cancellation, and
            QuickBooks all ran — the family record now reads exactly as if the webhook had matched.
          </div>
        )}
        {data && (
          <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-6 space-y-4">
            <p className="text-sm text-gray-700">
              Stripe checkout <code className="text-xs">{data.session.id}</code> —{' '}
              <strong>{data.session.amount != null ? `$${data.session.amount.toLocaleString()}` : '—'}</strong>
              {data.session.payerName ? ` from ${data.session.payerName}` : ''}
              {data.session.payerEmail ? ` (${data.session.payerEmail})` : ''} ·{' '}
              {data.session.paid ? 'paid' : 'NOT PAID'}
            </p>
            {!done && (
              <>
                <div>
                  <h2 className="font-bold text-hgl-slate mb-2">
                    Matching the payer&apos;s email ({data.matching.length})
                  </h2>
                  {data.matching.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">
                      No enrollment carries this email — pick from the recent unpaid list below.
                    </p>
                  ) : (
                    <div className="space-y-2">{data.matching.map((c) => <Row key={c.id} c={c} />)}</div>
                  )}
                </div>
                <div>
                  <h2 className="font-bold text-hgl-slate mb-2">Recent unpaid enrollments</h2>
                  {data.unpaid.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">None.</p>
                  ) : (
                    <div className="space-y-2">{data.unpaid.map((c) => <Row key={c.id} c={c} />)}</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
