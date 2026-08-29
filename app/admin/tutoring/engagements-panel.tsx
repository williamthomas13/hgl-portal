'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { formatDateShort, formatTimeRange, hhmmRange } from '../../utils/dates'
import ScoresEntry from '../../components/ScoresEntry'
import { ConfirmAction } from './confirm'
import { WEEKDAYS, familyLabel, fmtDay, fmtTime, type Engagement, type RecurrenceSlotUI, type Tutor } from './types'
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
  tutors = [],
  openScheduleEditorFor = null,
  continuationContext = null,
}: {
  engagements: Engagement[]
  /** PL-387: tutor options for the edit-schedule form (active first). */
  tutors?: Tutor[]
  /** PL-389B: deep-linked "Schedule the continuation" — opens this
   *  engagement's edit-schedule form pre-filled on mount. */
  openScheduleEditorFor?: string | null
  /** PL-389B: the continuation context banner (confirmed hours etc.). */
  continuationContext?: string | null
  /** engagement_id → next confirmed session ISO */
  nextSessions: Record<string, { starts_at: string; ends_at: string | null }>
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
  // PL-387 A: the edit-schedule form (same fields as New Student Schedule,
  // prefilled) — saving updates the recurrence/tutor and re-projects future
  // unbilled sessions in ONE motion (regenerate folds into save).
  const [editFor, setEditFor] = useState<string | null>(null)
  const [editSlots, setEditSlots] = useState<RecurrenceSlotUI[]>([])
  const [editTutorId, setEditTutorId] = useState('')
  const [busyWarnings, setBusyWarnings] = useState<string[]>([])
  // No-native-dialogs: the overdraw/location walk-pasts are inline banners.
  const [pendingUpdate, setPendingUpdate] = useState<null | {
    id: string
    body: Record<string, unknown>
    done: string | ((json: Record<string, unknown>) => string)
    text: string
    confirmKey: 'confirm_overdraw' | 'confirm_no_location'
  }>(null)
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
      // PL-387: inline walk-past (the old native confirm violated the
      // no-native-dialogs rule).
      setPendingUpdate({
        id,
        body,
        done,
        confirmKey: 'confirm_overdraw',
        text:
          `This schedule goes ${json.overBy}h past ${json.studentFirst}'s ${json.packageHours}h package ` +
          `(${json.remaining}h left on it). The extra hours will bill at the engagement rate on the ` +
          `monthly invoice — confirm with the family before scheduling them.`,
      })
      return
    }
    // PL-211: an edit that clears the location gets the same walk-past.
    if (json.needsLocationConfirm) {
      setBusyId('')
      setPendingUpdate({
        id,
        body,
        done,
        confirmKey: 'confirm_no_location',
        text:
          `No location set — this schedule has no location and ${json.tutorName} has no default meeting ` +
          `link, so the tutor and family won't see where or how to meet. It will sit in Needs Attention ` +
          `until one is set.`,
      })
      return
    }
    setMessage(res.ok ? (typeof done === 'function' ? done(json) : done) : 'Error: ' + json.error)
    setBusyId('')
    if (res.ok) {
      setEditFor(null)
      onChange()
    }
  }

  // PL-387 A: open the editor prefilled from the engagement (PL-389B deep
  // links pre-open it with the continuation context bannered above).
  const openEditor = useCallback(
    (e: Engagement) => {
      setEditFor(e.id)
      setEditSlots(e.recurrence.map((r) => ({ ...r })))
      setEditTutorId(e.tutor_id)
      setBusyWarnings([])
      setMessage('')
      void checkBusyConflicts(e.tutor_id, e.recurrence)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  useEffect(() => {
    if (!openScheduleEditorFor) return
    const e = engagements.find((x) => x.id === openScheduleEditorFor)
    if (e) openEditor(e)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openScheduleEditorFor, engagements.length])

  /** PL-387: same warn-don't-block conflict read the creation wizard does —
   *  the tutor's Google busy over the next 4 weeks vs the proposed slots. */
  async function checkBusyConflicts(tutorId: string, slots: RecurrenceSlotUI[]) {
    try {
      const tz = tutors.find((t) => t.id === tutorId)?.timezone ?? 'America/Denver'
      const timeMin = new Date().toISOString()
      const timeMax = new Date(Date.now() + 28 * 86400_000).toISOString()
      const res = await fetch('/api/gcal/freebusy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId, timeMin, timeMax }),
      })
      const json = await res.json().catch(() => ({}))
      const busy: { start: string; end: string; title?: string | null }[] = json.busy ?? []
      const warnings: string[] = []
      for (const slot of slots) {
        for (const b of busy) {
          const bs = new Date(b.start)
          const dowName = bs.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' })
          const dow = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(dowName) + 1
          if (dow !== slot.weekday) continue
          const startMin = Number(bs.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).replace(':', '')) // HHMM
          const be = new Date(b.end)
          const endMin = Number(be.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).replace(':', ''))
          const [sh, sm] = slot.start_time.split(':').map(Number)
          const slotStart = sh * 100 + sm
          const slotEndH = sh + Math.floor((sm + slot.duration_minutes) / 60)
          const slotEndM = (sm + slot.duration_minutes) % 60
          const slotEnd = slotEndH * 100 + slotEndM
          if (slotStart < endMin && slotEnd > startMin) {
            warnings.push(
              `${WEEKDAYS[slot.weekday - 1]} ${slot.start_time} overlaps ${
                b.title ? `"${b.title}"` : 'a busy block'
              } on the tutor's calendar (${bs.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })})`
            )
            break
          }
        }
      }
      setBusyWarnings(warnings)
    } catch {
      setBusyWarnings([]) // availability unknown — scheduling continues regardless
    }
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
            {/* PL-230: names are doors — into the family profile. */}
            {famId !== 'unknown' ? (
              <a
                href={`/admin/families/${famId}`}
                className="font-bold text-hgl-slate hover:text-hgl-blue hover:underline"
              >
                {group.label}
              </a>
            ) : (
              <span className="font-bold text-hgl-slate">{group.label}</span>
            )}
            <span className="text-xs">
              {group.rows[0]?.students?.families?.parent_email && (
                <a
                  href={`mailto:${group.rows[0].students.families.parent_email}`}
                  className="text-gray-400 hover:text-hgl-blue hover:underline"
                >
                  {group.rows[0].students.families.parent_email}
                </a>
              )}
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
                    {/* PL-339: "Tue 4:00–5:30 PM", never raw 24h + minutes. */}
                    {e.recurrence.length > 0
                      ? e.recurrence
                          .map((r) => `${WEEKDAYS[r.weekday - 1]} ${hhmmRange(r.start_time, r.duration_minutes)}`)
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
                  {/* PL-299: the family's block decision — state chip + the
                      admin mirror for answers that arrive by phone/reply. */}
                  {e.funding === 'package' && e.block_confirmation === 'asked' && (
                    <span className="text-xs font-semibold text-amber-700">
                      awaiting family confirmation to continue past the block — record their
                      answer:
                      {/* PL-323B: the phone/reply answer carries a CHOICE —
                          the same reservation machinery runs either way. */}
                      {(['5', '10', '15', 'monthly', 'declined'] as const).map((c) => (
                        <button
                          key={c}
                          className={`ml-1.5 underline font-semibold ${c === 'declined' ? 'text-gray-500' : 'text-hgl-blue'}`}
                          disabled={busyId === e.id}
                          title={
                            c === 'declined'
                              ? 'The family said stop — nothing schedules or bills past the block'
                              : c === 'monthly'
                                ? 'Continue monthly until they cancel, at the provenance rate'
                                : `Continue with ${c} more hours at the provenance rate`
                          }
                          onClick={async () => {
                            setBusyId(e.id)
                            const res = await fetch('/api/admin/tutoring/block-decision', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(
                                c === 'declined'
                                  ? { engagementId: e.id, decision: 'declined' }
                                  : { engagementId: e.id, decision: 'confirmed', choice: c }
                              ),
                            })
                            const json = await res.json().catch(() => ({}))
                            setMessage(
                              res.ok
                                ? c === 'declined'
                                  ? 'Recorded: family declined — sessions stop when the hours do.'
                                  : json.outcome === 'reserved'
                                    ? `Recorded and reserved: ${(json.sessions ?? []).length} continuing session${(json.sessions ?? []).length === 1 ? '' : 's'} on the calendar.`
                                    : 'Recorded — the continuing times need a human: a conflict blocked auto-reserve (alert sent, dashboard row up).'
                                : 'Error: ' + (json.error ?? 'failed')
                            )
                            setBusyId('')
                            if (res.ok) onChange()
                          }}
                        >
                          {c === 'declined' ? 'declined' : c === 'monthly' ? 'monthly' : `+${c}h`}
                        </button>
                      ))}
                    </span>
                  )}
                  {e.funding === 'package' && e.block_confirmation === 'confirmed' && (
                    <span className="text-xs text-green-700 font-semibold">
                      family confirmed — continues monthly past the block
                    </span>
                  )}
                  {e.funding === 'package' && e.block_confirmation === 'declined' && (
                    <span className="text-xs text-gray-500 font-semibold">
                      family declined — stops when the hours run out
                    </span>
                  )}
                  {next ? (
                    <span className="text-xs text-green-700">
                      next: {fmtDay(next.starts_at, tz)} {formatTimeRange(next.starts_at, next.ends_at, tz)}
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
                  {/* PL-228: flex-wrap — the long regenerate confirm banner
                      must fold under, not stretch the header row. */}
                  <span className="ml-auto flex flex-wrap gap-2 text-xs items-center justify-end">
                    {e.status === 'active' && (
                      <>
                        {/* PL-165: the confirm body states the scope — a
                            tooltip alone left "does it resend everything?"
                            unanswered. */}
                        {/* PL-387 A: the edit surface the regenerate note
                            always pointed at — edit + regenerate is ONE save. */}
                        <button
                          onClick={() => (editFor === e.id ? setEditFor(null) : openEditor(e))}
                          disabled={busyId === e.id}
                          className="text-hgl-blue font-semibold underline"
                        >
                          {editFor === e.id ? 'close editor' : 'edit schedule'}
                        </button>
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
                          message="Pause the weekly pattern? EVERY remaining scheduled session — including rescheduled make-ups — comes off the calendar (unbilled ones are removed; invoiced ones stay billed). Nothing regenerates while paused; resume rebuilds sessions from the saved pattern."
                          confirmLabel="Yes, pause"
                          className="text-gray-500 underline"
                          disabled={busyId === e.id}
                          onConfirm={() =>
                            update(
                              e.id,
                              { status: 'paused' },
                              (r) =>
                                `Schedule paused — ${r?.sessionsRemoved ?? 0} remaining session${(r?.sessionsRemoved ?? 0) === 1 ? '' : 's'} removed (rescheduled make-ups included). Resume rebuilds from the saved weekly pattern.`
                            )
                          }
                        />
                        <ConfirmAction
                          label="end"
                          message="End this student's schedule? This STOPS the weekly pattern and removes EVERY remaining scheduled session — rescheduled make-ups included (unbilled ones are removed; invoiced ones stay billed). History is kept, nothing regenerates, and the family's self-serve reschedule links stop working for this schedule."
                          confirmLabel="Yes, end"
                          className="text-red-600 underline"
                          disabled={busyId === e.id}
                          onConfirm={() =>
                            update(
                              e.id,
                              { status: 'ended', end_date: new Date().toISOString().slice(0, 10) },
                              (r) =>
                                `Student's schedule ended — ${r?.sessionsRemoved ?? 0} remaining session${(r?.sessionsRemoved ?? 0) === 1 ? '' : 's'} removed (rescheduled make-ups included); the weekly pattern is stopped for good.`
                            )
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
                {/* PL-387 A: the inline edit-schedule form — same fields as
                    New Student Schedule, prefilled with the current pattern.
                    Saving re-projects FUTURE unbilled sessions only (the
                    engagement API's update+regenerate); family + tutor get
                    the pattern-change notices; completed/billed sessions are
                    never touched. */}
                {editFor === e.id && (
                  <div className="mt-2 border border-hgl-blue/40 bg-blue-50/40 rounded-lg p-3 space-y-2 text-sm">
                    {continuationContext && openScheduleEditorFor === e.id && (
                      <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        {continuationContext}
                      </p>
                    )}
                    <p className="font-semibold text-hgl-slate">Edit schedule</p>
                    {editSlots.map((slot, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select
                          value={slot.weekday}
                          onChange={(ev) => {
                            const v = Number(ev.target.value)
                            setEditSlots((p) => p.map((x, j) => (j === i ? { ...x, weekday: v } : x)))
                          }}
                          className="border border-gray-300 rounded p-1 bg-white"
                        >
                          {WEEKDAYS.map((w, wi) => (
                            <option key={w} value={wi + 1}>
                              {w}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={slot.start_time}
                          onChange={(ev) =>
                            setEditSlots((p) => p.map((x, j) => (j === i ? { ...x, start_time: ev.target.value } : x)))
                          }
                          className="border border-gray-300 rounded p-1"
                        />
                        <label className="text-xs text-gray-500">
                          for{' '}
                          <input
                            type="number"
                            min={15}
                            max={480}
                            step={15}
                            value={slot.duration_minutes}
                            onChange={(ev) =>
                              setEditSlots((p) =>
                                p.map((x, j) => (j === i ? { ...x, duration_minutes: Number(ev.target.value) } : x))
                              )
                            }
                            className="border border-gray-300 rounded p-1 w-16"
                          />{' '}
                          minutes
                        </label>
                        <button
                          onClick={() => setEditSlots((p) => p.filter((_, j) => j !== i))}
                          className="text-xs text-red-600 underline"
                        >
                          remove
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setEditSlots((p) => [...p, { weekday: 1, start_time: '16:00', duration_minutes: 60 }])}
                      className="text-xs text-hgl-blue underline"
                    >
                      + add a weekly slot
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Tutor:</span>
                      <select
                        value={editTutorId}
                        onChange={(ev) => {
                          setEditTutorId(ev.target.value)
                          void checkBusyConflicts(ev.target.value, editSlots)
                        }}
                        className="border border-gray-300 rounded p-1 bg-white"
                      >
                        {tutors.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name ?? t.email}
                          </option>
                        ))}
                        {!tutors.some((t) => t.id === editTutorId) && (
                          <option value={editTutorId}>{e.instructors?.name ?? 'current tutor'}</option>
                        )}
                      </select>
                    </div>
                    {busyWarnings.length > 0 && (
                      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 space-y-0.5">
                        {busyWarnings.map((w, i) => (
                          <p key={i}>⚠ {w}</p>
                        ))}
                        <p>Warnings, not blocks — save anyway if it's right.</p>
                      </div>
                    )}
                    <p className="text-xs text-gray-500">
                      Saving re-plans the upcoming, not-yet-billed sessions onto these times (Google
                      Calendar follows), tells the family and {e.instructors?.name ?? 'the tutor'} what
                      changed, and never touches completed or already-billed sessions.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          void checkBusyConflicts(editTutorId, editSlots)
                          update(
                            e.id,
                            { recurrence: editSlots, tutor_id: editTutorId, regenerate: true },
                            regenerateMessage
                          )
                        }}
                        disabled={busyId === e.id || editSlots.length === 0}
                        className="bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded disabled:opacity-40"
                      >
                        Save schedule
                      </button>
                      <button onClick={() => setEditFor(null)} className="text-xs text-gray-500 underline">
                        cancel
                      </button>
                    </div>
                  </div>
                )}
                {/* No-native-dialogs: overdraw / no-location walk-pasts. */}
                {pendingUpdate && pendingUpdate.id === e.id && (
                  <div className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded px-3 py-2 space-y-1.5 max-w-xl">
                    <p>{pendingUpdate.text}</p>
                    <p className="flex gap-2">
                      <button
                        onClick={() => {
                          const pu = pendingUpdate
                          setPendingUpdate(null)
                          void update(pu.id, { ...pu.body, [pu.confirmKey]: true }, pu.done)
                        }}
                        className="bg-hgl-slate text-white font-bold px-2.5 py-1 rounded"
                      >
                        Proceed anyway
                      </button>
                      <button
                        onClick={() => {
                          setPendingUpdate(null)
                          setMessage('Nothing changed.')
                        }}
                        className="underline text-gray-600"
                      >
                        Cancel
                      </button>
                    </p>
                  </div>
                )}
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
