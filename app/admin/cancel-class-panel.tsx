'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'

// Class cancellation form (PHASE4_SPEC §12). Composes the CX email BEFORE
// anything sends: tutoring-conversion offer (on by default, 8 hours) and the
// credit-to-next-course offer (optional free-text term). The offer math uses
// classes.price only — identical for every family; the per-family preview
// differs only in WHICH CX VARIANT renders (add-on families get the
// combined-total wording + keep-your-hours line; their purchased hours
// survive every outcome, including refund). Confirm posts to
// /api/admin/cancel-class, which flips the class status first — atomically
// suppressing every scheduled send — then emails Paid families (CX),
// waitlisted families (CX-W), and the school contact (CX-C).

export type PaidPreview = {
  enrollmentId: string
  studentName: string
  parentName: string
  /** 1-on-1 hours this family purchased as an add-on (0 = standard CX). */
  addonHours: number
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

  // One math for the whole class: hours × regular rate vs classes.price.
  const math = regularRate
    ? {
        regular: h * regularRate,
        savingsUsd: Math.round(h * regularRate - classPrice),
        savingsPct: Math.round(((h * regularRate - classPrice) / (h * regularRate)) * 100),
      }
    : null
  // Sanity flag: the offer should be worth more than the class fee.
  const notASavings = math != null && math.regular <= classPrice

  const addonFamilies = paid.filter((p) => p.addonHours > 0)

  async function confirm() {
    if (
      !window.confirm(
        `Cancel ${classLabel}?\n\n` +
          `• ${paid.length} paid famil${paid.length === 1 ? 'y' : 'ies'} get the cancellation email with the options below\n` +
          (addonFamilies.length > 0
            ? `• ${addonFamilies.length} of them get the ADD-ON variant (combined hours + keep-your-hours line): ${addonFamilies
                .map((p) => `${p.studentName} (+${p.addonHours}h)`)
                .join(', ')}\n`
            : '') +
          `• ${pendingCount} pending registration${pendingCount === 1 ? '' : 's'} expire silently\n` +
          `• ${waitlistedCount} waitlisted famil${waitlistedCount === 1 ? 'y' : 'ies'} get the release note\n` +
          `• every scheduled email for this class stops\n\n` +
          `Add-on tutoring hours survive every outcome (refund = class fee only).\n` +
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
        A full refund is always listed as an option regardless of the toggles. Refund = class
        fee only — add-on tutoring hours are a separate purchase and survive every outcome.
      </p>

      {tutoringOn && math && (
        <div className={`text-xs rounded px-2 py-1.5 border ${notASavings ? 'bg-red-100 border-red-300 text-red-700 font-bold' : 'bg-white border-gray-200 text-gray-600'}`}>
          Offer math (same for every family): {h} hours for ${classPrice.toLocaleString()} — a
          savings of over {math.savingsPct}% (USD ${math.savingsUsd.toLocaleString()}) vs the
          regular ${(math.regular).toLocaleString()}.
          {notASavings && ' ⚠ Not a savings: the offer is worth no more than the class fee — add hours.'}
        </div>
      )}

      {paid.length > 0 ? (
        <div>
          <h5 className="font-semibold text-hgl-slate mb-1">
            Preview — {paid.length} paid famil{paid.length === 1 ? 'y' : 'ies'} (variant only —
            the math is identical):
          </h5>
          <ul className="space-y-1">
            {paid.map((p) => (
              <li key={p.enrollmentId} className="bg-white border border-gray-200 rounded px-2 py-1.5">
                <strong>{p.studentName}</strong> ({p.parentName}) —{' '}
                {p.addonHours > 0 ? (
                  <span className="text-hgl-blue font-semibold">
                    add-on variant: +{p.addonHours}h purchased
                    {tutoringOn ? ` → "${h + p.addonHours} hours in total"` : ''} + keep-your-hours line
                  </span>
                ) : (
                  <span className="text-gray-600">standard CX</span>
                )}
              </li>
            ))}
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
