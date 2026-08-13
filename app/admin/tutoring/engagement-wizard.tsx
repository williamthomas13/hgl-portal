'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { DateHint, SearchCombobox, TimeSelect } from '../ui'
import AvailabilityGrid from '../../components/AvailabilityGrid'
import { generateOccurrences, horizonEndIso, addDaysIso } from '../../utils/tutoring'
import {
  availabilitySummary,
  slotOutsideAvailability,
  suggestWeeklySlots,
  type AvailabilityRange,
} from '../../utils/availability'
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
// existing student/family records; creating new families/students happens on
// the leads page (PL-22) — never duplicate a family that came through a class.
//
// PL-19 additions (docs/AVAILABILITY_MATCHING_SPEC.md): the student's weekly
// availability grid (from intake, editable here mid-phone-call, saved with
// source='staff') and ranked slot suggestions — student availability ∩ tutor
// Google free time ∩ offer windows over the whole generated-session horizon.
// Suggestion chips just pre-fill the slot rows; they never gate Create.

type AddonOption = {
  id: string
  hours: number
  /** Purchased minus drawn-down across EVERY engagement on this addon. */
  remaining: number
  /** First name of the student whose active schedule already draws on it. */
  attachedTo: string | null
  label: string
}

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
  preloadStudentId,
  onCreated,
}: {
  students: StudentOption[]
  subjects: Subject[]
  tutors: Tutor[]
  tutorNotes: Record<string, string>
  /** PL-92: the availability-shared alert's "Schedule {student} now" —
   *  preselects the student so their shared windows load on arrival. */
  preloadStudentId?: string | null
  onCreated: () => void
}) {
  const [studentFilter, setStudentFilter] = useState('')
  const [studentId, setStudentId] = useState('')
  // Adopt the deep-link preload once the student list is in.
  const [seenPreload, setSeenPreload] = useState<string | null>(null)
  if (preloadStudentId && preloadStudentId !== seenPreload && students.some((s) => s.id === preloadStudentId)) {
    setSeenPreload(preloadStudentId)
    setStudentId(preloadStudentId)
  }
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
  // PL-41: default ON — the parent confirms before anything locks in.
  const [requireApproval, setRequireApproval] = useState(true)

  // PL-19: the student's weekly availability (family wall clock + timezone).
  const [availability, setAvailability] = useState<AvailabilityRange[]>([])
  const [availabilityTz, setAvailabilityTz] = useState('America/Denver')
  const [availabilityDirty, setAvailabilityDirty] = useState(false)
  const [availabilitySaving, setAvailabilitySaving] = useState(false)
  const [availabilityMsg, setAvailabilityMsg] = useState('')

  // PL-19: cadence inputs feeding the suggestions (and the slot-row default).
  const [sessionsPerWeek, setSessionsPerWeek] = useState(1)
  const [durationMinutes, setDurationMinutes] = useState(60)

  // PL-171: the in-progress form persists per admin (localStorage) so a
  // phone call and a navigation away don't cost the half-built schedule.
  // Interruptions are normal ops, not an edge case.
  type WizardDraft = {
    savedAt: string
    studentId: string
    subjectId: string
    tutorId: string
    rate: string
    funding: 'monthly_billed' | 'package'
    addonId: string
    slots: RecurrenceSlotUI[]
    location: string
    locationMode: 'online' | 'in_person'
    startDate: string
    notes: string
    sessionsPerWeek: number
    durationMinutes: number
    requireApproval: boolean
  }
  const DRAFT_KEY = 'hgl-schedule-wizard-draft'
  const [draftOffer, setDraftOffer] = useState<WizardDraft | null>(null)
  // One-shot restore values, consumed by the derived-state effects so a
  // resumed draft's rate/location/payment aren't clobbered by their own
  // recompute-on-change logic.
  const restoreRef = useRef<Partial<WizardDraft> | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw) as WizardDraft
      if (d && (d.studentId || d.subjectId || (d.slots?.length ?? 0) > 0 || d.notes)) setDraftOffer(d)
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* a corrupt draft is not worth an error */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subject = subjects.find((s) => s.id === subjectId) ?? null
  const tutor = tutors.find((t) => t.id === tutorId) ?? null

  // PL-184: the "Schedule {student} now" deep link arrives knowing the
  // student — the SUBJECT prefills to the closest match from what the portal
  // already knows: a prior engagement's subject, then the intake sheet's
  // stated subjects, then the class they came from. Editable — a prefill is
  // a default, not a decision (picking something else stays one click).
  useEffect(() => {
    if (!seenPreload || studentId !== seenPreload || subjectId) return
    let stale = false
    ;(async () => {
      const { data: eng } = await supabase
        .from('tutoring_engagements')
        .select('subject_id')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (eng?.[0]?.subject_id) {
        if (!stale) setSubjectId(eng[0].subject_id)
        return
      }
      const byText = (text: string) =>
        subjects.find((s) => s.active && text && text.toLowerCase().includes(s.name.toLowerCase())) ?? null
      const { data: leadRows } = await supabase
        .from('leads')
        .select('subjects, interest')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(1)
      let match = byText(leadRows?.[0]?.subjects ?? '')
      if (!match) {
        const { data: enr } = await supabase
          .from('enrollments')
          .select('classes ( class_type )')
          .eq('student_id', studentId)
          .order('enrolled_at', { ascending: false })
          .limit(3)
        for (const e of (enr as any[]) ?? []) {
          const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes
          match = byText(cls?.class_type ?? '')
          if (match) break
        }
      }
      if (match && !stale) setSubjectId(match.id)
    })()
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenPreload, studentId, subjectId, subjects])

  function resumeDraft() {
    const d = draftOffer
    if (!d) return
    restoreRef.current = { rate: d.rate, funding: d.funding, addonId: d.addonId, location: d.location }
    setStudentId(d.studentId)
    setSubjectId(d.subjectId)
    setTutorId(d.tutorId)
    setSlots(d.slots ?? [])
    setLocationMode(d.locationMode ?? 'online')
    setStartDate(d.startDate ?? '')
    setNotes(d.notes ?? '')
    setSessionsPerWeek(d.sessionsPerWeek ?? 1)
    setDurationMinutes(d.durationMinutes ?? 60)
    setRequireApproval(d.requireApproval ?? true)
    setDraftOffer(null)
  }

  function discardDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
    setDraftOffer(null)
  }

  // PL-76: surface a cancellation credit while proposing the first month —
  // the family's cancelled-class payment rides their Stripe balance and
  // future tutoring invoices consume it automatically.
  const [conversionCredit, setConversionCredit] = useState<number | null>(null)
  useEffect(() => {
    setConversionCredit(null)
    const familyId = students.find((x) => x.id === studentId)?.families?.id
    if (!familyId) return
    let stale = false
    ;(async () => {
      const { data } = await supabase
        .from('enrollments')
        .select('tutoring_credit_amount, students!inner ( family_id )')
        .eq('students.family_id', familyId)
        .not('converted_to_tutoring_at', 'is', null)
      if (stale) return
      const total = (data ?? []).reduce((sum, r) => sum + Number(r.tutoring_credit_amount ?? 0), 0)
      setConversionCredit(total > 0 ? total : null)
    })()
    return () => {
      stale = true
    }
  }, [studentId, students])

  const filteredStudents = useMemo(() => {
    const q = studentFilter.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) =>
      `${s.first_name} ${s.last_name} ${familyLabel(s.families)} ${s.families?.parent_email ?? ''}`
        .toLowerCase()
        .includes(q)
    )
  }, [students, studentFilter])

  // PL-110: the wizard KNOWS about prospective students — open leads without
  // a student record yet search alongside real students and surface FIRST.
  type LeadOption = { id: string; student_name: string | null; contact_name: string | null; contact_email: string | null; status: string }
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([])
  const [pullingLeadId, setPullingLeadId] = useState('')
  const [pendingPickId, setPendingPickId] = useState<string | null>(null)
  useEffect(() => {
    supabase
      .from('leads')
      .select('id, student_name, contact_name, contact_email, status')
      .not('status', 'in', '("scheduled","lost","converted")')
      .is('student_id', null)
      .then(({ data }) => setLeadOptions((data as LeadOption[]) ?? []))
  }, [])
  const filteredLeads = useMemo(() => {
    const q = studentFilter.trim().toLowerCase()
    if (!q) return []
    return leadOptions.filter((l) =>
      `${l.student_name ?? ''} ${l.contact_name ?? ''} ${l.contact_email ?? ''}`.toLowerCase().includes(q)
    )
  }, [leadOptions, studentFilter])
  // Adopt a pulled-through student once the refreshed list contains them
  // (same late-adoption pattern as the deep-link preload).
  if (pendingPickId && students.some((st) => st.id === pendingPickId)) {
    setPendingPickId(null)
    setStudentId(pendingPickId)
  }
  async function pullThroughLead(lead: LeadOption) {
    setPullingLeadId(lead.id)
    const res = await fetch('/api/admin/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_family', id: lead.id }),
    })
    const json = await res.json().catch(() => ({}))
    setPullingLeadId('')
    if (!res.ok) return alert(json.error ?? 'Could not pull the prospective student through.')
    // Family+student now exist (deduped by parent email / student name) and
    // any intake availability is already on the student — refresh the page's
    // student list and pick them; the pipeline advances to Started the
    // moment the schedule is created (the existing PL-10 trigger).
    setLeadOptions((prev) => prev.filter((l) => l.id !== lead.id))
    setPendingPickId(json.studentId)
    onCreated()
  }
  async function addNewProspect() {
    const studentName = prompt('Student name (first last):', studentFilter.trim())
    if (studentName == null || !studentName.trim()) return
    const parentName = prompt("Parent/guardian name:")
    if (parentName == null) return
    const parentEmail = (prompt('Parent email (their login + billing contact):') ?? '').trim().toLowerCase()
    if (!parentEmail || !/^\S+@\S+\.\S+$/.test(parentEmail)) return alert('A valid parent email is required.')
    // Dedupe guard: same email/name anywhere → ask before creating.
    const emailMatch =
      students.find((st) => (st.families?.parent_email ?? '').toLowerCase() === parentEmail) ??
      null
    const leadMatch = leadOptions.find((l) => (l.contact_email ?? '').toLowerCase() === parentEmail) ?? null
    if (emailMatch) {
      if (confirm(`${parentEmail} already belongs to ${familyLabel(emailMatch.families)} — is this the same family? OK picks their existing record.`)) {
        setStudentId(emailMatch.id)
        return
      }
      return
    }
    if (leadMatch) {
      if (confirm(`${parentEmail} is already on the pipeline (${leadMatch.student_name ?? leadMatch.contact_name}) — same family? OK pulls that record through.`)) {
        await pullThroughLead(leadMatch)
      }
      return
    }
    // Lead-backed create — never an orphan family (the pipeline record IS
    // the paper trail).
    const res = await fetch('/api/admin/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', source: 'call', student_name: studentName.trim(), contact_name: (parentName ?? '').trim() || null, contact_email: parentEmail, interest: 'unsure', status: 'contacted' }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return alert(json.error ?? 'Could not create the prospective student.')
    await pullThroughLead({ id: json.lead?.id ?? json.id, student_name: studentName.trim(), contact_name: parentName, contact_email: parentEmail, status: 'contacted' })
  }

  // PL-53d: the class instructor's handoff note + who taught this student
  // (continuity hint — never a rule; the Ops Director's judgment wins).
  const [handoffNote, setHandoffNote] = useState<{ note: string; by: string | null } | null>(null)
  const [classInstructorIds, setClassInstructorIds] = useState<Set<string>>(new Set())

  // Tutors offering the picked subject float up; others stay pickable.
  // PL-35a §1a: only the READY set counts as a match — needs-prep tutors rank
  // as a clearly-labeled middle tier and are never treated as a normal match.
  const tutorTier = (t: Tutor): 0 | 1 | 2 => {
    if (!subject) return 2
    if (t.subjects.includes(subject.name)) return 2
    if (t.subjects_with_prep.includes(subject.name)) return 1
    return 0
  }
  const rankedTutors = useMemo(() => {
    // PL-176: made-inactive instructors leave every new-scheduling picker.
    const active = tutors.filter((t) => t.tutoring_active && t.active !== false)
    const continuity = (t: Tutor) => Number(classInstructorIds.has(t.id))
    if (!subject) return [...active].sort((a, b) => continuity(b) - continuity(a))
    // PL-53d: same-tier continuity floats up — "taught their class" beats a
    // stranger, but never beats actually offering the subject.
    return [...active].sort(
      (a, b) => tutorTier(b) - tutorTier(a) || continuity(b) - continuity(a)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutors, subject, classInstructorIds])

  // Subject default rate.
  useEffect(() => {
    // PL-171: a resumed draft's (possibly overridden) rate wins once.
    if (restoreRef.current && 'rate' in restoreRef.current) {
      setRate(restoreRef.current.rate ?? '')
      delete restoreRef.current.rate
      return
    }
    if (subject) setRate(String(subject.hourly_rate))
  }, [subject])

  // PL-24: online/in-person toggle drives the location default — online pulls
  // the tutor's saved meeting link, in person the office; both overridable
  // in the field below (same pattern as the rate override).
  const [locationMode, setLocationMode] = useState<'online' | 'in_person'>('online')
  useEffect(() => {
    // PL-171: a resumed draft's location wins once over the mode default.
    if (restoreRef.current && 'location' in restoreRef.current) {
      setLocation(restoreRef.current.location ?? '')
      delete restoreRef.current.location
      return
    }
    if (locationMode === 'in_person') setLocation('Higher Ground Learning')
    else setLocation(tutor?.default_meeting_link ?? '')
  }, [tutor, locationMode])

  // PL-171: debounced autosave — anything meaningful persists; a cleared
  // form clears the draft. Paused while a resume offer is on screen so the
  // empty form doesn't overwrite the very draft being offered.
  useEffect(() => {
    if (draftOffer) return
    const t = setTimeout(() => {
      const meaningful = studentId || subjectId || slots.length > 0 || notes.trim()
      try {
        if (meaningful) {
          const draft: WizardDraft = {
            savedAt: new Date().toISOString(),
            studentId,
            subjectId,
            tutorId,
            rate,
            funding,
            addonId,
            slots,
            location,
            locationMode,
            startDate,
            notes,
            sessionsPerWeek,
            durationMinutes,
            requireApproval,
          }
          localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
        } else {
          localStorage.removeItem(DRAFT_KEY)
        }
      } catch {
        /* storage full/blocked — autosave is best-effort */
      }
    }, 600)
    return () => clearTimeout(t)
  }, [
    draftOffer,
    studentId,
    subjectId,
    tutorId,
    rate,
    funding,
    addonId,
    slots,
    location,
    locationMode,
    startDate,
    notes,
    sessionsPerWeek,
    durationMinutes,
    requireApproval,
  ])


  // PL-170: package options for the picked student's FAMILY (a sibling's
  // unused package is still the family's prepaid money), with hours remaining
  // computed across every engagement drawing on each addon — the same status
  // set as packageHoursUsedBefore, the function that actually bills.
  // Packages win by default: if usable prepaid hours exist, funding defaults
  // to package (auto-picking when there's exactly one); invoicing while
  // hours sit unused gets a warning below, never a block.
  const [familyUnusedHours, setFamilyUnusedHours] = useState(0)
  useEffect(() => {
    setAddonId('')
    setAddons([])
    setFamilyUnusedHours(0)
    if (!studentId) return
    const familyId = students.find((x) => x.id === studentId)?.families?.id
    if (!familyId) return
    let stale = false
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(async () => {
      const { data: addonRows } = await supabase
        .from('enrollment_addons')
        .select(
          'id, hours, source, tutoring_packages ( name ), enrollments!inner ( students!inner ( id, first_name, family_id ) )'
        )
        .eq('enrollments.students.family_id', familyId)
      const rows = (addonRows as any[]) ?? []
      const usedByAddon: Record<string, number> = {}
      const attachedTo: Record<string, string> = {}
      if (rows.length > 0) {
        const { data: engs } = await supabase
          .from('tutoring_engagements')
          .select('id, addon_id, status, students ( first_name )')
          .in('addon_id', rows.map((a) => a.id))
        const engAddon: Record<string, string> = {}
        for (const e of (engs as any[]) ?? []) {
          engAddon[e.id] = e.addon_id
          // Billing draws down per engagement, so an addon can only safely
          // fuel ONE live schedule — mark the ones already committed.
          if (e.status === 'active' || e.status === 'pending_parent_confirmation') {
            const s = Array.isArray(e.students) ? e.students[0] : e.students
            attachedTo[e.addon_id] = s?.first_name ?? 'a student'
          }
        }
        const engIds = Object.keys(engAddon)
        if (engIds.length > 0) {
          const { data: consuming } = await supabase
            .from('tutoring_sessions')
            .select('engagement_id, duration_minutes, status, reschedule_notice')
            .in('engagement_id', engIds)
            .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
          for (const s of (consuming as any[]) ?? []) {
            if (s.status === 'rescheduled' && s.reschedule_notice !== 'late') continue
            const aid = engAddon[s.engagement_id]
            if (aid) usedByAddon[aid] = (usedByAddon[aid] ?? 0) + s.duration_minutes / 60
          }
        }
      }
      if (stale) return
      const options: AddonOption[] = rows.map((a) => {
        const pkg: any = Array.isArray(a.tutoring_packages) ? a.tutoring_packages[0] : a.tutoring_packages
        // PL-84: conversion packages have no catalog package behind them.
        const name = pkg?.name ?? (a.source === 'cancellation_conversion' ? 'Cancellation conversion' : 'Package')
        const enr: any = Array.isArray(a.enrollments) ? a.enrollments[0] : a.enrollments
        const stu: any = Array.isArray(enr?.students) ? enr?.students[0] : enr?.students
        const remaining = Math.max(0, Number(a.hours) - (usedByAddon[a.id] ?? 0))
        const whose = stu && stu.id !== studentId ? ` — bought with ${stu.first_name}'s registration` : ''
        const state = attachedTo[a.id]
          ? ` — already fueling ${attachedTo[a.id]}'s schedule`
          : ` · ${remaining.toFixed(1)}h left`
        return {
          id: a.id,
          hours: Number(a.hours),
          remaining,
          attachedTo: attachedTo[a.id] ?? null,
          label: `${name} — ${a.hours}h purchased${state}${whose}`,
        }
      })
      setAddons(options)
      // "Sitting unused" = hours on packages no live schedule is consuming.
      const usable = options.filter((o) => o.remaining > 0 && !o.attachedTo)
      setFamilyUnusedHours(usable.reduce((sum, o) => sum + o.remaining, 0))
      // PL-171: a resumed draft's payment choice wins once — but only while
      // still valid for this student (the addon must exist and be usable);
      // anything invalidated falls through to the PL-170 defaults, which the
      // payment section shows rather than silently keeping stale state.
      const restore = restoreRef.current
      if (restore && ('funding' in restore || 'addonId' in restore)) {
        const wantFunding = restore.funding
        const wantAddon = restore.addonId
        delete restore.funding
        delete restore.addonId
        if (wantFunding === 'monthly_billed') {
          setFunding('monthly_billed')
          return
        }
        if (wantFunding === 'package' && wantAddon && usable.some((o) => o.id === wantAddon)) {
          setFunding('package')
          setAddonId(wantAddon)
          return
        }
        // fall through: the drafted package no longer fits this student.
      }
      if (usable.length > 0) {
        setFunding('package')
        if (usable.length === 1) setAddonId(usable[0].id)
      } else {
        setFunding('monthly_billed')
      }
    })()
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return () => {
      stale = true
    }
  }, [studentId, students])

  useEffect(() => {
    setHandoffNote(null)
    setClassInstructorIds(new Set())
    if (!studentId) return
    supabase
      .from('students')
      .select('tutoring_handoff_note, tutoring_handoff_by')
      .eq('id', studentId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.tutoring_handoff_note) {
          setHandoffNote({ note: data.tutoring_handoff_note, by: data.tutoring_handoff_by })
        }
      })
    supabase
      .from('enrollments')
      .select('classes ( instructor_id )')
      .eq('student_id', studentId)
      .then(({ data }) => {
        const ids = (data ?? [])
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          .map((e: any) => (Array.isArray(e.classes) ? e.classes[0] : e.classes)?.instructor_id)
          .filter(Boolean)
        setClassInstructorIds(new Set(ids))
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
        const json = await res.json().catch(() => ({}))
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

  // PL-169: a slot outside the family's saved availability gets flagged —
  // inline on the row and again at submit. Warn, never block (things change,
  // phone agreements happen), but never silent either: silence defeats the
  // point of collecting availability. Compared occurrence-by-occurrence on
  // the STUDENT's clock (PL-118/147 discipline). No availability on file →
  // no flags (unknown is not "unavailable").
  const outsideSlots = useMemo(() => {
    if (!tutor || availability.length === 0) return new Set<number>()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tutor.timezone })
    const from = startDate && startDate > today ? startDate : today
    const to = horizonEndIso(tutor.timezone)
    const out = new Set<number>()
    slots.forEach((slot, i) => {
      if (
        slotOutsideAvailability({
          slot,
          availability,
          familyTimezone: availabilityTz,
          tutorTimezone: tutor.timezone,
          fromIso: from,
          toIso: to,
        })
      ) {
        out.add(i)
      }
    })
    return out
  }, [tutor, availability, availabilityTz, slots, startDate])
  const availabilityQuote = useMemo(() => availabilitySummary(availability), [availability])

  // PL-153a: two weekly slots that overlap on the same weekday produce a
  // double-booked tutor AND a double-billed family — every generated
  // occurrence bills twice for one hour of teaching. The wizard names the
  // clash instead of creating it.
  const slotClashes = useMemo(() => {
    const clashes: string[] = []
    const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]
        const b = slots[j]
        if (a.weekday !== b.weekday) continue
        const aStart = mins(a.start_time)
        const bStart = mins(b.start_time)
        if (aStart < bStart + b.duration_minutes && bStart < aStart + a.duration_minutes) {
          const day = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][
            a.weekday - 1
          ]
          clashes.push(
            aStart === bStart && a.duration_minutes === b.duration_minutes
              ? `${day} at ${a.start_time} is listed twice`
              : `${day} ${a.start_time} and ${b.start_time} overlap`
          )
        }
      }
    }
    return [...new Set(clashes)]
  }, [slots])

  // PL-151: try/finally around the busy flag — a failed request used to
  // leave the Create button stuck mid-save with every field still filled in,
  // so the only way out was a reload (which lost the whole wizard state).
  async function submit(confirmOverdraw = false, confirmNoLocation = false) {
    setSaving(true)
    setMessage('')
    // PL-197: the overdraw warning is handled AFTER the finally so the busy
    // flag stays a pure try/finally (the PL-151 rule the gate audits).
    let overdrawPrompt: Record<string, unknown> | null = null
    // PL-211: same shape for the no-location acknowledgment.
    let locationPrompt: Record<string, unknown> | null = null
    try {
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
        require_approval: requireApproval,
        confirm_overdraw: confirmOverdraw || undefined,
        confirm_no_location: confirmNoLocation || undefined,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (json.needsOverdrawConfirm) {
      // PL-197 Case B: the schedule draws past the package — the moment of
      // the human conversation. Never blocked, never silent.
      overdrawPrompt = json
    } else if (json.needsLocationConfirm) {
      // PL-211: nothing anywhere says where the sessions happen.
      locationPrompt = json
    } else if (!res.ok) {
      setMessage('Error: ' + (json.error ?? `the server returned ${res.status}`))
    } else {
      setMessage(
        json.pendingParentConfirmation
          ? `Schedule created and sent to the family to confirm — ${json.sessionsCreated} session${json.sessionsCreated === 1 ? '' : 's'} held until they approve (nudges go out automatically; you can set it live from the Students list any time).`
          : `Student schedule created — ${json.sessionsCreated} session${json.sessionsCreated === 1 ? '' : 's'} scheduled` +
              ` and queued for the tutor's Google Calendar.`
      )
      setStudentId('')
      setSubjectId('')
      setTutorId('')
      setSlots([])
      setNotes('')
      // PL-171: a created schedule is a finished draft.
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      onCreated()
    }
    } catch {
      setMessage("Error: couldn't reach the server — nothing was saved. Your entries are still here; try again.")
    } finally {
      setSaving(false)
    }
    if (overdrawPrompt) {
      if (
        window.confirm(
          `This schedule goes ${overdrawPrompt.overBy}h past ${overdrawPrompt.studentFirst}'s ${overdrawPrompt.packageHours}h package ` +
            `(${overdrawPrompt.remaining}h left on it). The extra hours will bill at $${overdrawPrompt.rate}/hr on the monthly ` +
            `invoice — confirm with the family before scheduling them.\n\nSchedule anyway?`
        )
      ) {
        return submit(true, confirmNoLocation)
      }
      setMessage('Nothing scheduled — adjust the slots or talk to the family first.')
    }
    if (locationPrompt) {
      if (
        window.confirm(
          `No location set — this schedule has no location and ${locationPrompt.tutorName} has no default ` +
            `meeting link, so the tutor and family won't see where or how to meet (not in the portal, ` +
            `the calendar, or the printable schedule). It will sit in Needs Attention until one is set.\n\n` +
            `Schedule anyway?`
        )
      ) {
        return submit(confirmOverdraw, true)
      }
      setMessage('Nothing scheduled — add a location, or set a default meeting link on the tutor.')
    }
  }

  const ready =
    studentId && subjectId && tutorId && Number(rate) > 0 && (funding !== 'package' || addonId) && slotClashes.length === 0

  // PL-27: a gray Create button must say why. The classic trap: an empty
  // tutor subject list means no default rate ever lands, so everything looks
  // filled while rate is 0.
  const missing = [
    !studentId && 'pick a student',
    !subjectId && 'pick a subject',
    !tutorId && 'pick a tutor',
    !(Number(rate) > 0) && 'set an hourly rate (it defaults from the subject once one is picked)',
    funding === 'package' && !addonId && 'pick which purchased package this draws from',
    // PL-153a: say which slots clash, not just that something is wrong.
    ...slotClashes.map((c) => `fix the overlapping weekly slots — ${c}`),
  ].filter(Boolean) as string[]

  return (
    <div className="space-y-5 text-sm">
      {/* PL-171: resume offer — a half-built schedule survives phone calls
          and navigation; resuming is one click, discarding explicit. */}
      {draftOffer && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 flex flex-wrap items-center gap-3">
          <span className="text-hgl-slate">
            You have an unfinished schedule from{' '}
            <strong>
              {new Date(draftOffer.savedAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </strong>
            {(() => {
              const s = students.find((x) => x.id === draftOffer.studentId)
              return s ? ` (${s.first_name} ${s.last_name})` : ''
            })()}
            . Resume it?
          </span>
          <button onClick={resumeDraft} className="bg-hgl-slate text-white text-xs font-bold py-1.5 px-3 rounded hover:opacity-90">
            Resume draft
          </button>
          <button onClick={discardDraft} className="text-xs text-gray-500 underline">
            Discard
          </button>
        </div>
      )}

      {/* 1. Student — typeahead (PL-21: a plain dropdown won't scale) */}
      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">1 · Student</label>
        {studentId ? (
          <div className="flex items-center gap-2 border border-gray-300 rounded-md p-2 bg-gray-50">
            <span className="font-semibold text-hgl-slate">
              {(() => {
                const s = students.find((x) => x.id === studentId)
                return s ? `${s.first_name} ${s.last_name} — ${familyLabel(s.families)}` : 'Selected student'
              })()}
            </span>
            {conversionCredit != null && (
              <span
                className="text-xs bg-emerald-100 text-emerald-800 rounded-full px-2 py-0.5 font-semibold"
                title="Cancellation credit on the family's Stripe balance — tutoring invoices consume it automatically"
              >
                ${conversionCredit.toLocaleString()} cancellation credit
              </span>
            )}
            <button
              onClick={() => {
                setStudentId('')
                setStudentFilter('')
              }}
              className="ml-auto text-xs text-hgl-blue underline"
            >
              change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={studentFilter}
              onChange={(e) => setStudentFilter(e.target.value)}
              placeholder="Start typing a student or parent name…"
              className="w-full border border-gray-300 rounded-md p-2"
            />
            {studentFilter.trim() && (
              <ul className="border border-gray-200 rounded-md mt-1 divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {/* PL-110: prospective students surface FIRST — picking one
                    pulls the lead through (family+student created/linked,
                    intake availability rides along). */}
                {filteredLeads.slice(0, 4).map((l) => (
                  <li key={l.id}>
                    <button
                      disabled={pullingLeadId === l.id}
                      onClick={() => pullThroughLead(l)}
                      className="w-full text-left px-3 py-2 hover:bg-purple-50 disabled:opacity-50"
                    >
                      <span className="font-semibold text-hgl-slate">{l.student_name ?? l.contact_name ?? l.contact_email}</span>{' '}
                      <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5 font-semibold">prospective student</span>{' '}
                      <span className="text-gray-500 text-xs">{l.contact_name ?? ''} {l.contact_email ? `· ${l.contact_email}` : ''}</span>
                      {pullingLeadId === l.id && <span className="text-xs text-gray-400"> — pulling through…</span>}
                    </button>
                  </li>
                ))}
                {filteredStudents.slice(0, 8).map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setStudentId(s.id)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50"
                    >
                      <span className="font-semibold text-hgl-slate">
                        {s.first_name} {s.last_name}
                      </span>{' '}
                      <span className="text-gray-500">— {familyLabel(s.families)}</span>
                    </button>
                  </li>
                ))}
                {filteredStudents.length === 0 && filteredLeads.length === 0 && (
                  <li className="px-3 py-2 text-gray-400 italic">No students or prospective students match.</li>
                )}
                <li>
                  <button
                    onClick={addNewProspect}
                    className="w-full text-left px-3 py-2 text-hgl-blue hover:bg-blue-50 text-sm"
                  >
                    + Add a new family… <span className="text-gray-400">(creates a pipeline record first — matched, never duplicated)</span>
                  </button>
                </li>
              </ul>
            )}
          </>
        )}
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
            timezoneLabel="Student's timezone (the times above are in it)"
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

      {/* 2. Subject — PL-167: same live-autocomplete pattern as the timezone
          picker, so both feel identical and both invite typing. */}
      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">2 · Subject</label>
        <SearchCombobox
          value={subjectId}
          onChange={setSubjectId}
          placeholder="Type to search subjects — e.g. “SAT” or “Chemistry”…"
          options={subjects
            .filter((s) => s.active)
            .map((s) => ({
              value: s.id,
              label: `${s.name} — $${s.hourly_rate}/hr (${s.category === 'test_prep' ? 'test prep' : 'subject tutoring'})`,
            }))}
        />
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
              {classInstructorIds.has(t.id) ? ' — taught their class' : ''}
              {/* PL-25/PL-35a: say what the tier means and that neither blocks */}
              {subject && tutorTier(t) === 1
                ? ` — can do ${subject.name} with prep (check with them first)`
                : subject && tutorTier(t) === 0
                  ? ` — ${subject.name} isn't in their subject list (you can still assign)`
                  : ''}
            </option>
          ))}
        </select>
        {/* PL-35a: a needs-prep pick is allowed but never a silent commit */}
        {tutor && subject && tutorTier(tutor) === 1 && (
          <p className="text-xs text-amber-800 mt-1 bg-amber-50 border border-amber-300 rounded p-2">
            <span className="font-semibold">
              {tutor.name ?? 'This tutor'} can take {subject.name}, but confirm with them first
            </span>{' '}
            — give them a heads-up or send the material before the first session. Don&apos;t lock
            this in without their OK.
          </p>
        )}
        {tutor && tutorNotes[tutor.id] && (
          <p className="text-xs text-gray-500 mt-1 bg-amber-50 border border-amber-200 rounded p-2">
            <span className="font-semibold">Matching notes:</span> {tutorNotes[tutor.id]}
          </p>
        )}
        {/* PL-53d: continuity hint — a hint, never a rule */}
        {subject &&
          [...classInstructorIds].some((id) => {
            const t = tutors.find((x) => x.id === id && x.tutoring_active && x.active !== false)
            return t && (t.subjects.includes(subject.name) || t.subjects_with_prep.includes(subject.name))
          }) && (
            <p className="text-xs text-hgl-slate mt-1 bg-blue-50 border border-blue-200 rounded p-2">
              <span className="font-semibold">Continuity:</span>{' '}
              {[...classInstructorIds]
                .map((id) => tutors.find((x) => x.id === id && x.tutoring_active && x.active !== false))
                .filter((x): x is Tutor => !!x)
                .map((x) => x.name ?? x.email)
                .join(', ')}{' '}
              taught this student&apos;s class and tutors {subject.name} — picking them keeps the
              1-on-1 continuous with the class. Your call, as always.
            </p>
          )}
        {/* PL-53d: the class instructor's handoff — shown while matching */}
        {handoffNote && (
          <p className="text-xs text-gray-700 mt-1 bg-purple-50 border border-purple-200 rounded p-2">
            <span className="font-semibold">
              Handoff from {handoffNote.by ?? 'the class instructor'}:
            </span>{' '}
            {handoffNote.note}
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
          {/* PL-168: the fields are the plan, the slots are the truth — a
              live tally keeps them honest without caging anyone. New slots
              inherit the session length as their default. */}
          {slots.length > 0 && (
            <span
              className={`font-semibold ${slots.length === sessionsPerWeek ? 'text-green-700' : 'text-amber-700'}`}
            >
              {slots.length} of {sessionsPerWeek} weekly slot{sessionsPerWeek === 1 ? '' : 's'} added
            </span>
          )}
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
          <div key={i} className="mb-2">
            <div className="flex items-center gap-2">
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
            {/* PL-169: the inline flag quotes what the family actually said. */}
            {outsideSlots.has(i) && (
              <p className="text-xs text-amber-800 mt-0.5">
                ⚠ Outside the family&apos;s saved availability (they said: {availabilityQuote})
              </p>
            )}
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
          {/* PL-170: a package sets the economics — an editable rate next to
              a package selection implies a choice that doesn't exist. */}
          <input
            type="number"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            min={0}
            step={5}
            disabled={funding === 'package' && !!addonId}
            className="w-full border border-gray-300 rounded-md p-2 disabled:bg-gray-100 disabled:text-gray-400"
          />
          {funding === 'package' && !!addonId && (
            <p className="text-xs text-gray-500 mt-1">
              Covered by the package — the family already paid. This rate only matters if sessions
              ever run past the package hours (it defaults from the subject).
            </p>
          )}
        </div>
        <div>
          {/* PL-23: plain English, no build-phase numbers in UI copy */}
          <label className="block text-xs text-gray-600 font-semibold mb-1">Payment</label>
          <select
            value={funding}
            onChange={(e) => setFunding(e.target.value as 'monthly_billed' | 'package')}
            className="w-full border border-gray-300 rounded-md p-2 bg-white"
          >
            <option value="monthly_billed">Monthly billed (invoiced a month in advance)</option>
            <option value="package">Package hours (draws down a purchased package)</option>
          </select>
          {funding === 'package' && (
            <select
              value={addonId}
              onChange={(e) => setAddonId(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 bg-white mt-1"
            >
              <option value="">Pick the package…</option>
              {addons.map((a) => (
                // PL-170: billing draws a package down per schedule, so one
                // already fueling a live schedule can't safely fuel a second.
                <option key={a.id} value={a.id} disabled={!!a.attachedTo || a.remaining <= 0}>
                  {a.label}
                  {a.remaining <= 0 && !a.attachedTo ? ' — used up' : ''}
                </option>
              ))}
            </select>
          )}
          {funding === 'package' && addons.length === 0 && studentId && (
            <p className="text-xs text-amber-700 mt-1">
              This family has no purchased hour packages on file — families buy them with a class
              registration or from their portal, or switch to monthly billing.
            </p>
          )}
          {/* PL-170: invoicing while prepaid hours sit unused is the money
              mistake this flag exists to catch — proceed allowed, never silent. */}
          {funding === 'monthly_billed' && familyUnusedHours > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded p-2 mt-1">
              <span className="font-semibold">
                This family has {familyUnusedHours.toFixed(1)}h remaining on a paid package — invoice
                anyway?
              </span>{' '}
              Monthly billing here means new invoices while those prepaid hours sit unused. That can
              be right (a different student&apos;s package, or a separate rate agreement) — your
              call, but never by accident.
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Location</label>
          {/* PL-24: toggle sets the default; the field stays editable */}
          <div className="flex gap-4 text-xs text-gray-600 mb-1">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="locationMode"
                checked={locationMode === 'online'}
                onChange={() => setLocationMode('online')}
              />
              Online
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="locationMode"
                checked={locationMode === 'in_person'}
                onChange={() => setLocationMode('in_person')}
              />
              In person
            </label>
          </div>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={locationMode === 'online' ? 'Meeting link' : 'Address / room'}
            className="w-full border border-gray-300 rounded-md p-2"
          />
          {locationMode === 'online' && tutor && !tutor.default_meeting_link && !location && (
            <p className="text-xs text-gray-400 mt-1">
              {tutor.name ?? 'This tutor'} has no saved meeting link — paste one here (and add a
              default in the Tutors panel).
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-semibold mb-1">Start date (blank = now)</label>
          <div className="flex items-center">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2"
            />
            <DateHint value={startDate} />
          </div>
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

      {/* PL-41: propose → parent approves, unless Kelsie overrides */}
      <div className="border border-gray-200 rounded-md p-3">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-gray-700">
          <input
            type="checkbox"
            checked={requireApproval}
            onChange={(e) => setRequireApproval(e.target.checked)}
          />
          Send the parent this schedule to confirm
        </label>
        {/* PL-172: OFF must own its consequence — the family never gets an
            approve/decline step. */}
        <p className="text-xs text-gray-500 mt-1">
          <span className="font-semibold">On:</span>{' '}we&apos;ll email the family to confirm the
          times before anything&apos;s locked in.{' '}
          <span className="font-semibold">Off:</span>{' '}set it up now — the schedule is locked in
          immediately and the family receives it as a done deal (use this when you&apos;ve already
          agreed to the schedule by phone or email). They won&apos;t get an approve/decline step.
        </p>
      </div>

      {/* PL-168: submit-time mismatch informs, never blocks. */}
      {slots.length > 0 && slots.length !== sessionsPerWeek && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded p-2">
          You said {sessionsPerWeek} session{sessionsPerWeek === 1 ? '' : 's'}/week but added{' '}
          {slots.length} weekly slot{slots.length === 1 ? '' : 's'}
          {' — '}that&apos;s fine if intentional.
        </p>
      )}

      {/* PL-169: submit-time summary of the flagged slots — availability may
          be stale; proceeding is a human call, but never an accident. */}
      {outsideSlots.size > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded p-2">
          <span className="font-semibold">
            {outsideSlots.size === 1 ? 'One weekly slot sits' : `${outsideSlots.size} weekly slots sit`}{' '}
            outside the family&apos;s saved availability
          </span>{' '}
          (they said: {availabilityQuote}):
          <ul className="mt-1 ml-4 list-disc">
            {[...outsideSlots].map((i) => (
              <li key={i}>
                {WEEKDAYS[slots[i].weekday - 1]} {fmtHHMM(slots[i].start_time)} ·{' '}
                {slots[i].duration_minutes} min
              </li>
            ))}
          </ul>
          You can still create the schedule — availability goes stale and phone agreements happen —
          just make sure it&apos;s on purpose.
        </div>
      )}

      <button
        onClick={() => submit()}
        disabled={!ready || saving}
        className="bg-hgl-slate text-white py-2 px-6 rounded hover:opacity-90 disabled:opacity-50"
      >
        Create student schedule{slots.length > 0 ? ' + sessions' : ''}
      </button>
      {!ready && (
        <p className="text-xs text-gray-500 -mt-2">
          To enable Create: {missing.join(' · ')}.
        </p>
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
