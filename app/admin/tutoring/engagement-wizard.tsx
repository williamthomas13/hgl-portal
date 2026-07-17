'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { TimeSelect } from '../ui'
import AvailabilityGrid from '../../components/AvailabilityGrid'
import { generateOccurrences, horizonEndIso, addDaysIso } from '../../utils/tutoring'
import { suggestWeeklySlots, type AvailabilityRange } from '../../utils/availability'
import {
  WEEKDAYS,
  familyLabel,
  fmtDay,
  fmtTime,
  type RecurrenceSlotUI,
  type StudentOption,
  type Subject,
  type Tutor,
} from './types'

// New engagement wizard (Phase 7a §5): student → subject → tutor (filtered by
// subject, matching notes visible) → weekly slots against the tutor's
// freebusy → rate (defaults from subject) → funding → location → start date.
// Freebusy conflicts WARN, never block — the Ops Director's judgment wins. Reuses
// existing student/family records; creating new families/students stays on
// the main admin page (never duplicate a family that came through a class).
//
// PL-19 additions (docs/AVAILABILITY_MATCHING_SPEC.md): the student's weekly
// availability grid (from intake, editable here mid-phone-call, saved with
// source='staff') and ranked slot suggestions — student availability ∩ tutor
// Google free time ∩ offer windows over the whole generated-session horizon.
// Suggestion chips just pre-fill the slot rows; they never gate Create.

type AddonOption = { id: string; hours: number; label: string }

type BusyBlockUI = { start: string; end: string; title: string | null; private: boolean; allDay?: boolean }

