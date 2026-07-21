'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Confirm / Request changes (Phase 7c §6.2) + the PL-62 quick-change layer:
// "Request changes" now opens a per-session step first — move (pick from the
// offered-slots machinery) or drop, applied instantly to the unconfirmed
// proposal with the total recomputed — and the free-text box remains the
// fallback for anything bigger, which still pauses the clock for the Ops
// Director. "Can't come Monday Aug 17" is a two-tap fix, not a typed note
// and a wait.
//
// One-tap confirm (PL-62b): when the email's Confirm button lands here with
// ?confirm=1, a JS-executed POST confirms on load. Mail scanners prefetch
// GETs but don't run JS, so a corporate scanner can never silently confirm
// a month — and the request-changes path stays one visible tap away.

type SessionRow = {
  id: string
  day: string
  time: string
  student: string
  subject: string
  tutor: string
}

type Slot = { startsAt: string; endsAt: string; label: string }

export default function ProposalActions({
  token,
  changeRequested,
  sessions,
  autoConfirm,
}: {
  token: string
  changeRequested: boolean
  sessions: SessionRow[]
  autoConfirm: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<
    'buttons' | 'quick' | 'changes' | 'done-confirm' | 'done-changes'
  >('buttons')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Move sub-state: which session is being moved, and its offered slots.
  const [moving, setMoving] = useState<string | null>(null)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [dropping, setDropping] = useState<string | null>(null)
  const autoRan = useRef(false)

  async function api(payload: Record<string, unknown>) {
    const res = await fetch('/api/tutoring/proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...payload }),
    })
    const json = await res.json()
    return { ok: res.ok, json }
  }

  async function call(action: 'confirm' | 'request_changes') {
    setBusy(true)
    setError('')
    const { ok, json } = await api({ action, note })
    setBusy(false)
    if (!ok) setError(json.error ?? 'Something went wrong — please try again or just reply to our email.')
    else setMode(action === 'confirm' ? 'done-confirm' : 'done-changes')
  }

  // PL-62b: the email button's one-tap confirm — POST from JS on load.
  useEffect(() => {
    if (!autoConfirm || autoRan.current) return
    autoRan.current = true
    void call('confirm')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConfirm])

  async function openMove(sessionId: string) {
    setBusy(true)
    setError('')
    setMoving(sessionId)
    setSlots(null)
    const { ok, json } = await api({ action: 'move_options', sessionId })
    setBusy(false)
    if (!ok) {
      setError(json.error ?? 'Could not load alternative times.')
      setMoving(null)
      return
    }
    setSlots(json.slots ?? [])
  }

  async function pickSlot(sessionId: string, startsAt: string) {
    setBusy(true)
    setError('')
    const { ok, json } = await api({ action: 'move', sessionId, startsAt })
    setBusy(false)
    if (!ok) {
      setError(json.error ?? 'That time is no longer available.')
      return
    }
    setMoving(null)
    setSlots(null)
    setNotice('Moved — the schedule and total below are updated. Confirm whenever it all looks right.')
    router.refresh()
  }

  async function dropSession(sessionId: string) {
    setBusy(true)
    setError('')
    const { ok, json } = await api({ action: 'drop', sessionId })
    setBusy(false)
    setDropping(null)
    if (!ok) {
      setError(json.error ?? 'Could not remove the session.')
      return
    }
    setNotice('Removed — the schedule and total below are updated. Confirm whenever it all looks right.')
    router.refresh()
  }

  if (mode === 'done-confirm') {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm font-semibold">
          Schedule confirmed — thank you! The sessions are locked in and your invoice follows by email.
        </div>
        {mode === 'done-confirm' && (
          <p className="text-xs text-gray-500">
            Something wrong after all?{' '}
            <button onClick={() => setMode('changes')} className="text-hgl-blue underline">
              Tell us what to change
            </button>{' '}
            and we&apos;ll sort it out.
          </p>
        )}
      </div>
    )
  }
  if (mode === 'done-changes') {
    return (
      <div className="p-4 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
        Got it — we&apos;ll be in touch shortly to sort out the schedule. Nothing is confirmed until
        you&apos;ve okayed the updated plan.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {changeRequested && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          You&apos;ve already asked for changes — we&apos;re on it. You can still confirm the current
          schedule below if it turns out to work after all.
        </p>
      )}
      {notice && (
        <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">{notice}</p>
      )}

      {mode === 'buttons' && (
        <div className="flex flex-wrap gap-3">
          <button
            disabled={busy}
            onClick={() => call('confirm')}
            className="bg-hgl-slate text-white py-2.5 px-6 rounded font-bold hover:opacity-90 disabled:opacity-50"
          >
            {busy && autoConfirm ? 'Confirming…' : 'Confirm schedule'}
          </button>
          <button
            disabled={busy}
            onClick={() => setMode(sessions.length > 0 ? 'quick' : 'changes')}
            className="border border-gray-300 text-gray-700 py-2.5 px-6 rounded font-semibold hover:bg-gray-50"
          >
            Request changes
          </button>
        </div>
      )}

      {mode === 'quick' && (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            Adjust any session — changes apply right away (nothing is billed until you confirm the
            month).
          </p>
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
            {sessions.map((s) => (
              <li key={s.id} className="p-3 flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-semibold text-hgl-slate">{s.day}</div>
                  <div className="text-xs text-gray-500">
                    {s.time} · {s.student} — {s.subject} with {s.tutor}
                  </div>
                  {moving === s.id && slots && (
                    <div className="mt-2 space-y-1">
                      {slots.length > 0 ? (
                        <>
                          <p className="text-xs text-gray-600">Times {s.tutor} can also do:</p>
                          {slots.map((slot) => (
                            <button
                              key={slot.startsAt}
                              disabled={busy}
                              onClick={() => pickSlot(s.id, slot.startsAt)}
                              className="block w-full text-left text-sm border border-hgl-blue text-hgl-blue rounded px-3 py-1.5 hover:bg-hgl-blue hover:text-white transition disabled:opacity-50"
                            >
                              {slot.label}
                            </button>
                          ))}
                        </>
                      ) : (
                        <p className="text-xs text-gray-600">
                          We couldn&apos;t find an open alternative automatically —{' '}
                          <button onClick={() => setMode('changes')} className="text-hgl-blue underline">
                            tell us what works
                          </button>{' '}
                          and we&apos;ll make it happen.
                        </p>
                      )}
                      <button onClick={() => { setMoving(null); setSlots(null) }} className="text-xs text-gray-400 underline">
                        keep this time
                      </button>
                    </div>
                  )}
                  {dropping === s.id && (
                    <div className="mt-2 text-xs text-gray-700 space-x-2">
                      Remove this session from the month?
                      <button
                        disabled={busy}
                        onClick={() => dropSession(s.id)}
                        className="ml-2 text-red-600 font-semibold underline disabled:opacity-50"
                      >
                        Yes, remove it
                      </button>
                      <button onClick={() => setDropping(null)} className="text-gray-400 underline">
                        keep it
                      </button>
                    </div>
                  )}
                </div>
                {moving !== s.id && dropping !== s.id && (
                  <div className="flex gap-2 text-sm">
                    <button
                      disabled={busy}
                      onClick={() => openMove(s.id)}
                      className="border border-gray-300 rounded px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Move
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setDropping(s.id)}
                      className="border border-gray-300 rounded px-3 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Drop
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              disabled={busy}
              onClick={() => call('confirm')}
              className="bg-hgl-slate text-white py-2 px-5 rounded font-bold hover:opacity-90 disabled:opacity-50"
            >
              Looks right — confirm schedule
            </button>
            <button onClick={() => setMode('changes')} className="text-sm text-hgl-blue underline">
              Something bigger? Tell us in words
            </button>
            <button onClick={() => setMode('buttons')} className="text-sm text-gray-400 underline">
              back
            </button>
          </div>
        </div>
      )}

      {mode === 'changes' && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Tell us what you'd like different — days, times, frequency, anything."
            className="w-full border border-gray-300 rounded-md p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              disabled={busy || !note.trim()}
              onClick={() => call('request_changes')}
              className="bg-hgl-blue text-white py-2 px-5 rounded font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Send request
            </button>
            <button
              onClick={() => setMode(sessions.length > 0 ? 'quick' : 'buttons')}
              className="text-gray-500 underline text-sm"
            >
              back
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
    </div>
  )
}
