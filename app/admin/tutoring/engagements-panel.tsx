'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { formatDateShort } from '../../utils/dates'
import ScoresEntry from '../../components/ScoresEntry'
import { ConfirmAction } from './confirm'
import { WEEKDAYS, familyLabel, fmtDay, fmtTime, type Engagement } from './types'
import { FamilyCommsTimeline } from '../family-comms'

// The "one source of truth per family" view (Phase 7a §5): student schedules
// (tutoring_engagements rows — UI copy is student-centric per Scarlett's
// rule, schema names unchanged) grouped by family, with weekly slots, next
// session, funding, and package runway. Full family record (class history,
// billing prefs editing) deepens in 7c/7d; this is the scheduling-side slice.

export default function EngagementsPanel({
  engagements,
  nextSessions,
  packageHoursUsed,
  addonHours,
  conversions,
  onChange,
}: {
  engagements: Engagement[]
  /** engagement_id → next confirmed session ISO */
  nextSessions: Record<string, string>
  /** engagement_id → hours consumed (completed + no_show + forfeited + upcoming confirmed) */
  packageHoursUsed: Record<string, number>
  /** addon_id → purchased hours */
  addonHours: Record<string, number>
  /** PL-84: family_id → hours packages minted from class cancellations. */
  conversions?: Record<string, { label: string; hours: number; paid: number }[]>
  onChange: () => void
}) {
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  // PL-30: current (active/paused) vs past (ended) schedules.
  const [view, setView] = useState<'current' | 'past'>('current')

  // PL-195: generation failures are a persistent STATE on the family —
  // rendered as a red marker with the retry attached, cleared the moment a
  // later run succeeds (the reload after retry re-derives it).
  type GenFailure = { id: string; family_id: string; period: string; error: string; last_attempt_at: string }
  const [genFailures, setGenFailures] = useState<Record<string, GenFailure>>({})
  const [retryResult, setRetryResult] = useState<Record<string, string>>({})
  const loadFailures = () =>
    supabase
      .from('generation_failures')
      .select('id, family_id, period, error, last_attempt_at')
      .then(({ data }) => {
        const map: Record<string, GenFailure> = {}
        for (const r of (data as GenFailure[]) ?? []) map[r.family_id] = r
        setGenFailures(map)
      })
  useEffect(() => {
    loadFailures()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagements])

  async function retryGeneration(familyId: string, period: string) {
    setBusyId(`gen-${familyId}`)
    setRetryResult((m) => ({ ...m, [familyId]: '' }))
    try {
      const res = await fetch('/api/admin/tutoring/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_family', family_id: familyId, month: period.slice(0, 7) }),
      })
      const json = await res.json().catch(() => ({}))
      if (json.ok) {
        setRetryResult((m) => ({
          ...m,
          [familyId]: `Fixed — ${json.sessionsCreated ?? 0} session${json.sessionsCreated === 1 ? '' : 's'} created, ${json.invoicesProposed ?? 0} invoice${json.invoicesProposed === 1 ? '' : 's'} proposed. The warning clears itself.`,
        }))
      } else {
        setRetryResult((m) => ({
          ...m,
          [familyId]: `Still failing — ${json.error ?? `the server returned ${res.status}`}`,
        }))
      }
      await loadFailures()
    } catch {
      setRetryResult((m) => ({ ...m, [familyId]: "Couldn't reach the server — try again." }))
    }
    setBusyId('')
  }

  const currentRows = engagements.filter((e) => e.status !== 'ended')
  const pastRows = engagements.filter((e) => e.status === 'ended')

  // PL-153d: a ?family= deep-link whose only schedules have ENDED used to
  // land on an empty "current" view — the alert appeared to point at
  // nothing. If the target family exists only under "past", switch there.
  // (Adjust-during-render, the PL-99 pattern: no effect, no double render.)
  const [deepLinkFamily, setDeepLinkFamily] = useState<string | null>(null)
  const [checkedDeepLink, setCheckedDeepLink] = useState(false)
  if (!checkedDeepLink && typeof window !== 'undefined') {
    setCheckedDeepLink(true)
    setDeepLinkFamily(new URLSearchParams(window.location.search).get('family'))
  }
  const [switchedForDeepLink, setSwitchedForDeepLink] = useState(false)
  if (deepLinkFamily && !switchedForDeepLink && engagements.length > 0) {
    setSwitchedForDeepLink(true)
    const inCurrent = currentRows.some((e) => e.students?.families?.id === deepLinkFamily)
    const inPast = pastRows.some((e) => e.students?.families?.id === deepLinkFamily)
    if (!inCurrent && inPast) setView('past')
  }

  const visible = view === 'current' ? currentRows : pastRows

  // Group by family.
  const byFamily = new Map<string, { label: string; rows: Engagement[] }>()
  for (const e of visible) {
    const fam = e.students?.families ?? null
    const key = fam?.id ?? 'unknown'
    if (!byFamily.has(key)) byFamily.set(key, { label: familyLabel(fam), rows: [] })
    byFamily.get(key)!.rows.push(e)
  }

  async function update(
    id: string,
    body: Record<string, unknown>,
    // PL-165: a done message can be computed from the response, so the
    // banner reports what actually changed instead of what was attempted.
    done: string | ((json: Record<string, unknown>) => string)
  ) {
    setBusyId(id)
    const res = await fetch('/api/admin/tutoring/engagement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, ...body }),
    })
    const json = await res.json().catch(() => ({}))
    // PL-197 Case B: a regenerate that would draw past the package asks
    // first (never blocked, never silent) — proceeding re-sends confirmed.
    if (json.needsOverdrawConfirm) {
      setBusyId('')
      if (
        window.confirm(
          `This schedule goes ${json.overBy}h past ${json.studentFirst}'s ${json.packageHours}h package ` +
            `(${json.remaining}h left on it). The extra hours will bill at the engagement rate on the ` +
            `monthly invoice — confirm with the family before scheduling them.\n\nRegenerate anyway?`
        )
      ) {
        return update(id, { ...body, confirm_overdraw: true }, done)
      }
      setMessage('Nothing changed — adjust the schedule or talk to the family first.')
      return
    }
    // PL-211: an edit that clears the location gets the same walk-past.
    if (json.needsLocationConfirm) {
      setBusyId('')
      if (
        window.confirm(
          `No location set — this schedule has no location and ${json.tutorName} has no default meeting ` +
            `link, so the tutor and family won't see where or how to meet. It will sit in Needs Attention ` +
            `until one is set.\n\nSave anyway?`
        )
      ) {
        return update(id, { ...body, confirm_no_location: true }, done)
      }
      setMessage('Nothing changed — add a location, or set a default meeting link on the tutor.')
      return
    }
    setMessage(res.ok ? (typeof done === 'function' ? done(json) : done) : 'Error: ' + json.error)
    setBusyId('')
    if (res.ok) onChange()
  }

  /** PL-165: the regenerate answer — every press produces a visible result. */
  function regenerateMessage(json: Record<string, unknown>): string {
    const r = json.regenerate as { added: number; dropped: number; unchanged: number } | null
    if (!r) return 'Future sessions regenerated from the weekly schedule.'
    if (r.added === 0 && r.dropped === 0) {
      return `Nothing needed regenerating — all ${r.unchanged} upcoming session${
        r.unchanged === 1 ? '' : 's'
      } already match the weekly schedule. No emails were sent.`
    }
    return `Regenerated: ${r.added} session${r.added === 1 ? '' : 's'} added, ${r.dropped} removed, ${
      r.unchanged
    } unchanged. Sessions already on an invoice were not touched, and no emails were sent.`
  }

  /** PL-41 non-update actions (activate_now / resend_approval). */
  async function action(id: string, act: string, done: string) {
    setBusyId(id)
    const res = await fetch('/api/admin/tutoring/engagement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: act, id }),
    })
    const json = await res.json().catch(() => ({}))
    setMessage(res.ok ? done : 'Error: ' + json.error)
    setBusyId('')
    if (res.ok) onChange()
  }

  if (engagements.length === 0) {
    return <p className="text-sm text-gray-500 italic">No student schedules yet — set one up with the wizard above.</p>
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex rounded-md overflow-hidden border border-gray-300 w-fit">
        {(['current', 'past'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-xs font-semibold ${
              view === v ? 'bg-hgl-slate text-white' : 'bg-white text-gray-600'
            }`}
          >
            {v === 'current' ? `Current (${currentRows.length})` : `Past (${pastRows.length})`}
          </button>
        ))}
      </div>
      {visible.length === 0 && (
        <p className="text-gray-500 italic">
          {view === 'current' ? 'No current schedules.' : 'No past schedules yet.'}
        </p>
      )}
      {[...byFamily.entries()].map(([famId, group]) => (
        <div key={famId} id={`family-${famId}`} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-hgl-slate">{group.label}</span>
            <span className="text-xs text-gray-400">
              {group.rows[0]?.students?.families?.parent_email}
            </span>
          </div>
          {/* PL-195: the persistent generation-failure marker + the retry.
              Red per the hours-exhausted styling; plain English; clears
              itself the moment any later run succeeds. */}
          {famId !== 'unknown' && genFailures[famId] && (
            <div className="mb-2 p-2 rounded bg-red-50 border border-red-200 text-sm">
              <p className="text-red-700 font-semibold">
                {new Date(genFailures[famId].period + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' })}{' '}
                invoice couldn&apos;t be generated — {genFailures[famId].error}
              </p>
              <p className="text-xs text-red-600 mt-0.5">
                They didn&apos;t get their automatic invoice. Retrying automatically on the hourly
                sweep; last attempt{' '}
                {new Date(genFailures[famId].last_attempt_at).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                .{' '}
                <button
                  disabled={busyId === `gen-${famId}`}
                  onClick={() => retryGeneration(famId, genFailures[famId].period)}
                  className="text-hgl-blue underline font-semibold disabled:opacity-50"
                >
                  {busyId === `gen-${famId}` ? 'retrying…' : 'Retry now for this family'}
                </button>
              </p>
              {retryResult[famId] && (
                <p className={`text-xs mt-1 font-semibold ${retryResult[famId].startsWith('Fixed') ? 'text-green-700' : 'text-red-700'}`}>
                  {retryResult[famId]}
                </p>
              )}
            </div>
          )}
          {/* PL-84: what the family was promised at cancellation — the
              authoritative hours record, no rate lookups. */}
          {(conversions?.[famId] ?? []).map((cv, i) => (
            <p key={i} className="text-xs font-semibold text-emerald-700 mb-1">
              Converted from {cv.label} cancellation: <strong>{cv.hours} hours</strong>{' '}(paid $
              {cv.paid.toLocaleString()})
            </p>
          ))}
          {/* PL-83: the family's full comms history, right on the record. */}
          {famId !== 'unknown' && (
            <div className="mb-2">
              <FamilyCommsTimeline familyId={famId} />
            </div>
          )}
          <div className="space-y-2">
            {group.rows.map((e) => {
              const next = nextSessions[e.id]
              const tz = e.instructors?.timezone ?? 'America/Denver'
              const purchased = e.addon_id ? addonHours[e.addon_id] : undefined
              const used = packageHoursUsed[e.id] ?? 0
              const remaining = purchased !== undefined ? Math.max(0, purchased - used) : undefined
              // PL-197: NEVER capped — an overdrawn package must read "over",
              // not "full", at exactly the moment it matters most.
              const overBy = purchased !== undefined ? Math.max(0, used - purchased) : 0
              const lowRunway =
                e.funding === 'package' &&
                remaining !== undefined &&
                e.recurrence.length > 0 &&
                remaining < 2 * (e.recurrence.reduce((s, r) => s + r.duration_minutes, 0) / 60 / e.recurrence.length)
              return (
                <div
                  key={e.id}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-2 rounded ${
                    e.status === 'active' ? 'bg-gray-50' : 'bg-gray-100 opacity-70'
                  }`}
                >
                  <span className="font-semibold text-hgl-slate">
                    {e.students?.first_name} {e.students?.last_name}
                  </span>
                  <span>{e.subjects?.name}</span>
                  <span className="text-gray-500">w/ {e.instructors?.name ?? e.instructors?.email}</span>
                  <span className="text-gray-500">
                    {e.recurrence.length > 0
                      ? e.recurrence
                          .map((r) => `${WEEKDAYS[r.weekday - 1]} ${r.start_time} (${r.duration_minutes}m)`)
                          .join(', ')
                      : 'one-offs only'}
                  </span>
                  <span className="text-gray-500">${e.hourly_rate}/hr</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      e.funding === 'package' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {e.funding === 'package' ? 'package' : 'monthly'}
                  </span>
                  {remaining !== undefined && overBy <= 0 && (
                    /* PL-31: read as "used so far", not "fires at hour one" */
                    <span className={`text-xs font-semibold ${lowRunway ? 'text-red-600' : 'text-gray-600'}`}>
                      {used.toFixed(1)} of {purchased}h used — {remaining.toFixed(1)}h left
                      {lowRunway && ' · time to talk about next steps'}
                    </span>
                  )}
                  {overBy > 0 && (
                    /* PL-197: the honest read + one-click acknowledge. */
                    <span className="text-xs font-semibold text-red-600">
                      {used.toFixed(1)} of {purchased}h used — {overBy.toFixed(1)}h over · extra hours bill at ${e.hourly_rate}/hr
                      {Number(e.overdraw_ack_hours ?? 0) >= overBy - 0.05 ? (
                        <span className="text-gray-500 font-normal"> · acknowledged</span>
                      ) : (
                        <button
                          className="ml-1.5 underline text-hgl-blue font-semibold"
                          disabled={busyId === e.id}
                          title="The family conversation happened — the extra hours are intentional and billing. Clears the dashboard row; it returns if the overage grows."
                          onClick={async () => {
                            setBusyId(e.id)
                            const res = await fetch('/api/admin/tutoring/engagement', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'acknowledge_overdraw', id: e.id }),
                            })
                            const json = await res.json().catch(() => ({}))
                            setMessage(res.ok ? `Overage acknowledged at ${json.acknowledgedAt}h over — it bills automatically; the dashboard row is cleared.` : 'Error: ' + (json.error ?? 'failed'))
                            setBusyId('')
                            if (res.ok) onChange()
                          }}
                        >
                          acknowledge
                        </button>
                      )}
                    </span>
                  )}
                  {next ? (
                    <span className="text-xs text-green-700">
                      next: {fmtDay(next, tz)} {fmtTime(next, tz)}
                    </span>
                  ) : (
                    e.status === 'active' && <span className="text-xs text-amber-600">no upcoming sessions</span>
                  )}
                  {e.status === 'pending_parent_confirmation' && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      awaiting family confirmation
                    </span>
                  )}
                  {e.status !== 'active' && e.status !== 'pending_parent_confirmation' && (
                    <span className="text-xs font-bold uppercase text-gray-500">{e.status}</span>
                  )}
                  {e.start_date && (
                    <span className="text-xs text-gray-400">since {formatDateShort(e.start_date)}</span>
                  )}
                  <span className="ml-auto flex gap-2 text-xs items-center">
                    {e.status === 'active' && (
                      <>
                        {/* PL-165: the confirm body states the scope — a
                            tooltip alone left "does it resend everything?"
                            unanswered. */}
                        <ConfirmAction
                          label="regenerate"
                          disabled={busyId === e.id}
                          className="text-hgl-blue underline"
                          confirmClassName="text-hgl-blue font-semibold underline"
                          message="Rebuilds this schedule's upcoming, not-yet-billed sessions from the weekly slots (use after editing the schedule). Sessions already on an invoice are kept as they are, confirmed or paid invoices are never touched, and no emails are sent or resent."
                          confirmLabel="Yes, regenerate"
                          onConfirm={() => update(e.id, { regenerate: true }, regenerateMessage)}
                        />
                        <ConfirmAction
                          label="pause"
                          message="Pause? Future unbilled sessions are removed (and taken off the Google calendar)."
                          confirmLabel="Yes, pause"
                          className="text-gray-500 underline"
                          disabled={busyId === e.id}
                          onConfirm={() => update(e.id, { status: 'paused' }, "Schedule paused — this student's future sessions removed.")}
                        />
                        <ConfirmAction
                          label="end"
                          message="End this student's schedule? Future unbilled sessions are removed; history is kept."
                          confirmLabel="Yes, end"
                          className="text-red-600 underline"
                          disabled={busyId === e.id}
                          onConfirm={() =>
                            update(e.id, { status: 'ended', end_date: new Date().toISOString().slice(0, 10) }, "Student's schedule ended.")
                          }
                        />
                      </>
                    )}
                    {e.status === 'paused' && (
                      <button
                        disabled={busyId === e.id}
                        onClick={() => update(e.id, { status: 'active', regenerate: true }, 'Schedule resumed — sessions regenerated.')}
                        className="text-green-700 underline"
                      >
                        resume
                      </button>
                    )}
                    {/* PL-41: the Ops override + re-send while awaiting the family */}
                    {e.status === 'pending_parent_confirmation' && (
                      <>
                        <button
                          disabled={busyId === e.id}
                          onClick={() => action(e.id, 'resend_approval', 'Confirmation email re-sent to the family.')}
                          className="text-hgl-blue underline"
                        >
                          re-send confirmation
                        </button>
                        <ConfirmAction
                          label="set live now"
                          message="Set this schedule live without the family's confirmation? Sessions push to the tutor's calendar and the family gets the all-set email."
                          confirmLabel="Yes, set it live"
                          className="text-green-700 underline font-semibold"
                          disabled={busyId === e.id}
                          onConfirm={() => action(e.id, 'activate_now', 'Schedule set live — sessions pushed and the family emailed.')}
                        />
                      </>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* PL-37: milestone scores for tutoring students (class_id null) —
          same entry the class rosters use; parents see them immediately. */}
      {visible.length > 0 && (
        <ScoresEntry
          classId={null}
          students={[
            ...new Map(
              visible
                .map((e) => e.students)
                .filter((s): s is NonNullable<typeof s> => !!s)
                .map((s) => [s.id, { id: s.id, name: `${s.first_name} ${s.last_name}` }])
            ).values(),
          ].sort((a, b) => a.name.localeCompare(b.name))}
        />
      )}

      {message && (
        <div
          className={`p-3 rounded text-center font-semibold ${
            message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