/** 'HH:MM' (24h wall clock) → "4:00 PM" for chip labels. */
function fmtHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const am = h < 12
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`
}

export default function EngagementWizard({
  students,
  subjects,
  tutors,
  tutorNotes,
  onCreated,
}: {
  students: StudentOption[]
  subjects: Subject[]
  tutors: Tutor[]
  tutorNotes: Record<string, string>
  onCreated: () => void
}) {
  const [studentFilter, setStudentFilter] = useState('')
  const [studentId, setStudentId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [tutorId, setTutorId] = useState('')
  const [rate, setRate] = useState('')
  const [funding, setFunding] = useState<'monthly_billed' | 'package'>('monthly_billed')
  const [addonId, setAddonId] = useState('')
  const [addons, setAddons] = useState<AddonOption[]>([])
  const [slots, setSlots] = useState<RecurrenceSlotUI[]>([])
  const [location, setLocation] = useState('')
  const [startDate, setStartDate] = useState('')
  const [notes, setNotes] = useState('')
  const [busyBlocks, setBusyBlocks] = useState<BusyBlockUI[] | null>(null)
  const [busyThrough, setBusyThrough] = useState<string | null>(null) // how far the calendar check reaches
  const [busyUnavailable, setBusyUnavailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // PL-19: the student's weekly availability (family wall clock + timezone).
  const [availability, setAvailability] = useState<AvailabilityRange[]>([])
  const [availabilityTz, setAvailabilityTz] = useState('America/Denver')
  const [availabilityDirty, setAvailabilityDirty] = useState(false)
  const [availabilitySaving, setAvailabilitySaving] = useState(false)
  const [availabilityMsg, setAvailabilityMsg] = useState('')

  // PL-19: cadence inputs feeding the suggestions (and the slot-row default).
  const [sessionsPerWeek, setSessionsPerWeek] = useState(1)
  const [durationMinutes, setDurationMinutes] = useState(60)

  const subject = subjects.find((s) => s.id === subjectId) ?? null
  const tutor = tutors.find((t) => t.id === tutorId) ?? null

  const filteredStudents = useMemo(() => {
    const q = studentFilter.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) =>
      `${s.first_name} ${s.last_name} ${familyLabel(s.families)} ${s.families?.parent_email ?? ''}`
        .toLowerCase()
        .includes(q)
    )
  }, [students, studentFilter])

  // Tutors offering the picked subject float up; others stay pickable.
  const rankedTutors = useMemo(() => {
    const active = tutors.filter((t) => t.tutoring_active)
    if (!subject) return active
    return [...active].sort(
      (a, b) => Number(b.subjects.includes(subject.name)) - Number(a.subjects.includes(subject.name))
    )
  }, [tutors, subject])

  // Subject default rate.
  useEffect(() => {
    if (subject) setRate(String(subject.hourly_rate))
  }, [subject])

  // Tutor default location.
  useEffect(() => {
    if (tutor?.default_location) setLocation(tutor.default_location)
  }, [tutor])

  // Package options for the picked student (their enrollments' add-ons).
  useEffect(() => {
    setAddonId('')
    if (!studentId) {
      setAddons([])
      return
    }
    supabase
      .from('enrollment_addons')
      .select('id, hours, tutoring_packages ( name ), enrollments!inner ( student_id )')
      .eq('enrollments.student_id', studentId)
      .then(({ data }) => {
        setAddons(
          (data ?? []).map((a) => {
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            const pkg: any = Array.isArray(a.tutoring_packages) ? a.tutoring_packages[0] : a.tutoring_packages
            return { id: a.id, hours: Number(a.hours), label: `${pkg?.name ?? 'Package'} — ${a.hours}h purchased` }
          })
        )
      })
  }, [studentId])

  // PL-19: load the picked student's availability grid (intake rows included).
  useEffect(() => {
    setAvailability([])
    setAvailabilityTz('America/Denver')
    setAvailabilityDirty(false)
    setAvailabilityMsg('')
    if (!studentId) return
    supabase
      .from('student_availability')
      .select('weekday, start_time, end_time, timezone')
      .eq('student_id', studentId)
      .order('weekday')
      .order('start_time')
      .then(({ data }) => {
        const rows = data ?? []
        setAvailability(
          rows.map((r) => ({
            weekday: r.weekday,
            start_time: String(r.start_time).slice(0, 5),
            end_time: String(r.end_time).slice(0, 5),
          }))
        )
        if (rows[0]?.timezone) setAvailabilityTz(rows[0].timezone)
      })
  }, [studentId])

  async function saveAvailability() {
    if (!studentId) return
    if (availability.some((r) => r.end_time <= r.start_time)) {
      setAvailabilityMsg('Error: each range needs a start time before its end time.')
      return
    }
    setAvailabilitySaving(true)
    setAvailabilityMsg('')
    // Staff save replaces the whole grid — the phone-call correction is the
    // newest word, superseding whatever intake captured.
    const del = await supabase.from('student_availability').delete().eq('student_id', studentId)
    let error = del.error
    if (!error && availability.length > 0) {
      const { data: auth } = await supabase.auth.getUser()
      const ins = await supabase.from('student_availability').insert(
        availability.map((r) => ({
          student_id: studentId,
          weekday: r.weekday,
          start_time: r.start_time,
          end_time: r.end_time,
          timezone: availabilityTz,
          source: 'staff',
          updated_by: auth.user?.email ?? null,
        }))
      )
      error = ins.error
    }
    if (error) setAvailabilityMsg('Error: ' + error.message)
    else {
      setAvailabilityDirty(false)
      setAvailabilityMsg('Availability saved.')
    }
    setAvailabilitySaving(false)
  }

  // Freebusy whenever the tutor changes (§4: busy blocks inform; a Google
  // failure degrades to "availability unknown"). PL-28a: conflicts cover the
  // whole generated-session horizon (end of next month), not two weeks — the
  // first two-week window lands immediately so the wizard stays responsive,
  // then background requests extend the coverage in ≤44-day batches (the
  // route caps a request at 45 days). busyThrough tracks real coverage so a
  // mid-extension failure keeps partial data honest.
  useEffect(() => {
    setBusyBlocks(null)
    setBusyThrough(null)
    setBusyUnavailable(false)
    const tz = tutors.find((t) => t.id === tutorId)?.timezone
    if (!tutorId || !tz) return
    let cancelled = false
    async function run() {
      // Horizon end = last generated-session day + 1 (exclusive bound).
      const horizonEnd = new Date(addDaysIso(horizonEndIso(tz!), 1) + 'T00:00:00Z').getTime()
      const collected: BusyBlockUI[] = []
      let cursor = Date.now()
      let first = true
      while (cursor < horizonEnd) {
        const chunkEnd = Math.min(horizonEnd, cursor + (first ? 14 : 44) * 86_400_000)
        const res = await fetch('/api/gcal/freebusy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tutorId,
            timeMin: new Date(cursor).toISOString(),
            timeMax: new Date(chunkEnd).toISOString(),
          }),
        })
        const json = await res.json()
        if (cancelled) return
        if (!json.available) {
          if (first) setBusyUnavailable(true)
          return // keep whatever coverage we already have
        }
        collected.push(...(json.busy as BusyBlockUI[]))
        setBusyBlocks([...collected])
        setBusyThrough(new Date(chunkEnd).toISOString())
        cursor = chunkEnd
        first = false
      }
    }
    run().catch(() => {
      if (!cancelled) setBusyUnavailable(true)
    })
    return () => {
      cancelled = true
    }
  }, [tutorId, tutors])

  // Conflict preview across the checked window — each hit names the
  // conflicting event (or "busy — private event" when Google says so).
  // PL-29: one row per (event × occurrence), deduped.
  const conflicts = useMemo(() => {
    if (!tutor || !busyBlocks || !busyThrough || slots.length === 0) return []
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tutor.timezone })
    const to = new Date(busyThrough).toLocaleDateString('en-CA', { timeZone: tutor.timezone })
    const from = startDate && startDate > today ? startDate : today
    const occurrences = generateOccurrences(slots, from, to, tutor.timezone)
    const out: { occ: (typeof occurrences)[number]; block: BusyBlockUI }[] = []
    const seen = new Set<string>()
    for (const occ of occurrences) {
      for (const block of busyBlocks) {
        if (occ.startsAt.getTime() < new Date(block.end).getTime() && occ.endsAt.getTime() > new Date(block.start).getTime()) {
          const key = `${occ.startsAt.getTime()}|${block.start}|${block.end}|${block.title ?? ''}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ occ, block })
        }
      }
    }
    return out
  }, [tutor, busyBlocks, busyThrough, slots, startDate])

  // PL-19 §4: ranked weekly-slot suggestions. Recomputes as the grid, tutor,
  // cadence, or calendar coverage changes; chips only pre-fill the slot rows.
  const suggestions = useMemo(() => {
    if (!tutor || !busyBlocks || availability.length === 0) return []
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tutor.timezone })
    const from = startDate && startDate > today ? startDate : today
    return suggestWeeklySlots({
      availability,
      familyTimezone: availabilityTz,
      busy: busyBlocks,
      offerWindows: tutor.offer_windows ?? [],
      tutorTimezone: tutor.timezone,
      sessionsPerWeek,
      durationMinutes,
      fromIso: from,
      toIso: horizonEndIso(tutor.timezone),
    })
  }, [tutor, busyBlocks, availability, availabilityTz, sessionsPerWeek, durationMinutes, startDate])

  // "…through October" — the horizon month, for chip + conflict copy.
  const horizonLabel = useMemo(() => {
    if (!tutor) return ''
    return new Date(horizonEndIso(tutor.timezone) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long' })
  }, [tutor])

  function addSlot() {
    setSlots((s) => [...s, { weekday: 1, start_time: '16:00', duration_minutes: durationMinutes }])
  }
  function setSlot(i: number, patch: Partial<RecurrenceSlotUI>) {
    setSlots((s) => s.map((slot, j) => (j === i ? { ...slot, ...patch } : slot)))
  }

  async function submit() {
    setSaving(true)
    setMessage('')
    const res = await fetch('/api/admin/tutoring/engagement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        student_id: studentId,
        tutor_id: tutorId,
        subject_id: subjectId,
        hourly_rate: Number(rate),
        funding,
        addon_id: funding === 'package' ? addonId : null,
        recurrence: slots,
        location: location.trim() || null,
        start_date: startDate || null,
        notes: notes.trim() || null,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      setMessage('Error: ' + json.error)
    } else {
      setMessage(
        `Student schedule created — ${json.sessionsCreated} session${json.sessionsCreated === 1 ? '' : 's'} scheduled` +
          ` and queued for the tutor's Google Calendar.`
      )
      setStudentId('')
      setSubjectId('')
      setTutorId('')
      setSlots([])
      setNotes('')
      onCreated()
    }
    setSaving(false)
  }

  const ready = studentId && subjectId && tutorId && Number(rate) > 0 && (funding !== 'package' || addonId)

  return (
    <div className="space-y-5 text-sm">
      {/* 1. Student */}
      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">1 · Student</label>
        <input
          type="text"
          value={studentFilter}
          onChange={(e) => setStudentFilter(e.target.value)}
          placeholder="Search by student or parent…"
          className="w-full border border-gray-300 rounded-md p-2 mb-1"
        />
        <select
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="w-full border border-gray-300 rounded-md p-2 bg-white"
        >
          <option value="">Pick a student…</option>
          {filteredStudents.map((s) => (
            <option key={s.id} value={s.id}>
              {s.first_name} {s.last_name} — {familyLabel(s.families)}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">
          New family? Create the family/student on the main admin page first — never re-enter a
          family that came through a group class.
        </p>
      </div>

      {/* 1b. Student availability (PL-19 §3): the intake grid, editable here
          mid-phone-call. Feeds the suggestions below; saving is optional. */}
      {studentId && (
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">
            When is this student usually free?{' '}
            <span className="font-normal text-gray-400">
              (from the intake form when the family filled it in — correct it here as you talk)
            </span>
          </label>
          <AvailabilityGrid
            ranges={availability}
            timezone={availabilityTz}
            onChange={(r) => {
              setAvailability(r)
              setAvailabilityDirty(true)
              setAvailabilityMsg('')
            }}
            onTimezoneChange={(tz) => {
              setAvailabilityTz(tz)
              setAvailabilityDirty(true)
              setAvailabilityMsg('')
            }}
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={saveAvailability}
              disabled={!availabilityDirty || availabilitySaving}
              className="text-xs bg-hgl-slate text-white py-1.5 px-3 rounded hover:opacity-90 disabled:opacity-40"
            >
              Save availability
            </button>
            {availabilityMsg && (
              <span className={`text-xs ${availabilityMsg.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
                {availabilityMsg}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. Subject */}
      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">2 · Subject</label>
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className="w-full border border-gray-300 rounded-md p-2 bg-white"
        >
          <option value="">Pick a subject…</option>
          {subjects.filter((s) => s.active).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — ${s.hourly_rate}/hr ({s.category === 'test_prep' ? 'test prep' : 'subject tutoring'})
            </option>
          ))}
        </select>
      </div>

      {/* 3. Tutor */}
      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">
          3 · Tutor {subject && <span className="font-normal text-gray-400">(matches for {subject.name} first)</span>}
        </label>
        <select
          value={tutorId}
          onChange={(e) => setTutorId(e.target.value)}
          className="w-full border border-gray-300 rounded-md p-2 bg-white"
        >
          <option value="">Pick a tutor…</option>
          {rankedTutors.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name ?? t.email}
              {subject && !t.subjects.includes(subject.name) ? ' (subject not listed)' : ''}
            </option>
          ))}
        </select>
        {tutor && tutorNotes[tutor.id] && (
          <p className="text-xs text-gray-500 mt-1 bg-amber-50 border border-amber-200 rounded p-2">
            <span className="font-semibold">Matching notes:</span> {tutorNotes[tutor.id]}
          </p>
        )}
      </div>

      {/* 4. Weekly slots */}
      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">
          4 · Weekly schedule{' '}
          <span className="font-normal text-gray-400">
            (times in {tutor ? `${tutor.timezone}` : 'the tutor’s timezone'}; leave empty for one-off-only)
          </span>
        </label>

        {/* PL-19 §4: cadence inputs + suggestion chips. Chips fill the slot
            rows exactly as if typed; manual entry always works without them. */}
        <div className="flex items-center gap-3 mb-2 text-xs text-gray-600">
          <label className="flex items-center gap-1.5">
            Sessions per week
            <select
              value={sessionsPerWeek}
              onChange={(e) => setSessionsPerWeek(Number(e.target.value))}
              className="border border-gray-300 rounded p-1 bg-white"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Session length
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="border border-gray-300 rounded p-1 bg-white"
            >
              {[30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </label>
        </div>
        {studentId && tutorId && availability.length === 0 && (
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2 mb-2">
            No availability on file for this student — add it above and we&apos;ll suggest times.
          </p>
        )}
        {suggestions.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-gray-500 mb-1">
              Suggested times (fit the student&apos;s availability and {tutor?.name ?? 'the tutor'}&apos;s
              calendar — tap one to fill the rows, or ignore and type your own):
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((combo, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSlots(combo.slots.map((s) => ({ ...s })))}
                  className="text-xs border border-hgl-blue text-hgl-blue rounded-full px-3 py-1.5 hover:bg-hgl-blue hover:text-white transition"
                >
                  {combo.slots
                    .map((s) => `${WEEKDAYS[s.weekday - 1]} ${fmtHHMM(s.start_time)}`)
                    .join(' + ')}{' '}
                  —{' '}
                  {combo.conflicts === 0
                    ? `no conflicts through ${horizonLabel}`
                    : `${combo.conflicts} conflict${combo.conflicts === 1 ? '' : 's'}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {slots.map((slot, i) => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <select
              value={slot.weekday}
              onChange={(e) => setSlot(i, { weekday: Number(e.target.value) })}
              className="border border-gray-300 rounded p-1 bg-white"
            >
              {WEEKDAYS.map((d, j) => (
                <option key={d} value={j + 1}>{d}</option>
              ))}
            </select>
            <TimeSelect value={slot.start_time} onChange={(v) => setSlot(i, { start_time: v || '16:00' })} />
            <select
              value={slot.duration_minutes}
              onChange={(e) => setSlot(i, { duration_minutes: Number(e.target.value) })}
              className="border border-gray-300 rounded p-1 bg-white"
            >
              {[30, 45, 60, 90, 120, 150, 180].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
            <button onClick={() => setSlots((s) => s.filter((_, j) => j !== i))} className="text-red-600 text-xs underline">
              remove
            </button>
          </div>
        ))}
        <button onClick={addSlot} className="text-hgl-blue text-xs underline">
          + add weekly slot
        </button>

        {tutorId && busyUnavailable && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
            Google availability unavailable right now — schedule on, but double-check the tutor&apos;s calendar.
          </p>
        )}
        {conflicts.length > 0 && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded p-2 mt-2">
            <span className="font-semibold">
              ⚠ {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} with {tutor?.name ?? 'the tutor'}
              &apos;s calendar through {busyThrough ? fmtDay(busyThrough, tutor!.timezone) : 'the horizon'}
            </span>{' '}
            (you can still schedule — your call):
            <ul className="mt-1">
              {conflicts.slice(0, 8).map((c, i) => (
                <li key={i}>
                  {fmtDay(c.occ.startsAt.toISOString(), tutor!.timezone)}{' '}
                  {fmtTime(c.occ.startsAt.toISOString(), tutor!.timezone)} — conflicts with:{' '}
                  <span className="font-semibold">
                    {c.block.title ?? (c.block.private ? 'busy — private event' : 'busy')}
                  </span>
                  ,{' '}
                  {c.block.allDay
                    ? `${fmtDay(c.block.start, tutor!.timezone)} (all day)`
                    : `${fmtTime(c.block.start, tutor!.timezone)}–${fmtTime(c.block.end, tutor!.timezone)}`}
                </li>
              ))}
              {conflicts.length > 8 && <li>… and {conflicts.length - 8} more</li>}
            </ul>
          </div>
        )}
        {tutorId && busyBlocks && busyThrough && slots.length > 0 && conflicts.length === 0 && (
          <p className="text-xs text-green-700 mt-2">
            ✓ No conflicts with the tutor&apos;s calendar through {fmtDay(busyThrough, tutor!.timezone)}.
          </p>
        )}
      </div>

      {/* 5. Rate, funding, location, start */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">
            Rate $/hour <span className="font-normal text-gray-400">(EB / international / discounts: override here)</span>
          </label>
          <input
            type="number"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            min={0}
            step={5}
            className="w-full border border-gray-300 rounded-md p-2"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Funding</label>
          <select
            value={funding}
            onChange={(e) => setFunding(e.target.value as 'monthly_billed' | 'package')}
            className="w-full border border-gray-300 rounded-md p-2 bg-white"
          >
            <option value="monthly_billed">Monthly billed (invoice month in advance — 7c)</option>
            <option value="package">Package hours (draws down a purchased add-on)</option>
          </select>
          {funding === 'package' && (
            <select
              value={addonId}
              onChange={(e) => setAddonId(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 bg-white mt-1"
            >
              <option value="">Pick the package…</option>
              {addons.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          )}
          {funding === 'package' && addons.length === 0 && studentId && (
            <p className="text-xs text-amber-700 mt-1">
              This student has no purchased packages on file (packages currently attach to class
              enrollments — standalone package purchase arrives with 7d).
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Location / meeting link</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Start date (blank = now)</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">Notes (staff)</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      <button
        onClick={submit}
        disabled={!ready || saving}
        className="bg-hgl-slate text-white py-2 px-6 rounded hover:opacity-90 disabled:opacity-50"
      >
        Create student schedule{slots.length > 0 ? ' + sessions' : ''}
      </button>

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
