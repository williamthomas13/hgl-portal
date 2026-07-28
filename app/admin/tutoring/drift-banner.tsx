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

  async function resolve(sessionId: string, action: 'adopt' | 'revert') {
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
          [sessionId]: json.adopted
            ? `Adopted — the normal reschedule ran (${json.notice === 'late' ? 'LATE notice: the $40/h fee logic applies' : 'free reschedule'}), the family gets their notice, and the calendars converge.`
            : json.reverted
              ? 'Reverted — the calendar event is being patched back to the portal time.'
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
      {rows.map((d) => (
        <div key={d.sessionId} id={`drift-${d.sessionId}`} className="bg-white border border-amber-200 rounded p-3">
          <p className="text-amber-900">
            <strong>
              {d.calStartsAt
                ? `${d.tutorFirst} moved ${d.studentFirst}'s ${d.subjectName} session in their Google Calendar — ${fmtT(d.portalStartsAt)} → ${fmtT(d.calStartsAt)}.`
                : `${d.tutorFirst} deleted ${d.studentFirst}'s ${d.subjectName} session event (${fmtT(d.portalStartsAt)}) from their Google Calendar.`}
            </strong>{' '}
            The family hasn&apos;t been told and billing hasn&apos;t changed.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
            {d.calStartsAt && (
              <button
                disabled={busy === d.sessionId}
                onClick={() => resolve(d.sessionId, 'adopt')}
                className="bg-hgl-slate text-white font-bold px-3 py-1.5 rounded disabled:opacity-50"
                title="Runs the NORMAL reschedule with the calendar's time — parent notice, fee logic, timecards; never a back door"
              >
                Adopt the new time
              </button>
            )}
            <button
              disabled={busy === d.sessionId}
              onClick={() => resolve(d.sessionId, 'revert')}
              className="border border-gray-400 text-gray-700 font-bold px-3 py-1.5 rounded disabled:opacity-50"
              title="Patches the calendar event back to the portal's time"
            >
              Revert {d.tutorFirst}&apos;s calendar
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
      ))}
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
