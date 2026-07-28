'use client'

import { useState } from 'react'

// PL-207: the 1-on-1 tutoring card, as a state machine instead of a static
// line. Four states over (add-on purchased?) × (class not-started /
// in-session / finished):
//   A 'purchased'          — hours bought, class not finished: explain WHY
//                            hours work best after class, give the concrete
//                            redeem steps, let the family share availability
//                            NOW (the tokenized page, src=card), and record
//                            an explicit start-timing preference for Kelsie.
//   B 'no_addon_prestart'  — the #9 pre-class reminder: discounted packages
//                            exist only until the class starts, with the buy
//                            link (pre_class pricing via the addons page).
//   C 'no_addon_insession' — deal's gone; set the post-class expectation.
//   D 'no_addon_finished'  — mirrors the #8 post-class offer (same pricing
//                            source, so card and email can't disagree).

export type CardPackage = { hours: number; savings: number }

export type TutoringCardState =
  | {
      kind: 'purchased'
      totalHours: number
      hasSchedule: boolean
      hasAvailability: boolean
      classRunning: boolean
      availabilityUrl: string
      timing: 'immediate' | 'after_class' | null
    }
  | { kind: 'no_addon_prestart'; packages: CardPackage[]; addonUrl: string; firstSessionDate: string }
  | { kind: 'no_addon_insession'; schoolNickname: string; classType: string }
  | { kind: 'no_addon_finished'; packages: CardPackage[]; discountUrl: string }

export default function TutoringAddonCard({
  studentId,
  studentFirst,
  state,
}: {
  studentId: string
  studentFirst: string
  state: TutoringCardState
}) {
  const [timing, setTiming] = useState<'immediate' | 'after_class' | null>(
    state.kind === 'purchased' ? state.timing : null
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function chooseTiming(t: 'immediate' | 'after_class') {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/portal/tutoring-family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_tutoring_timing', student_id: studentId, timing: t }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setTiming(t)
        setMessage(
          t === 'immediate'
            ? "Got it — we'll start scheduling right away. Share availability below if you haven't yet."
            : "Got it — we'll wait until the class wraps up, then reach out to schedule."
        )
      } else {
        setMessage('Error: ' + (json.error ?? 'something went wrong — please try again.'))
      }
    } catch {
      setMessage('Error: something went wrong — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (state.kind === 'purchased') {
    return (
      <div className="mt-4 border border-gray-200 rounded-lg p-4 text-sm space-y-3">
        <p>
          <span className="font-semibold text-hgl-slate">1-on-1 tutoring:</span>{' '}
          {state.totalHours} hour{state.totalHours === 1 ? '' : 's'} purchased
        </p>
        {state.hasSchedule ? (
          <p className="text-xs text-gray-600">
            See the sessions, hours remaining, and billing in the 1-on-1 tutoring section below.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-600">
              {state.classRunning
                ? `These hours are most valuable after the class ends — we tailor them to ${studentFirst}'s diagnostic results and what the instructor sees in class. `
                : ''}
              Redeeming them is simple: share {studentFirst}&apos;s availability → we propose a
              schedule → you confirm → sessions begin.
            </p>
            <p>
              <a
                href={state.availabilityUrl}
                className="inline-block bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-hgl-blue-hover"
              >
                {state.hasAvailability ? 'Update availability' : `Share ${studentFirst}'s availability`}
              </a>
              {state.hasAvailability && (
                <span className="text-xs text-green-700 ml-2">
                  ✓ availability shared — we&apos;re on it
                </span>
              )}
            </p>
            {/* The timing preference only matters while class sessions are
                still running — after that, scheduling starts regardless. */}
            {state.classRunning && (
              <div className="text-xs">
                <p className="text-gray-600 mb-1">When should the 1-on-1 sessions start?</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['immediate', 'Start right away'],
                      ['after_class', 'Wait until the class is done'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      disabled={saving}
                      onClick={() => chooseTiming(v)}
                      className={`px-3 py-1.5 rounded border font-semibold ${
                        timing === v
                          ? 'bg-hgl-slate text-white border-hgl-slate'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-hgl-slate'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {message && (
              <p className={`text-xs ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
                {message}
              </p>
            )}
          </>
        )}
      </div>
    )
  }

  if (state.kind === 'no_addon_prestart') {
    return (
      <div className="mt-4 border border-gray-200 rounded-lg p-4 text-sm space-y-2">
        <p>
          <span className="font-semibold text-hgl-slate">1-on-1 tutoring:</span>{' '}discounted
          packages are available <strong>only until the class starts</strong> ({state.firstSessionDate}).
        </p>
        <div className="flex flex-wrap gap-2">
          {state.packages.map((p) => (
            <a
              key={p.hours}
              href={state.addonUrl}
              className="inline-block bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-hgl-blue-hover"
            >
              {p.hours} hours — save ${p.savings}
            </a>
          ))}
        </div>
        <p className="text-xs text-gray-600">
          After the class starts, these pre-class savings are gone — a smaller post-class discount
          comes later.
        </p>
      </div>
    )
  }

  if (state.kind === 'no_addon_insession') {
    return (
      <div className="mt-4 border border-gray-200 rounded-lg p-4 text-sm">
        <p>
          <span className="font-semibold text-hgl-slate">1-on-1 tutoring:</span>{' '}
          <span className="text-gray-700">
            You didn&apos;t sign up for 1-on-1 tutoring, but students who take the{' '}
            {state.schoolNickname} {state.classType}{' '}class are eligible for discounted 1-on-1
            hours after it ends. Look out for an email from us after the class finishes — or get
            in touch now if you&apos;d like to chat.
          </span>
        </p>
      </div>
    )
  }

  // no_addon_finished — mirrors the #8 post-class offer.
  return (
    <div className="mt-4 border border-gray-200 rounded-lg p-4 text-sm space-y-2">
      <p>
        <span className="font-semibold text-hgl-slate">1-on-1 tutoring:</span>{' '}
        <span className="text-gray-700">
          {studentFirst}{' '}finished the class — students who complete one of our classes get
          discounted 1-on-1 hours to keep the momentum going.
        </span>
      </p>
      {state.packages.length > 0 && (
        <p className="text-xs text-gray-600">
          {state.packages.map((p) => `${p.hours} hours — save $${p.savings}`).join(' · ')}
        </p>
      )}
      <p>
        <a
          href={state.discountUrl}
          className="inline-block bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-hgl-blue-hover"
        >
          Get discounted tutoring hours
        </a>
        <span className="text-xs text-gray-600 ml-2">
          (use the password <strong>BESTSCORE</strong>)
        </span>
      </p>
    </div>
  )
}
