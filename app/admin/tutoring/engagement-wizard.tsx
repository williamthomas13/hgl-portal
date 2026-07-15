'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { TimeSelect } from '../ui'
import { generateOccurrences } from '../../utils/tutoring'
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

type AddonOption = { id: string; hours: number; label: string }

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
  const [busyBlocks, setBusyBlocks] = useState<
    { start: string; end: string; title: string | null; private: boolean }[] | null
  >(null)
  const [busyUnavailable, setBusyUnavailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

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

  // Freebusy for the next two weeks whenever the tutor changes (§4: busy
  // blocks inform; a Google failure degrades to "availability unknown").
  useEffect(() => {
    setBusyBlocks(null)
    setBusyUnavailable(false)
    if (!tutorId) return
    const timeMin = new Date().toISOString()
    const timeMax = new Date(Date.now() + 14 * 86_400_000).toISOString()
    fetch('/api/gcal/freebusy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId, timeMin, timeMax }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.available) setBusyBlocks(json.busy)
        else setBusyUnavailable(true)
      })
      .catch(() => setBusyUnavailable(true))
  }, [tutorId])

  // Conflict preview: materialize the proposed slots over the two-week window
  // and intersect with the tutor's calendar events — each hit names the
  // conflicting event (or "busy (private event)" when Google says so).
  const conflicts = useMemo(() => {
    if (!tutor || !busyBlocks || slots.length === 0) return []
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tutor.timezone })
    const to = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('en-CA', { timeZone: tutor.timezone })
    const from = startDate && startDate > today ? startDate : today
    const occurrences = generateOccurrences(slots, from, to, tutor.timezone)
    const out: { occ: (typeof occurrences)[number]; block: NonNullable<typeof busyBlocks>[number] }[] = []
    for (const occ of occurrences) {
      for (const block of busyBlocks) {
        if (occ.startsAt.getTime() < new Date(block.end).getTime() && occ.endsAt.getTime() > new Date(block.start).getTime()) {
          out.push({ occ, block })
        }
      }
    }
    return out
  }, [tutor, busyBlocks, slots, startDate])

  function addSlot() {
    setSlots((s) => [...s, { weekday: 1, start_time: '16:00', duration_minutes: 60 }])
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
              &apos;s calendar in the next two weeks
            </span>{' '}
            (you can still schedule — your call):
            <ul className="mt-1">
              {conflicts.slice(0, 5).map((c, i) => (
                <li key={i}>
                  {fmtDay(c.occ.startsAt.toISOString(), tutor!.timezone)}{' '}
                  {fmtTime(c.occ.startsAt.toISOString(), tutor!.timezone)} — conflicts with:{' '}
                  <span className="font-semibold">
                    {c.block.title ?? (c.block.private ? 'busy (private event)' : 'busy')}
                  </span>
                  , {fmtTime(c.block.start, tutor!.timezone)}–{fmtTime(c.block.end, tutor!.timezone)}
                </li>
              ))}
              {conflicts.length > 5 && <li>… and {conflicts.length - 5} more</li>}
            </ul>
          </div>
        )}
        {tutorId && busyBlocks && slots.length > 0 && conflicts.length === 0 && (
          <p className="text-xs text-green-700 mt-2">✓ No conflicts with the tutor&apos;s calendar in the next two weeks.</p>
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
