'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// PL-112: substitute coverage, tutor side. Request a sub for an upcoming
// session (candidates are subject-qualified ONLY — the server never sends
// matching notes), answer offers made to you, and read the handoff once
// you've accepted. The manager path is always offered alongside — by
// position, never by name.

export type CoverageRow = {
  id: string
  status: 'offered' | 'accepted' | 'declined' | 'cancelled'
  role: 'requester' | 'candidate'
  otherName: string
  sessionLabel: string
  note: string | null
}

export type HandoffView = {
  sessionLabel: string
  location: string | null
  notes: { when: string; note: string; next_time: string | null }[]
}

export type CoverableSession = { id: string; label: string }

type Candidate = { id: string; name: string; needsPrep: boolean }

const STATUS_STYLES: Record<CoverageRow['status'], string> = {
  offered: 'bg-amber-100 text-amber-800',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-200 text-gray-600',
}

export default function CoveragePanel({
  requests,
  handoffs,
  upcoming,
  managerLine,
}: {
  requests: CoverageRow[]
  handoffs: HandoffView[]
  upcoming: CoverableSession[]
  managerLine: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pickSession, setPickSession] = useState('')
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [pickCandidate, setPickCandidate] = useState('')
  const [note, setNote] = useState('')

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true)
    setMessage('')
    const res = await fetch('/api/portal/tutoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) {
      setMessage('Error: ' + json.error)
      return null
    }
    return json
  }

  async function loadCandidates(sessionId: string) {
    setPickSession(sessionId)
    setCandidates(null)
    setPickCandidate('')
    if (!sessionId) return
    const json = await call({ action: 'coverage_candidates', session_id: sessionId })
    if (json) setCandidates((json.candidates as Candidate[]) ?? [])
  }

  async function submitRequest() {
    const json = await call({
      action: 'request_coverage',
      session_id: pickSession,
      candidate_id: pickCandidate,
      note,
    })
    if (json) {
      setMessage('✓ Request sent — they get an email and answer with one click.')
      setPickSession('')
      setCandidates(null)
      setNote('')
      router.refresh()
    }
  }

  async function respond(id: string, response: 'accept' | 'decline') {
    const json = await call({ action: 'respond_coverage', request_id: id, response })
    if (json) {
      setMessage(response === 'accept' ? '✓ Accepted — the session is on your schedule now.' : 'Declined — thanks for answering quickly.')
      router.refresh()
    }
  }

  async function cancel(id: string) {
    const json = await call({ action: 'cancel_coverage', request_id: id })
    if (json) {
      setMessage('Request withdrawn — the session stays yours.')
      router.refresh()
    }
  }

  const offersForMe = requests.filter((r) => r.role === 'candidate' && r.status === 'offered')
  const mine = requests.filter((r) => r.role === 'requester')

  if (requests.length === 0 && upcoming.length === 0) return null

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-amber-400 p-6">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">
        Substitute coverage
        {offersForMe.length > 0 && (
          <span className="ml-2 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
            {offersForMe.length} waiting on you
          </span>
        )}
      </h2>
      <p className="text-xs text-gray-400 mb-4">{managerLine}</p>
      {message && <p className="text-sm mb-3">{message}</p>}

      {offersForMe.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-hgl-slate mb-1">Requests waiting on you</h3>
          <ul className="divide-y divide-gray-100 text-sm">
            {offersForMe.map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-gray-700">
                    <span className="font-semibold text-hgl-slate">{r.otherName}</span> asks you to cover:{' '}
                    {r.sessionLabel}
                  </span>
                </div>
                {r.note && <p className="text-xs text-gray-500 mt-0.5">“{r.note}”</p>}
                <div className="flex gap-2 mt-1.5">
                  <button
                    disabled={busy}
                    onClick={() => respond(r.id, 'accept')}
                    className="bg-green-700 text-white text-xs font-semibold rounded px-3 py-1.5 disabled:opacity-40"
                  >
                    Accept — I&apos;ll cover it
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => respond(r.id, 'decline')}
                    className="border border-gray-300 text-gray-600 text-xs rounded px-3 py-1.5 disabled:opacity-40"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {handoffs.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-hgl-slate mb-1">Your covered sessions — the handoff</h3>
          {handoffs.map((h, i) => (
            <div key={i} className="border border-purple-200 bg-purple-50 rounded p-3 text-xs mb-2">
              <p className="font-semibold text-hgl-slate">{h.sessionLabel}</p>
              {h.location && <p className="text-gray-600">Where: {h.location}</p>}
              {h.notes.length > 0 ? (
                <div className="mt-1.5">
                  <p className="text-gray-500 font-semibold">Recent session notes:</p>
                  <ul className="space-y-0.5 mt-0.5">
                    {h.notes.map((n, j) => (
                      <li key={j} className="text-gray-700">
                        <span className="text-gray-400">{n.when}:</span> {n.note}
                        {n.next_time && <span className="text-gray-500"> · Next time: {n.next_time}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-gray-500 mt-1">No session notes yet for this student.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-hgl-slate mb-1">Your requests</h3>
          <ul className="divide-y divide-gray-100 text-sm">
            {mine.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-baseline gap-x-3">
                <span className="text-gray-700">
                  {r.sessionLabel} → <span className="font-semibold text-hgl-slate">{r.otherName}</span>
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[r.status]}`}>
                  {r.status}
                </span>
                {r.status === 'offered' && (
                  <button disabled={busy} onClick={() => cancel(r.id)} className="text-xs text-gray-500 underline">
                    withdraw
                  </button>
                )}
                {r.status === 'declined' && (
                  <span className="text-xs text-gray-500">still yours — pick someone else below, or ask your manager</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-hgl-slate mb-1">Request a substitute</h3>
          <div className="space-y-2 text-sm">
            <select
              value={pickSession}
              onChange={(e) => loadCandidates(e.target.value)}
              className="border border-gray-300 rounded p-2 bg-white w-full max-w-md"
            >
              <option value="">Which session needs coverage?</option>
              {upcoming.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {pickSession && candidates === null && (
              <p className="text-xs text-gray-400 animate-pulse">Finding subject-qualified colleagues…</p>
            )}
            {candidates !== null && candidates.length === 0 && (
              <p className="text-xs text-amber-700">
                Nobody else currently teaches this subject — your manager can help find a suitable
                replacement (see the note above).
              </p>
            )}
            {candidates !== null && candidates.length > 0 && (
              <>
                <div className="space-y-1">
                  {candidates.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="coverage-candidate"
                        checked={pickCandidate === c.id}
                        onChange={() => setPickCandidate(c.id)}
                      />
                      <span className="text-hgl-slate font-semibold">{c.name}</span>
                      {c.needsPrep && (
                        <span className="text-[10px] uppercase tracking-wide text-amber-700 border border-amber-300 rounded px-1">
                          may need prep time
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything they should know? (optional — goes in the email)"
                  className="w-full max-w-md border border-gray-200 rounded p-2 text-xs"
                />
                <button
                  disabled={busy || !pickCandidate}
                  onClick={submitRequest}
                  className="bg-hgl-slate text-white text-xs font-semibold rounded px-4 py-2 disabled:opacity-40"
                >
                  Send the request
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
