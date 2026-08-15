'use client'

import { useEffect, useRef, useState } from 'react'

// PL-361: staff-assisted enrollment — the "Register a family" panel on a
// class card. Search-first (names are doors — pick the existing family
// before typing a new one), real class-state handling (full → offer the
// waitlist; past deadline → an inline-confirmed, recorded override;
// cancelled → the button never renders), then payment as a choice the
// office can actually make: email the same Stripe checkout the online flow
// uses, or record an offline payment (check/bank/comp) — NEVER card entry
// into our UI.

type Match = {
  familyId: string
  parentFirst: string
  parentLast: string
  parentEmail: string
  students: { id: string; first: string; last: string; email: string | null; graduatingYear: string | null }[]
}

type Created = {
  enrollmentId: string
  waitlisted?: boolean
  position?: number
  already?: boolean
  status?: string
}

export default function StaffEnrollPanel({
  classId,
  classLabel,
  price,
  parentEmailHint,
  onChanged,
  onClose,
}: {
  classId: string
  classLabel: string
  price: number
  /** Present when the panel is opened for an existing pending row. */
  parentEmailHint?: string
  onChanged: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [parentFirst, setParentFirst] = useState('')
  const [parentLast, setParentLast] = useState('')
  const [parentEmail, setParentEmail] = useState(parentEmailHint ?? '')
  const [studentFirst, setStudentFirst] = useState('')
  const [studentLast, setStudentLast] = useState('')
  const [studentEmail, setStudentEmail] = useState('')
  const [pronouns, setPronouns] = useState('')
  const [graduatingYear, setGraduatingYear] = useState('')
  const [accommodations, setAccommodations] = useState('')
  const [previousScores, setPreviousScores] = useState('')
  const [notes, setNotes] = useState('')

  // Server-verdict banners (the server is the authority on class state).
  const [deadlineAsk, setDeadlineAsk] = useState<string | null>(null) // closedOn
  const [fullAsk, setFullAsk] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)
  const [linkSent, setLinkSent] = useState('')

  const [offlineOpen, setOfflineOpen] = useState(false)
  const [offlineMethod, setOfflineMethod] = useState<'check' | 'bank' | 'comp'>('check')
  const [offlineAmount, setOfflineAmount] = useState(String(price))
  const [offlineNote, setOfflineNote] = useState('')
  const [offlineDone, setOfflineDone] = useState('')
  const [offlineConfirm, setOfflineConfirm] = useState(false)

  const searchSeq = useRef(0)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setMatches([])
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/staff-enroll?q=${encodeURIComponent(q)}`)
        const json = await res.json().catch(() => ({}))
        if (searchSeq.current === seq) setMatches(json.matches ?? [])
      } finally {
        if (searchSeq.current === seq) setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  function pickFamily(m: Match, s?: Match['students'][number]) {
    setParentFirst(m.parentFirst ?? '')
    setParentLast(m.parentLast ?? '')
    setParentEmail(m.parentEmail ?? '')
    if (s) {
      setStudentFirst(s.first ?? '')
      setStudentLast(s.last ?? '')
      setStudentEmail(s.email ?? '')
      setGraduatingYear(s.graduatingYear ?? '')
    }
    setMatches([])
    setQuery('')
  }

  async function create(opts: { overrideDeadline?: boolean; waitlist?: boolean } = {}) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/staff-enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          classId,
          parentFirst,
          parentLast,
          parentEmail,
          studentFirst,
          studentLast,
          studentEmail: studentEmail || null,
          pronouns: pronouns || null,
          graduatingYear: graduatingYear || null,
          accommodations: accommodations || null,
          previousScores: previousScores || null,
          notes: notes || null,
          ...opts,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json.deadlineClosed) {
        setDeadlineAsk(json.closedOn ?? 'the deadline')
        return
      }
      if (res.status === 409 && json.full) {
        setFullAsk(true)
        return
      }
      if (!res.ok) {
        setError(json.error ?? `The server returned ${res.status}.`)
        return
      }
      setDeadlineAsk(null)
      setFullAsk(false)
      setCreated(json)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function sendLink() {
    if (!created) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/staff-enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_link', enrollmentId: created.enrollmentId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Sending failed.')
        return
      }
      setLinkSent(json.to ?? parentEmail)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function recordOffline() {
    if (!created) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/staff-enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_offline',
          enrollmentId: created.enrollmentId,
          method: offlineMethod,
          amount: offlineMethod === 'comp' ? 0 : Number(offlineAmount),
          note: offlineNote,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Recording failed.')
        return
      }
      setOfflineDone(
        offlineMethod === 'comp'
          ? 'Recorded as a comp ($0) — the confirmation emails just went out.'
          : `Recorded $${Number(json.amount).toFixed(2)} by ${offlineMethod} — the confirmation emails just went out.`
      )
      setOfflineConfirm(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const infoComplete =
    parentFirst.trim() && parentLast.trim() && parentEmail.trim() && studentFirst.trim() && studentLast.trim()

  return (
    <div className="border-t border-b border-hgl-blue/30 bg-blue-50/40 px-6 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-hgl-slate">
          Register a family — {classLabel}
        </h4>
        <button onClick={onClose} className="text-xs text-gray-500 underline">
          close
        </button>
      </div>

      {!created && (
        <>
          <div className="relative max-w-md">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search existing families first — parent or student name, or email"
              className="w-full border border-gray-300 rounded p-2 text-sm"
            />
            {searching && <p className="text-xs text-gray-400 mt-1">searching…</p>}
            {matches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded shadow max-h-64 overflow-y-auto">
                {matches.map((m) => (
                  <div key={m.familyId} className="px-3 py-2 border-b border-gray-100 last:border-0">
                    <button
                      onClick={() => pickFamily(m)}
                      className="text-sm font-semibold text-hgl-slate hover:text-hgl-blue"
                    >
                      {m.parentFirst} {m.parentLast} <span className="text-gray-400 font-normal">{m.parentEmail}</span>
                    </button>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {m.students.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => pickFamily(m, s)}
                          className="text-xs bg-gray-100 hover:bg-hgl-blue/10 rounded-full px-2 py-0.5"
                        >
                          {s.first} {s.last}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-3xl">
            <input value={parentFirst} onChange={(e) => setParentFirst(e.target.value)} placeholder="Parent first name *" className="border border-gray-300 rounded p-2 text-sm" />
            <input value={parentLast} onChange={(e) => setParentLast(e.target.value)} placeholder="Parent last name *" className="border border-gray-300 rounded p-2 text-sm" />
            <input value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="Parent email *" type="email" className="border border-gray-300 rounded p-2 text-sm" />
            <input value={studentFirst} onChange={(e) => setStudentFirst(e.target.value)} placeholder="Student first name *" className="border border-gray-300 rounded p-2 text-sm" />
            <input value={studentLast} onChange={(e) => setStudentLast(e.target.value)} placeholder="Student last name *" className="border border-gray-300 rounded p-2 text-sm" />
            <input value={studentEmail} onChange={(e) => setStudentEmail(e.target.value)} placeholder="Student email" type="email" className="border border-gray-300 rounded p-2 text-sm" />
            <select value={pronouns} onChange={(e) => setPronouns(e.target.value)} className="border border-gray-300 rounded p-2 text-sm bg-white">
              <option value="">pronouns…</option>
              <option value="she_her">she/her</option>
              <option value="he_him">he/him</option>
              <option value="they_them">they/them</option>
              <option value="name_only">Something else / rather not say</option>
            </select>
            <input value={graduatingYear} onChange={(e) => setGraduatingYear(e.target.value)} placeholder="Graduating year" className="border border-gray-300 rounded p-2 text-sm" />
            <input value={previousScores} onChange={(e) => setPreviousScores(e.target.value)} placeholder="Previous test scores" className="border border-gray-300 rounded p-2 text-sm" />
            <input value={accommodations} onChange={(e) => setAccommodations(e.target.value)} placeholder="Testing accommodations" className="border border-gray-300 rounded p-2 text-sm sm:col-span-2" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="border border-gray-300 rounded p-2 text-sm" />
          </div>

          {deadlineAsk && (
            <div className="bg-amber-50 border border-amber-300 rounded p-2 text-sm text-amber-900 flex flex-wrap items-center gap-2">
              <span>
                Registration closed on <strong>{deadlineAsk}</strong>. Register anyway? (The override is
                recorded with your name.)
              </span>
              <button
                onClick={() => create({ overrideDeadline: true })}
                disabled={busy}
                className="font-bold underline text-amber-900"
              >
                I know — register anyway
              </button>
              <button onClick={() => setDeadlineAsk(null)} className="text-gray-600 underline">
                never mind
              </button>
            </div>
          )}
          {fullAsk && (
            <div className="bg-blue-50 border border-blue-300 rounded p-2 text-sm text-blue-900 flex flex-wrap items-center gap-2">
              <span>This class is full. Add {studentFirst.trim() || 'the student'} to the waitlist instead?</span>
              <button
                onClick={() => create({ waitlist: true })}
                disabled={busy}
                className="font-bold underline text-blue-900"
              >
                Yes, waitlist them
              </button>
              <button onClick={() => setFullAsk(false)} className="text-gray-600 underline">
                never mind
              </button>
            </div>
          )}

          {!deadlineAsk && !fullAsk && (
            <button
              onClick={() => create()}
              disabled={busy || !infoComplete}
              className="bg-hgl-slate text-white text-sm font-bold py-2 px-5 rounded disabled:opacity-40"
            >
              {busy ? 'Creating…' : 'Create the registration'}
            </button>
          )}
        </>
      )}

      {created?.waitlisted && (
        <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded p-2">
          Waitlisted at position <strong>#{created.position}</strong> — the family just got the
          waitlist confirmation email. If a spot opens, offers go out automatically.
        </p>
      )}

      {created?.already && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">
          This student already has a {created.status} registration on this class — nothing new was
          created. Use its row below for payment actions.
        </p>
      )}

      {created && !created.waitlisted && !created.already && (
        <div className="space-y-2">
          <p className="text-sm text-green-800 font-semibold">
            Registration created (Pending). Now the payment — two ways, never card details over the
            phone:
          </p>
          <div className="flex flex-wrap items-start gap-4">
            <div className="space-y-1">
              {linkSent ? (
                <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded p-2">
                  Payment link sent to <strong>{linkSent}</strong> — paying flips everything exactly
                  like an online registration. You can read the link aloud from their email, or
                  resend it from the roster row later.
                </p>
              ) : (
                <button
                  onClick={sendLink}
                  disabled={busy}
                  className="bg-hgl-blue text-white text-sm font-bold py-2 px-4 rounded disabled:opacity-40"
                >
                  Email the payment link to {parentEmail.trim() || 'the parent'}
                </button>
              )}
            </div>
            <div className="border border-gray-200 rounded p-2 bg-white space-y-1.5">
              {offlineDone ? (
                <p className="text-sm text-green-800">{offlineDone}</p>
              ) : (
                <>
                  <button onClick={() => setOfflineOpen((v) => !v)} className="text-sm text-hgl-blue underline">
                    {offlineOpen ? 'hide offline payment' : 'Record an offline payment instead…'}
                  </button>
                  {offlineOpen && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <select
                        value={offlineMethod}
                        onChange={(e) => setOfflineMethod(e.target.value as 'check' | 'bank' | 'comp')}
                        className="border border-gray-300 rounded p-1.5 bg-white"
                      >
                        <option value="check">Check</option>
                        <option value="bank">Bank transfer</option>
                        <option value="comp">Comp ($0)</option>
                      </select>
                      {offlineMethod !== 'comp' && (
                        <label className="flex items-center gap-1">
                          $
                          <input
                            value={offlineAmount}
                            onChange={(e) => setOfflineAmount(e.target.value)}
                            className="border border-gray-300 rounded p-1.5 w-24"
                            inputMode="decimal"
                          />
                        </label>
                      )}
                      <input
                        value={offlineNote}
                        onChange={(e) => setOfflineNote(e.target.value)}
                        placeholder={offlineMethod === 'comp' ? 'Reason for the comp (required)' : 'Note (check #, reference…)'}
                        className="border border-gray-300 rounded p-1.5 w-64"
                      />
                      {offlineConfirm ? (
                        <span className="bg-amber-50 border border-amber-200 rounded px-2 py-1 text-xs text-amber-900 space-x-2">
                          <span>
                            Mark PAID ({offlineMethod === 'comp' ? '$0 comp' : `$${offlineAmount} by ${offlineMethod}`})
                            and send the confirmation emails?
                          </span>
                          <button onClick={recordOffline} disabled={busy} className="font-bold underline">
                            Yes, record it
                          </button>
                          <button onClick={() => setOfflineConfirm(false)} className="text-gray-600 underline">
                            cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setOfflineConfirm(true)}
                          disabled={busy || (offlineMethod === 'comp' && !offlineNote.trim())}
                          className="bg-hgl-slate text-white text-xs font-bold py-1.5 px-3 rounded disabled:opacity-40"
                        >
                          Record payment
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
