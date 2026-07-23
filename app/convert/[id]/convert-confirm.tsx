'use client'

import { useState } from 'react'
import AvailabilityShareForm from '../../availability/[token]/availability-share-form'

// PL-86 client half: one visible tap → JS-executed POST → the page becomes
// the availability grid without leaving. Prefetchers never convert (they
// don't run this handler); revisits land in the done state.

type GridStudent = {
  id: string
  firstName: string
  ranges: { weekday: number; start_time: string; end_time: string }[]
  timezone: string | null
}

export default function ConvertConfirm({
  enrollmentId,
  token,
  studentFirst,
  classLabel,
  offerHours,
  creditAmount,
  alreadyConverted,
  availabilityToken,
  students,
}: {
  enrollmentId: string
  token: string
  studentFirst: string
  classLabel: string
  offerHours: number | null
  creditAmount: number
  alreadyConverted: boolean
  availabilityToken: string
  students: GridStudent[]
}) {
  const [done, setDone] = useState(alreadyConverted)
  const [wasAlready] = useState(alreadyConverted)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const termsLine = offerHours
    ? `your ${classLabel} payment converts to ${offerHours} hours of 1-on-1 tutoring — nothing to pay until those are used`
    : `your ${classLabel} payment ($${creditAmount.toLocaleString()}) is applied as credit toward ${studentFirst}'s tutoring sessions`

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/convert/self', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId, token }),
      })
      const json = await res.json()
      if (!res.ok) setError(json.error ?? 'Something went wrong — please try again or reply to our email.')
      else setDone(true)
    } catch {
      setError('Something went wrong — please try again or reply to our email.')
    }
    setBusy(false)
  }

  if (!done) {
    return (
      <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
        <h1 className="text-2xl font-bold text-hgl-slate mb-2">
          Convert {studentFirst}&apos;s {classLabel} payment to 1-on-1 tutoring
        </h1>
        <p className="text-gray-700 mb-6">
          One tap and it&apos;s done: {termsLine}. We&apos;ll tailor the schedule to your
          family&apos;s availability and the lessons to {studentFirst}&apos;s strengths and
          weaknesses.
        </p>
        {error && <p className="mb-4 p-3 rounded bg-red-100 text-red-700 text-sm font-semibold">{error}</p>}
        <button
          onClick={confirm}
          disabled={busy}
          className="w-full bg-hgl-blue text-white font-bold py-3 rounded-md text-lg disabled:opacity-60"
        >
          {busy
            ? 'Converting…'
            : offerHours
              ? `Convert my payment to ${offerHours} hours of 1-on-1 tutoring`
              : 'Convert my payment to tutoring credit'}
        </button>
        <p className="text-xs text-gray-400 mt-3">
          Changed your mind, or want the refund instead? Just reply to the cancellation email —
          nothing happens until you tap.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md border-t-4 border-green-500 p-8">
        <h1 className="text-2xl font-bold text-hgl-slate mb-2">
          {wasAlready ? 'Already done — you’re all set' : 'Done — you’re all set'} ✓
        </h1>
        <p className="text-gray-700">
          {offerHours
            ? `${studentFirst} has ${offerHours} hours of 1-on-1 tutoring — nothing to pay until those are used.`
            : `Your $${creditAmount.toLocaleString()} credit is on file for ${studentFirst}'s tutoring.`}{' '}
          One quick step below: tell us when {studentFirst} is usually available and we&apos;ll
          propose times that fit.
        </p>
      </div>
      <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
        <h2 className="text-xl font-bold text-hgl-slate mb-1">When works for tutoring?</h2>
        <p className="text-sm text-gray-500 mb-6">
          Rough is fine — tell us the windows that usually work and we&apos;ll propose exact
          times. Takes about a minute.
        </p>
        <AvailabilityShareForm token={availabilityToken} students={students} />
      </div>
    </div>
  )
}
