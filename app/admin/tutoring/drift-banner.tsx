'use client'

import { useCallback, useEffect, useState } from 'react'

// PL-180: calendar edits flow BACK — with a human gate. This banner scans on
// page load (so detection isn't a day behind the sweep), says WHO moved
// WHAT (on the tutor's own calendar, the tutor moved it), and resolves one
// click each way: Adopt runs the NORMAL reschedule machinery with the
// calendar's time; Revert patches the calendar back. Always answers.

type DriftRow = {
  sessionId: string
  tutorFirst: string
  studentFirst: string
  studentLast: string
  familyId: string | null
  subjectName: string
  portalStartsAt: string
  portalEndsAt: string
  calStartsAt: string | null
  calEndsAt: string | null
}

const fmtT = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export default function DriftBanner() {
  const [rows, setRows] = useState<DriftRow[]>([])
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<Record<string, string>>({})
  // PL-420: adopting a DELETION is a cancellation with money consequences —
  // the consequence is stated inline before the click that commits (standing
  // rule: inline confirms, never native dialogs).
  const [confirmCancel, setConfirmCancel] = useState('')

  const scan = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tutoring/drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan' }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setRows(json.drift ?? [])
    } catch {
      /* the daily sweep is the backstop */
    }
  }, [])

  useEffect(() => {
    scan()
  }, [scan])

  async function resolve(sessionId: string, action: 'adopt' | 'revert' | 'record_no_show' | 'record_forfeited') {
    setBusy(sessionId)
    setResult((m) => ({ ...m, [sessionId]: '' }))
    try {
      const res = await fetch('/api/admin/tutoring/drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sessionId }),
      })
      const json = await res.json().catch(() => ({}))
      if (json.ok) {
        setResult((m) => ({
          ...m,
          [sessionId]: json.adoptedDeletion
            ? json.outcome === 'forfeited'
              ? 'Adopted — the session is cancelled inside 24 hours: reserved time (the family is still billed, the tutor is still paid). The family gets their notice.'
              : "Adopted — the session is cancelled free (more than 24 hours' notice, nothing bills). The family gets their notice."
            : json.adopted
            ? json.asHappened
              ? 'Recorded as happened at the moved time — timecards and billing read from the corrected session.'
              : `Adopted — the normal reschedule ran (${json.notice === 'late' ? 'LATE notice: the $40/h fee logic applies' : 'free reschedule'}), the family gets their notice, and the calendars converge.`
            : json.reverted
              ? 'Reverted — the calendar event is being patched back to the portal time.'
              : json.recorded
                ? `Recorded as ${json.recorded === 'no_show' ? 'a no-show' : 'forfeited'} — the reserved-time pay rules apply as usual.`
                : (json.note ?? 'Resolved.'),
        }))
        setRows((r) => r.filter((x) => x.sessionId !== sessionId))
      } else {
        setResult((m) => ({ ...m, [sessionId]: `Error: ${json.error ?? res.status}` }))
      }
    } catch {
      setResult((m) => ({ ...m, [sessionId]: "Error: couldn't reach the server." }))
    }
    setBusy('')
  }

  if (rows.length === 0 && Object.values(result).every((v) => !v)) return null

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm space-y-3">
      <p className="font-bold text-amber-900">
        Calendar edited outside the portal — {rows.length} session
        {rows.length === 1 ? '' : 's'} need a decision
      </p>
      {rows.map((d) => {
        // PL-393: once the session's time has PASSED, the questions change —
        // the banner never vanishes; it asks what actually happened.
        const past = new Date(d.portalStartsAt).getTime() < Date.now()
        return (
        <div key={d.sessionId} id={`drift-${d.sessionId}`} className="bg-white border border-amber-200 rounded p-3">
          <p className="text-amber-900">
            <strong>
              {d.calStartsAt
                ? `${d.tutorFirst} moved ${d.studentFirst}'s ${d.subjectName} session in their Google Calendar — ${fmtT(d.portalStartsAt)} → ${fmtT(d.calStartsAt)}${past ? ', and its time has now passed' : ''}.`
                : `${d.tutorFirst} deleted ${d.studentFirst}'s ${d.subjectName} session event (${fmtT(d.portalStartsAt)}) from their Google Calendar${past ? ', and its time has now passed' : ''}.`}
            </strong>{' '}
            {past
              ? 'Record what actually happened — the choice sets the timecard and billing record.'
              : "The family hasn't been told and billing hasn't changed."}
          </p>
          {/* PL-420: the email promises adopt-or-revert for deletions too —
              adopt = cancel via the normal machinery, consequence first. */}
          {!d.calStartsAt && !past && confirmCancel === d.sessionId && (
            <div className="mt-2 text-xs bg-amber-100 border border-amber-300 rounded p-2 space-y-2">
              <p className="text-amber-900 font-semibold">
                {new Date(d.portalStartsAt).getTime() - Date.now() < 24 * 3600_000
                  ? `Cancelling inside 24 hours: reserved time — the family is still billed for this session and ${d.tutorFirst} is still paid.`
                  : "More than 24 hours out: this cancels free — nothing bills, and the time can be rebooked."}{' '}
                The family gets a notice either way.
              </p>
              <div className="flex gap-2">
                <button
                  disabled={busy === d.sessionId}
                  onClick={() => {
                    setConfirmCancel('')
                    resolve(d.sessionId, 'adopt')
                  }}
                  className="bg-red-700 text-white font-bold px-3 py-1.5 rounded disabled:opacity-50"
                >
                  Yes, cancel the session
                </button>
                <button onClick={() => setConfirmCancel('')} className="border border-gray-400 text-gray-700 px-3 py-1.5 rounded">
                  Back
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
            {!d.calStartsAt && !past && confirmCancel !== d.sessionId && (
              <button
                disabled={busy === d.sessionId}
                onClick={() => setConfirmCancel(d.sessionId)}
                className="bg-hgl-slate text-white font-bold px-3 py-1.5 rounded disabled:opacity-50"
                title="The tutor deleted the event because the session isn't happening — cancel it through the normal machinery (family notice, the 24-hour fee rules, timecards)"
              >
                Adopt — cancel this session
              </button>
            )}
            {d.calStartsAt && (
              <button
                disabled={busy === d.sessionId}
                onClick={() => resolve(d.sessionId, 'adopt')}
                className="bg-hgl-slate text-white font-bold px-3 py-1.5 rounded disabled:opacity-50"
                title={past
                  ? "The session happened at the moved time — the record moves to it; timecards/billing read the corrected session"
                  : "Runs the NORMAL reschedule with the calendar's time — parent notice, fee logic, timecards; never a back door"}
              >
                {past ? 'It happened at the moved time' : 'Adopt the new time'}
              </button>
            )}
            {past && (
              <>
                <button
                  disabled={busy === d.sessionId}
                  onClick={() => resolve(d.sessionId, 'record_no_show')}
                  className="border border-amber-500 text-amber-800 font-bold px-3 py-1.5 rounded disabled:opacity-50"
                  title="The student didn't show — pay for the reserved time is unchanged (the T5 rules), the record says no-show"
                >
                  Mark no-show
                </button>
                <button
                  disabled={busy === d.sessionId}
                  onClick={() => resolve(d.sessionId, 'record_forfeited')}
                  className="border border-amber-500 text-amber-800 font-bold px-3 py-1.5 rounded disabled:opacity-50"
                  title="The session didn't happen (late cancellation) — the reserved slot stays billable per the 24-hour rule"
                >
                  Didn&apos;t happen — forfeit
                </button>
              </>
            )}
            <button
              disabled={busy === d.sessionId}
              onClick={() => resolve(d.sessionId, 'revert')}
              className="border border-gray-400 text-gray-700 font-bold px-3 py-1.5 rounded disabled:opacity-50"
              title={past
                ? "The portal's time was right — the record stands as scheduled and the Google event is patched back"
                : "Patches the calendar event back to the portal's time"}
            >
              {past ? 'Keep the portal time' : `Revert ${d.tutorFirst}'s calendar`}
            </button>
            {d.familyId && (
              <a href={`/admin/tutoring?family=${d.familyId}`} className="underline text-hgl-blue">
                the family&apos;s record
              </a>
            )}
          </div>
          {result[d.sessionId] && (
            <p className={`text-xs mt-2 font-semibold ${result[d.sessionId].startsWith('Error') ? 'text-red-700' : 'text-green-700'}`}>
              {result[d.sessionId]}
            </p>
          )}
        </div>
        )
      })}
      {rows.length === 0 &&
        Object.entries(result)
          .filter(([, v]) => v)
          .map(([id, v]) => (
            <p key={id} className={`text-xs font-semibold ${v.startsWith('Error') ? 'text-red-700' : 'text-green-700'}`}>
              {v}
            </p>
          ))}
    </div>
  )
}
