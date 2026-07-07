'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'

// Class cancellation form (PHASE4_SPEC §12). Composes the CX email BEFORE
// anything sends: tutoring-conversion offer (on by default, 8 hours), the
// credit-to-next-course offer (optional free-text term), and a per-family
// preview of the computed math (prices differ when add-ons were purchased).
// Confirm posts to /api/admin/cancel-class, which flips the class status
// first — atomically suppressing every scheduled send — then emails Paid
// families (CX), waitlisted families (CX-W), and the school contact (CX-C).

export type PaidPreview = {
  enrollmentId: string
  studentName: string
  parentName: string
  amountPaid: number | null
}

export default function CancelClassPanel({
  classId,
  classLabel,
  classPrice,
  paid,
  waitlistedCount,
  pendingCount,
  onDone,
}: {
  classId: string
  classLabel: string
  classPrice: number
  paid: PaidPreview[]
  waitlistedCount: number
  pendingCount: number
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [tutoringOn, setTutoringOn] = useState(true)
  const [hours, setHours] = useState('8')
  const [creditOn, setCreditOn] = useState(false)
  const [term, setTerm] = useState('')
  const [regularRate, setRegularRate] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || regularRate != null) return
    supabase
      .from('tutoring_packages')
      .select('regular_hourly_rate')
      .eq('active', true)
      .order('hours')
      .limit(1)
      .then(({ data }) => {
        setRegularRate(Number(data?.[0]?.regular_hourly_rate ?? 0) || null)
      })
  }, [open, regularRate])

  const h = Math.max(1, Math.round(Number(hours) || 0))

  function offerMath(amountPaid: number | null) {
    if (!regularRate) return null
    const price = amountPaid ?? classPrice
    const regular = h * regularRate
    return {
      price,
      savingsUsd: Math.round(regular - price),
      savingsPct: Math.round(((regular - price) / regular) * 100),
    }
  }

  async function confirm() {
    if (
      !window.confirm(
        `Cancel ${classLabel}?\n\n` +
          `• ${paid.length} paid famil${paid.length === 1 ? 'y' : 'ies'} get the cancellation email with the options below\n` +
          `• ${pendingCount} pending registration${pendingCount === 1 ? '' : 's'} expire silently\n` +
          `• ${waitlistedCount} waitlisted famil${waitlistedCount === 1 ? 'y' : 'ies'} get the release note\n` +
          `• every scheduled email for this class stops\n\n` +
          `This cannot be undone. Refunds stay manual in Stripe.`
      )
    )
      return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/admin/cancel-class', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          offerHours: tutoringOn ? h : null,
          creditTerm: creditOn ? term.trim() : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Cancellation failed — nothing was sent.')
        setSending(false)
        return
      }
      onDone()
    } catch {
      setError('Cancellation failed — check your connection and try again.')
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-red-600 border border-red-300 rounded px-2 py-1 font-semibold hover:bg-red-50 transition"
      >
        Cancel class…
      </button>
    )
  }

  return (
    <div className="mt-3 border border-red-200 bg-red-50/50 rounded-lg p-4 text-sm space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-red-700">Cancel {classLabel}</h4>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 underline">
          close
        </button>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={tutoringOn} onChange={(e) => setTutoringOn(e.target.checked)} />
        <span>
          Offer to convert the fee into{' '}
          <input
            type="number"
            min={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            disabled={!tutoringOn}
            className="w-16 border rounded p-1 text-center mx-1"
          />{' '}
          1-on-1 tutoring hours
          {regularRate ? (
            <span className="text-gray-500"> (regular rate ${regularRate}/hr → ${(h * regularRate).toLocaleString()} value)</span>
          ) : null}
        </span>
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={creditOn} onChange={(e) => setCreditOn(e.target.checked)} />
        <span>
          Offer credit toward the next course, expected{' '}
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            disabled={!creditOn}
            placeholder="e.g. February or March 2027"
            className="w-56 border rounded p-1 mx-1"
          />
        </span>
      </label>

      <p className="text-xs text-gray-500">
        A full refund is always listed as an option regardless of the toggles.
      </p>

      {paid.length > 0 ? (
        <div>
          <h5 className="font-semibold text-hgl-slate mb-1">
            Preview — {paid.length} paid famil{paid.length === 1 ? 'y' : 'ies'}:
          </h5>
          <ul className="space-y-1">
            {paid.map((p) => {
              const m = offerMath(p.amountPaid)
              return (
                <li key={p.enrollmentId} className="bg-white border border-gray-200 rounded px-2 py-1.5">
                  <strong>{p.studentName}</strong> ({p.parentName}) — paid $
                  {(p.amountPaid ?? classPrice).toLocaleString()}
                  {tutoringOn && m && (
                    <div className="text-xs text-gray-600">
                      → &ldquo;{h} hours for ${m.price.toLocaleString()} — a savings of over{' '}
                      {m.savingsPct}% (USD ${m.savingsUsd.toLocaleString()})&rdquo;
                      {m.savingsUsd <= 0 && (
                        <span className="text-red-600 font-bold"> ⚠ not a savings at these hours</span>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="text-gray-600">No paid enrollments — only the school contact is notified.</p>
      )}
      <p className="text-xs text-gray-500">
        Also: {pendingCount} pending expire silently · {waitlistedCount} waitlisted get the
        release note · school contact gets a heads-up.
      </p>

      <button
        onClick={confirm}
        disabled={sending || (tutoringOn && !regularRate) || (creditOn && !term.trim())}
        className="bg-red-600 text-white font-bold py-2 px-4 rounded hover:bg-red-700 transition disabled:opacity-60"
      >
        {sending ? 'Cancelling and sending…' : 'Confirm cancellation & send emails'}
      </button>
      {error && <div className="p-2 rounded bg-red-100 text-red-700 font-semibold">{error}</div>}
    </div>
  )
}
