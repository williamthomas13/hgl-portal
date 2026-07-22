'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../utils/supabase'
import { formatDateAdmin, formatTimestampAdmin, addDays, bySessionStart, effectiveStartDate } from '../utils/dates'
import SessionCalendar from '../components/SessionCalendar'
import CounselorsPanel from './counselors-panel'
import InstructorsPanel, { type Instructor } from './instructors-panel'
import CancelClassPanel from './cancel-class-panel'
import ClassWizard, { type ContactAtSchool, type WizardPrefill } from './class-wizard'
import CollateralCard, { type CollateralFields } from './collateral-card'
import SchoolBrandingPanel, { type SchoolBranding } from './school-branding-panel'
import QboPanel, { qboDocLink, type QboStatus } from './qbo-panel'
import GcalPanel from './tutoring/gcal-panel'
import ContactSettingsPanel from './contact-settings-panel'
import AttendancePanel from '../portal/attendance-panel'
import ScoresEntry from '../components/ScoresEntry'
import { summarizeAttendance, type AttendanceRecord } from '../utils/attendance'
import { CollapsibleSection, DateHint, TimeSelect, to24h } from './ui'

type Session = {
  id: string
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

type QboSyncEntry = {
  id: string
  kind: 'sale' | 'refund'
  status: 'pending' | 'synced' | 'failed'
  qbo_doc_id: string | null
  qbo_doc_number: string | null
  last_error: string | null
}

type Enrollment = {
  id: string
  enrolled_at: string
  payment_status: string
  waitlist_declined_at: string | null
  converted_to_tutoring_at: string | null
  tutoring_credit_amount: number | null
  class_cancelled: boolean
  cancellation_outcome: string | null
  enrollment_addons: { hours: number }[] | null
  qbo_sync_log: QboSyncEntry[] | null
  attendance_records: AttendanceRecord[] | null
  students: {
    id: string
    first_name: string
    last_name: string
    student_email: string | null
    pronouns: string | null
    families: {
      parent_email: string
      parent_first_name: string
      parent_last_name: string
    } | null
  } | null
}

type RoomRequest = {
  class_id: string
  status: string
  nudge_count: number
  answer: string | null
  answered_by: string | null
}

type ClassRow = {
  id: string
  slug: string | null
  status: string
  counselor_id: string | null
  registration_close_date: string | null
  class_type: string
  instructor_id: string | null
  price: number
  capacity: number
  start_date: string
  default_location: string | null
  synap_group: string | null
  school_id: string | null
  delivery_mode: string
  min_enrollment: number | null
  enrollment_deadline: string | null
  follow_on_class_id: string | null
  schools: { name: string; nickname: string; timezone: string } | null
  instructors: { name: string | null; email: string } | null
  enrollments: Enrollment[] | null
  sessions: Session[] | null
} & CollateralFields

const STATUS_STYLES: Record<string, string> = {
  Paid: 'bg-green-100 text-green-700',
  Completed: 'bg-indigo-100 text-indigo-700',
  Pending: 'bg-yellow-100 text-yellow-800',
  Waitlisted: 'bg-blue-100 text-blue-700',
  Expired: 'bg-gray-200 text-gray-500',
  Refunded: 'bg-red-100 text-red-600',
}

// Per-class add-session form (roster view). 24-hour / 5-minute time picker;
// pre-fills from the class's latest session — same times and location, date
// advanced a week — matching the wizard's session step.
function AddSessionForm({
  classId,
  defaultLocation,
  lastSession,
  onAdded,
}: {
  classId: string
  defaultLocation: string | null
  lastSession: Session | null
  onAdded: () => void
}) {
  const [date, setDate] = useState(lastSession ? addDays(lastSession.session_date, 7) : '')
  const [start, setStart] = useState(to24h(lastSession?.start_time))
  const [end, setEnd] = useState(to24h(lastSession?.end_time))
  const [location, setLocation] = useState(lastSession?.location ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleAdd() {
    if (!date) return
    // End must be after start (addendum §7.1) — 12:00–10:00 used to save.
    if (start && end && end <= start) {
      setError('End time must be after the start time.')
      return
    }
    setError('')
    setSaving(true)
    const { error } = await supabase.from('sessions').insert([
      {
        class_id: classId,
        session_date: date,
        start_time: start || null,
        end_time: end || null,
        location: location.trim() || defaultLocation || null,
      },
    ])
    setSaving(false)
    if (error) {
      alert('Error adding session: ' + error.message)
      return
    }
    setDate(addDays(date, 7)) // pre-fill the next one: same values, a week on
    onAdded()
  }

  return (
    <div className="grid grid-cols-4 gap-2 items-end text-sm">
      {error && (
        <p className="col-span-4 text-sm text-red-600 font-semibold">{error}</p>
      )}
      <div>
        <label className="block text-xs text-gray-600">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 w-full border rounded p-1"
        />
        <DateHint value={date} />
      </div>
      <div>
        <label className="block text-xs text-gray-600">Start (24h)</label>
        <div className="mt-1">
          <TimeSelect value={start} onChange={setStart} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-600">End (24h)</label>
        <div className="mt-1">
          <TimeSelect value={end} onChange={setEnd} />
        </div>
      </div>
      <div className="col-span-4 grid grid-cols-4 gap-2 items-end">
        <div className="col-span-3">
          <label className="block text-xs text-gray-600">Location (blank = default)</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={defaultLocation ?? ''}
            className="mt-1 w-full border rounded p-1"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !date}
          className="bg-hgl-slate text-white py-1 px-3 rounded hover:opacity-90 disabled:opacity-50"
        >
          Add session
        </button>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const [schools, setSchools] = useState<SchoolBranding[]>([])
  const [rosters, setRosters] = useState<ClassRow[]>([])
  const [fetchingRosters, setFetchingRosters] = useState(true)
  const [instructors, setInstructors] = useState<Instructor[]>([])
  const [roomRequests, setRoomRequests] = useState<Record<string, RoomRequest>>({})
  const [allCounselors, setAllCounselors] = useState<ContactAtSchool[]>([])
  const [rosterError, setRosterError] = useState('')
  // Live classes render as tabs; '' = first live class, '__past' = the rest.
  const [activeTab, setActiveTab] = useState('')
  // Phase 5 copy-a-previous-class: 'blank' renders an empty wizard; 'pick'
  // shows the source picker; a prefill snapshot renders a pre-filled wizard.
  // wizardKey remounts the wizard whenever the source (or blank reset) changes.
  const [wizardMode, setWizardMode] = useState<'blank' | 'pick'>('blank')
  // PL-53d: students with a live tutoring schedule (marker on rosters).
  const [tutoringStudentIds, setTutoringStudentIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    supabase
      .from('tutoring_engagements')
      .select('student_id')
      .in('status', ['pending_parent_confirmation', 'active', 'paused'])
      .then(({ data }) => setTutoringStudentIds(new Set((data ?? []).map((r) => r.student_id))))
  }, [])

  // PL-54c: unnotified interest per (school, class_type) — powers the
  // "N families are waiting — notify them?" prompt on open class cards.
  const [interestCounts, setInterestCounts] = useState<Record<string, number>>({})
  const loadInterest = useCallback(() => {
    supabase
      .from('class_interest')
      .select('school_id, class_type')
      .is('notified_at', null)
      .then(({ data }) => {
        const counts: Record<string, number> = {}
        for (const r of data ?? []) {
          const k = `${r.school_id}|${r.class_type}`
          counts[k] = (counts[k] ?? 0) + 1
        }
        setInterestCounts(counts)
      })
  }, [])
  useEffect(() => {
    loadInterest()
  }, [loadInterest])
  const [notifying, setNotifying] = useState('')
  async function notifyInterest(classId: string, count: number, shortLink: string | null) {
    // PL-54 amendment: the NW button targets the class's hgl.co marketing
    // page. A blank field means the button would deep-link the portal
    // registration page — warn so the Ops Director fills it in first or
    // knowingly accepts the direct link.
    const linkNote = (shortLink ?? '').trim()
      ? `The button points at ${shortLink!.trim()}.`
      : `⚠ No hgl.co link on this class — the button will point at the portal registration page. Add the short link on the collateral card first if families should see the sales page.`
    if (
      !window.confirm(
        `Email ${count} waiting famil${count === 1 ? 'y' : 'ies'} that this class is open? Each gets the "next class open" note.\n\n${linkNote}`
      )
    )
      return
    setNotifying(classId)
    try {
      const res = await fetch('/api/admin/notify-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId }),
      })
      const json = await res.json()
      if (!res.ok) alert('Problem: ' + (json.error ?? res.status))
      else alert(`Done — ${json.notified} notified.`)
    } finally {
      setNotifying('')
      loadInterest()
    }
  }

  const [wizardPrefill, setWizardPrefill] = useState<WizardPrefill | null>(null)
  const [wizardSourceLabel, setWizardSourceLabel] = useState('')
  const [wizardKey, setWizardKey] = useState('blank')
  const wizardKeySeq = useRef(0)
  const [copySearch, setCopySearch] = useState('')
  const [wizardOpenSignal, setWizardOpenSignal] = useState(0)

  const fetchSchools = useCallback(async () => {
    const { data } = await supabase.from('schools').select('*').order('nickname')
    if (data) setSchools(data)
  }, [])

  const fetchAllCounselors = useCallback(async () => {
    const { data } = await supabase
      .from('school_affiliations')
      .select('id, contact_id, school_id, contacts ( first_name, last_name, email )')
      .is('ended_at', null)
    if (data) {
      setAllCounselors(
        data
          .flatMap((row) => {
            const ct = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
            return ct
              ? [{
                  id: row.id as string, // affiliation id — what classes.counselor_id stores
                  contact_id: row.contact_id as string,
                  school_id: row.school_id as string,
                  ...ct,
                }]
              : []
          })
          .sort((a, b) => a.first_name.localeCompare(b.first_name))
      )
    }
  }, [])

  const fetchInstructors = useCallback(async () => {
    const { data } = await supabase
      .from('instructors')
      .select('id, email, name, default_meeting_link, comms_enabled')
      .order('email')
    if (data) setInstructors(data as Instructor[])
  }, [])

  // Feature B2: signed-in staff email stamps attendance_records.recorded_by.
  const [adminEmail, setAdminEmail] = useState('')
  const fetchAdminEmail = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    if (data.user?.email) setAdminEmail(data.user.email)
  }, [])

  // Phase 6: QBO connection summary — drives the QuickBooks panel and the
  // roster badges' deep links (sandbox vs production host).
  const [qboStatus, setQboStatus] = useState<QboStatus | null>(null)
  const fetchQboStatus = useCallback(async () => {
    const res = await fetch('/api/qbo/status')
    if (res.ok) setQboStatus(await res.json())
  }, [])

  // Classroom-request status per class (PHASE4_SPEC §4b/§10).
  const fetchRoomRequests = useCallback(async () => {
    const { data } = await supabase
      .from('classroom_requests')
      .select('class_id, status, nudge_count, answer, answered_by')
    if (data) {
      setRoomRequests(Object.fromEntries((data as RoomRequest[]).map((r) => [r.class_id, r])))
    }
  }, [])

  const fetchRosters = useCallback(async () => {
    setFetchingRosters(true)
    const { data, error } = await supabase
      .from('classes')
      .select(
        `
        *,
        schools ( name, nickname, timezone ),
        instructors ( name, email ),
        sessions ( id, session_date, start_time, end_time, location ),
        enrollments (
          id,
          enrolled_at,
          payment_status,
          waitlist_declined_at,
          converted_to_tutoring_at,
          tutoring_credit_amount,
          class_cancelled,
          cancellation_outcome,
          enrollment_addons ( hours ),
          qbo_sync_log ( id, kind, status, qbo_doc_id, qbo_doc_number, last_error ),
          attendance_records ( session_id, enrollment_id, present, arrived_late, left_early, minutes_late, minutes_left_early, note ),
          students (
            id,
            first_name,
            last_name,
            student_email,
            pronouns,
            families ( parent_email, parent_first_name, parent_last_name )
          )
        )
      `
      )
      .order('created_at', { ascending: false })

    // Never mask a failed read as an empty list — that's how "No classes
    // exist yet" hid a missing migration column from the admin.
    setRosterError(error ? `Roster query failed: ${error.message}` : '')
    if (data) setRosters(data as unknown as ClassRow[])
    setFetchingRosters(false)
  }, [])

  useEffect(() => {
    // Initial load — the awaited calls inside these helpers update state
    // on the next tick, not synchronously within this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSchools()
    fetchRosters()
    fetchInstructors()
    fetchRoomRequests()
    fetchAllCounselors()
    fetchQboStatus()
    fetchAdminEmail()
  }, [fetchSchools, fetchRosters, fetchInstructors, fetchRoomRequests, fetchAllCounselors, fetchQboStatus, fetchAdminEmail])

  // ---------------------------------------------------------------------------
  // Registration links (pasted into Squarespace "Register" buttons)
  // ---------------------------------------------------------------------------
  const [copiedClassId, setCopiedClassId] = useState<string | null>(null)

  function registrationUrl(c: ClassRow) {
    return `${window.location.origin}/register/${c.slug ?? c.id}`
  }

  async function handleCopyLink(c: ClassRow) {
    await navigator.clipboard.writeText(registrationUrl(c))
    setCopiedClassId(c.id)
    setTimeout(() => setCopiedClassId(null), 2000)
  }

  async function handleEditRegistrationClose(c: ClassRow) {
    const next = prompt(
      'Registration close date (YYYY-MM-DD). Blank = default (first session):',
      c.registration_close_date ?? ''
    )
    if (next == null) return
    const trimmed = next.trim()
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      alert('Use YYYY-MM-DD format, or leave blank for the default.')
      return
    }
    const { error } = await supabase
      .from('classes')
      .update({ registration_close_date: trimmed || null })
      .eq('id', c.id)
    if (error) {
      alert('Error updating close date: ' + error.message)
      return
    }
    fetchRosters()
  }

  // Feature C3: "Part 2" pointer — the parent dashboard's follow-on card
  // prefers this over the same-school heuristic.
  async function handleFollowOnChange(c: ClassRow, followOnId: string) {
    const { error } = await supabase
      .from('classes')
      .update({ follow_on_class_id: followOnId || null })
      .eq('id', c.id)
    if (error) {
      alert('Error setting follow-on class: ' + error.message)
      return
    }
    fetchRosters()
  }

  async function handleEditSlug(c: ClassRow) {
    const next = prompt(
      'Registration URL slug (lowercase letters, numbers, dashes):',
      c.slug ?? ''
    )
    if (next == null) return
    const cleaned = next
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!cleaned) {
      alert('Slug cannot be empty.')
      return
    }
    const { error } = await supabase.from('classes').update({ slug: cleaned }).eq('id', c.id)
    if (error) {
      alert(
        error.code === '23505'
          ? 'That slug is already used by another class.'
          : 'Error updating slug: ' + error.message
      )
      return
    }
    fetchRosters()
  }

  // Refunds are Option A (SPEC v2.5 §13): money moves in the Stripe dashboard
  // only — this just records the refund. The status change frees the capacity
  // spot (the hourly sweep extends a W2 waitlist offer if anyone is in line),
  // drops the enrollment out of paid counts and post-class emails #7/#8, and
  // stops any still-pending scheduled sends. stripe_payment_intent_id and
  // payment history stay on the row (audit trail for Phase 6 / QuickBooks).
  async function handleMarkRefunded(enrollmentId: string, studentName: string) {
    if (
      !confirm(
        `Mark ${studentName}'s enrollment as Refunded?\n\n` +
          'This records the refund and frees the spot (waitlist offers go out ' +
          'automatically). Issue the actual refund in the Stripe dashboard — ' +
          'the portal moves no money.'
      )
    )
      return
    const { error } = await supabase
      .from('enrollments')
      .update({ payment_status: 'Refunded' })
      .eq('id', enrollmentId)
      .in('payment_status', ['Paid', 'Completed']) // guard: only paid rows
    if (error) {
      alert('Error marking refunded: ' + error.message)
      return
    }
    fetchRosters()
  }

  // Bookkeeping after a cancellation: how each paid family resolved it
  // (refunded / converted / credited) — recorded from the billy@ reply
  // thread, no Stripe automation (PHASE4_SPEC §12).
  // PL-76: one click credits the paid amount as a Stripe customer balance
  // and sends the CX-T availability request — the on-ramp to the standard
  // tutoring pipeline. Idempotent server-side; a second click offers resend.
  async function handleConvertToTutoring(en: Enrollment, studentName: string) {
    const already = Boolean(en.converted_to_tutoring_at)
    const msg = already
      ? `${studentName} was already converted ($${Number(en.tutoring_credit_amount ?? 0).toLocaleString()} credit). Re-send the availability email?`
      : `Convert ${studentName} to 1-on-1 tutoring? The paid amount becomes a Stripe credit toward tutoring invoices, and the family gets the availability request email.`
    if (!confirm(msg)) return
    const res = await fetch('/api/admin/convert-to-tutoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentId: en.id, resend: already }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) alert(json.error ?? 'Conversion failed.')
    else if (json.already && !already) alert('Already converted — nothing re-credited.')
    fetchRosters()
  }

  // PL-69: the Ops Director sets pronouns when she learns them (on a call,
  // in a reply). Optional; unset keeps the neutral they/them email copy.
  async function handlePronouns(studentId: string, value: string) {
    const { error } = await supabase
      .from('students')
      .update({ pronouns: value || null })
      .eq('id', studentId)
    if (error) alert('Error saving pronouns: ' + error.message)
    else fetchRosters()
  }

  async function handleOutcome(enrollmentId: string, outcome: string) {
    const { error } = await supabase
      .from('enrollments')
      .update({ cancellation_outcome: outcome || null })
      .eq('id', enrollmentId)
    if (error) {
      alert('Error recording outcome: ' + error.message)
      return
    }
    fetchRosters()
  }

  // Phase 5: snapshot a source class into wizard prefill. Times + locations
  // copy; dates are cleared (times repeat across terms, dates never do).
  // Slug, deadline, close date, school contact, and all enrollment/email/
  // Stripe state are NEVER copied — the new class is a plain new class.
  function copyClass(c: ClassRow) {
    const sortedSessions = [...(c.sessions ?? [])].sort(bySessionStart)
    setWizardPrefill({
      schoolId: c.school_id ?? '',
      classType: c.class_type,
      deliveryMode: c.delivery_mode === 'online' ? 'online' : 'in_person',
      price: String(c.price),
      capacity: String(c.capacity),
      minEnrollment: String(c.min_enrollment ?? (c.delivery_mode === 'online' ? 3 : 8)),
      instructorId: c.instructor_id ?? '',
      synapGroup: c.synap_group ?? '',
      defaultLocation: c.default_location ?? '',
      sessions: sortedSessions.map((s) => ({
        session_date: '',
        start_time: to24h(s.start_time),
        end_time: to24h(s.end_time),
        location: s.location ?? '',
      })),
    })
    setWizardSourceLabel(`${c.schools?.nickname ?? '—'} ${c.class_type} (started ${formatDateAdmin(c.start_date)})`)
    wizardKeySeq.current += 1
    setWizardKey(`copy:${c.id}:${wizardKeySeq.current}`)
    setWizardMode('blank') // picker closes; the pre-filled wizard shows
  }

  // "Duplicate class" (class-card action): everything EXCEPT sessions/dates —
  // details plus ALL collateral fields, promo included. The usual
  // never-copied set (slug, deadlines, contact, enrollment state) holds.
  // This is the primary flow for repeat cohorts (SLS fall → SLS spring).
  function duplicateClass(c: ClassRow) {
    setWizardPrefill({
      schoolId: c.school_id ?? '',
      classType: c.class_type,
      deliveryMode: c.delivery_mode === 'online' ? 'online' : 'in_person',
      price: String(c.price),
      capacity: String(c.capacity),
      minEnrollment: String(c.min_enrollment ?? (c.delivery_mode === 'online' ? 3 : 8)),
      instructorId: c.instructor_id ?? '',
      synapGroup: c.synap_group ?? '',
      defaultLocation: c.default_location ?? '',
      sessions: [],
      collateral: {
        short_link: c.short_link ?? null,
        collateral_language: c.collateral_language ?? null,
        flyer_blurb: c.flyer_blurb ?? null,
        letter_blurb: c.letter_blurb ?? null,
        letter_blurb_es: c.letter_blurb_es ?? null,
        practice_test_count: c.practice_test_count ?? null,
        promo_code: c.promo_code ?? null,
        promo_amount: c.promo_amount ?? null,
        promo_deadline: c.promo_deadline ?? null,
      },
    })
    setWizardSourceLabel(
      `${c.schools?.nickname ?? '—'} ${c.class_type} (started ${formatDateAdmin(c.start_date)}) — sessions not copied`
    )
    wizardKeySeq.current += 1
    setWizardKey(`dup:${c.id}:${wizardKeySeq.current}`)
    setWizardMode('blank')
    setWizardOpenSignal((n) => n + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetWizardToBlank() {
    setWizardPrefill(null)
    setWizardSourceLabel('')
    wizardKeySeq.current += 1
    setWizardKey(`blank:${wizardKeySeq.current}`)
    setWizardMode('blank')
  }

  async function handleDeleteSession(sessionId: string) {
    if (!confirm('Remove this session?')) return
    const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
    if (error) {
      alert('Error removing session: ' + error.message)
      return
    }
    fetchRosters()
  }

  // ---------------------------------------------------------------------------
  // Live vs past: live = not cancelled and not finished (last session — or
  // start date when session-less — is today or later). Live classes are tabs;
  // everything else lives under "Past & cancelled".
  // ---------------------------------------------------------------------------
  const today = new Date().toLocaleDateString('en-CA')
  const withEnd = rosters.map((c) => {
    const dates = (c.sessions ?? []).map((s) => s.session_date)
    const lastDay = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : c.start_date
    return { ...c, lastDay }
  })
  const liveClasses = withEnd.filter((c) => c.status !== 'cancelled' && c.lastDay >= today)
  const pastClasses = withEnd.filter((c) => c.status === 'cancelled' || c.lastDay < today)
  const selectedTab =
    activeTab === '__past' || liveClasses.some((c) => c.id === activeTab)
      ? activeTab
      : (liveClasses[0]?.id ?? '__past')

  // Phase 6 §8: per-enrollment QBO badge — worst status wins (failed >
  // pending > synced); ✓ deep-links to the Sales Receipt. Enrollments with no
  // sync rows (pre-Phase-6 history) show nothing.
  function qboBadge(en: Enrollment) {
    const rows = en.qbo_sync_log ?? []
    if (rows.length === 0) return null
    const failed = rows.find((r) => r.status === 'failed')
    if (failed) {
      return (
        <span
          title={failed.last_error ?? 'QuickBooks sync failed — see the QuickBooks panel'}
          className="ml-2 inline-block px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-600"
        >
          QBO ✗
        </span>
      )
    }
    if (rows.some((r) => r.status === 'pending')) {
      return (
        <span
          title="Waiting to sync to QuickBooks"
          className="ml-2 inline-block px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-800"
        >
          QBO ⏳
        </span>
      )
    }
    const sale = rows.find((r) => r.kind === 'sale' && r.qbo_doc_id)
    const link = sale ? qboDocLink(qboStatus, 'sale', sale.qbo_doc_id) : null
    const badge = (
      <span className="ml-2 inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">
        QBO ✓
      </span>
    )
    return link ? (
      <a href={link} target="_blank" rel="noopener" title="Open the Sales Receipt in QuickBooks">
        {badge}
      </a>
    ) : (
      badge
    )
  }

  // Feature B2: roster attendance summary — "3/4 · 84%" per student.
  function attendanceSummary(c: ClassRow, en: Enrollment) {
    if (!['Paid', 'Completed'].includes(en.payment_status)) return <span className="text-gray-300">—</span>
    const summary = summarizeAttendance(c.sessions ?? [], en.attendance_records ?? [], en.id)
    if (summary.pastSessions === 0) return <span className="text-gray-300">—</span>
    if (summary.recordedSessions === 0)
      return <span className="text-gray-400 italic text-xs">not taken</span>
    return (
      <span className="text-sm">
        {summary.sessionsAttended}/{summary.recordedSessions}
        {summary.percent != null && (
          <span className={`ml-1 text-xs font-semibold ${summary.percent >= 80 ? 'text-green-700' : 'text-amber-700'}`}>
            {summary.percent}%
          </span>
        )}
      </span>
    )
  }

  function classCard(c: ClassRow) {
    // PL-4: the capacity gate is the PAID count (matching the instructor
    // view); pending is shown separately instead of silently inflating it.
    const paidCount =
      c.enrollments?.filter((en) => ['Paid', 'Completed'].includes(en.payment_status)).length ?? 0
    const pendingCount =
      c.enrollments?.filter((en) => en.payment_status === 'Pending').length ?? 0
    const enrolledCount = paidCount + pendingCount
    const waitlistCount =
      c.enrollments?.filter((en) => en.payment_status === 'Waitlisted').length ?? 0
    const schoolLabel = c.schools?.nickname ?? '—'
    const sortedSessions = [...(c.sessions ?? [])].sort(bySessionStart)
    const lastSession = sortedSessions[sortedSessions.length - 1] ?? null
    const isCancelled = c.status === 'cancelled'
    return (
      <div key={c.id} className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-6">
          <div>
            <h3 className="text-lg font-bold text-hgl-slate">
              {schoolLabel} — {c.class_type}
              {isCancelled && (
                <span className="ml-2 align-middle inline-block px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded uppercase tracking-wide">
                  Cancelled
                </span>
              )}
            </h3>
            <p className="text-sm text-gray-600">
              Instructor:{' '}
              {c.instructors ? (
                <>
                  {c.instructors.name ?? c.instructors.email}
                  {c.instructors.name ? ` (${c.instructors.email})` : ''}
                </>
              ) : (
                <span className="italic text-amber-700">Not yet assigned</span>
              )}{' '}
              · Starts: {formatDateAdmin(effectiveStartDate(c.start_date, sortedSessions))}
            </p>
            {sortedSessions.length > 0 && sortedSessions[0].session_date !== c.start_date && (
              <p className="text-xs mt-0.5">
                <span className="inline-block px-2 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">
                  ⚠ stored start date ({formatDateAdmin(c.start_date)}) doesn&apos;t match the first
                  session — parents see the session date; fix the class record when you can
                </span>
              </p>
            )}
            {/* PL-54c: the system remembers, the Ops Director picks the moment */}
            {!isCancelled &&
              c.status === 'open' &&
              (interestCounts[`${c.school_id}|${c.class_type}`] ?? 0) > 0 && (
                <p className="text-sm mt-1">
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-blue-50 border border-blue-200 text-hgl-slate">
                    <span className="font-semibold">
                      {interestCounts[`${c.school_id}|${c.class_type}`]} famil
                      {interestCounts[`${c.school_id}|${c.class_type}`] === 1 ? 'y is' : 'ies are'}{' '}
                      waiting to hear about this class
                    </span>
                    <button
                      onClick={() => notifyInterest(c.id, interestCounts[`${c.school_id}|${c.class_type}`] ?? 0, c.short_link)}
                      disabled={notifying === c.id}
                      className="text-hgl-blue underline font-semibold disabled:opacity-50"
                    >
                      {notifying === c.id ? 'notifying…' : 'notify them?'}
                    </button>
                  </span>
                </p>
              )}
            <p className="text-sm text-gray-600">
              Timezone: {c.schools?.timezone ?? '—'}{' '}
              <span className="text-xs text-gray-400">(from the school record)</span>
            </p>
            {c.default_location && (
              <p className="text-sm text-gray-600">Location: {c.default_location}</p>
            )}
            {c.counselor_id && (() => {
              const contact = allCounselors.find((x) => x.id === c.counselor_id)
              return contact ? (
                <p className="text-sm text-gray-600">
                  School contact: {contact.first_name} {contact.last_name} ({contact.email})
                </p>
              ) : null
            })()}
            {c.delivery_mode === 'in_person' && (() => {
              const rr = roomRequests[c.id]
              if (!rr && c.default_location) return null
              const badge = !rr
                ? { text: 'room not set — counselor gets asked 14 days out', cls: 'bg-gray-100 text-gray-500' }
                : rr.status === 'pending'
                  ? { text: `room requested from counselor${rr.nudge_count > 0 ? ` · ${rr.nudge_count} nudge${rr.nudge_count > 1 ? 's' : ''}` : ''}`, cls: 'bg-yellow-100 text-yellow-800' }
                  : rr.status === 'answered'
                    ? { text: `room set by ${rr.answered_by ?? 'counselor'}: ${rr.answer}`, cls: 'bg-green-100 text-green-700' }
                    : { text: 'room request cancelled (set directly)', cls: 'bg-gray-100 text-gray-500' }
              return (
                <p className="text-xs mt-1">
                  <span className={`inline-block px-2 py-0.5 rounded font-semibold ${badge.cls}`}>
                    {badge.text}
                  </span>
                </p>
              )
            })()}
            {c.synap_group && (
              <p className="text-sm text-gray-600">Synap group: {c.synap_group}</p>
            )}
            <p className="text-sm text-gray-600 mt-2 flex items-center gap-2 flex-wrap">
              <span className="font-semibold">Registration link:</span>
              <code className="bg-gray-100 rounded px-2 py-0.5 text-xs">
                {registrationUrl(c)}
              </code>
              <button
                onClick={() => handleCopyLink(c)}
                className="bg-hgl-blue text-white text-xs font-bold px-3 py-1 rounded hover:bg-hgl-blue-hover transition"
              >
                {copiedClassId === c.id ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={() => handleEditSlug(c)}
                className="text-xs text-gray-500 underline hover:text-hgl-blue"
              >
                edit slug
              </button>
            </p>
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <span className="font-semibold">Registration closes:</span>
              {c.registration_close_date
                ? formatDateAdmin(c.registration_close_date)
                : 'first session (default)'}
              <button
                onClick={() => handleEditRegistrationClose(c)}
                className="text-xs text-gray-500 underline hover:text-hgl-blue"
              >
                edit
              </button>
            </p>
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <span className="font-semibold" title="Parents of this class's students see the follow-on as a 'you might be interested in' card in their portal">
                Follow-on class:
              </span>
              <select
                value={c.follow_on_class_id ?? ''}
                onChange={(e) => handleFollowOnChange(c, e.target.value)}
                className="border border-gray-300 rounded p-0.5 text-xs bg-white max-w-64"
              >
                <option value="">none</option>
                {rosters
                  .filter((other) => other.id !== c.id && other.status !== 'cancelled')
                  .map((other) => (
                    <option key={other.id} value={other.id}>
                      {(other.schools?.nickname ?? '—') + ' ' + other.class_type} (starts{' '}
                      {formatDateAdmin(other.start_date)})
                    </option>
                  ))}
              </select>
            </p>
            {!isCancelled && (
              <div className="mt-2">
                <CancelClassPanel
                  classId={c.id}
                  classLabel={`${schoolLabel} ${c.class_type}`}
                  classPrice={Number(c.price)}
                  paid={(c.enrollments ?? [])
                    .filter((en) => en.payment_status === 'Paid')
                    .map((en) => ({
                      enrollmentId: en.id,
                      studentName: `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim(),
                      parentName: `${en.students?.families?.parent_first_name ?? ''} ${en.students?.families?.parent_last_name ?? ''}`.trim(),
                      addonHours: (en.enrollment_addons ?? []).reduce(
                        (sum, a) => sum + Number(a.hours),
                        0
                      ),
                    }))}
                  pendingCount={(c.enrollments ?? []).filter((en) => en.payment_status === 'Pending').length}
                  waitlistedCount={waitlistCount}
                  hasSchoolContact={allCounselors.some((x) => x.school_id === c.school_id)}
                  onDone={fetchRosters}
                />
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="inline-block px-3 py-1 bg-[#00AEEE]/10 text-hgl-blue text-sm font-bold rounded-full whitespace-nowrap">
              {paidCount} paid{pendingCount > 0 ? ` + ${pendingCount} pending` : ''} / {c.capacity}
            </span>
            <button
              onClick={() => duplicateClass(c)}
              title="Start a new class from this one — copies details and collateral fields, never sessions or dates"
              className="text-xs text-hgl-blue underline hover:text-hgl-slate whitespace-nowrap"
            >
              Duplicate class
            </button>
            {waitlistCount > 0 && (
              <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full whitespace-nowrap">
                {waitlistCount} waitlisted
              </span>
            )}
            {c.min_enrollment != null && (
              <span className="text-xs text-gray-500 whitespace-nowrap">
                min {c.min_enrollment} · {c.delivery_mode === 'online' ? 'online' : 'in person'}
              </span>
            )}
          </div>
        </div>

        {/* COLLATERAL — with the class setup fields, not the roster: flyer +
            parent letter downloads and the fields that drive them */}
        <CollateralCard
          classId={c.id}
          classType={c.class_type}
          inPerson={c.delivery_mode !== 'online'}
          sessionDates={sortedSessions.map((s) => s.session_date)}
          fields={c}
          school={schools.find((s) => s.id === c.school_id) ?? null}
          onSaved={fetchRosters}
        />

        {/* SESSIONS — same visual calendar as the public registration page */}
        <div className="p-6 border-b border-gray-200">
          <h4 className="font-semibold text-hgl-slate mb-1">Sessions</h4>
          <p className="text-xs text-gray-500 mb-3">
            All times in <span className="font-semibold">{c.schools?.timezone ?? '—'}</span>{' '}
            (from the school record, read-only)
          </p>
          {sortedSessions.length === 0 ? (
            <p className="text-sm text-gray-500 italic mb-3">No sessions scheduled yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-6 mb-3 items-start">
              <SessionCalendar
                sessions={sortedSessions}
                defaultLocation={c.default_location}
                hour24
              />
              <ul className="space-y-2">
                {sortedSessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2"
                  >
                    <span>
                      <strong>{formatDateAdmin(s.session_date)}</strong>
                      {s.start_time && ` · ${to24h(s.start_time)}`}
                      {s.end_time && ` – ${to24h(s.end_time)}`}
                      {s.location && ` · ${s.location}`}
                    </span>
                    <button
                      onClick={() => handleDeleteSession(s.id)}
                      className="text-red-600 text-xs hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AddSessionForm
            key={`${c.id}:${sortedSessions.length}`}
            classId={c.id}
            defaultLocation={c.default_location}
            lastSession={lastSession}
            onAdded={fetchRosters}
          />

          {/* Feature B2: admin can view/edit all attendance (same panel the
              instructor uses; staff RLS covers the writes). */}
          <AttendancePanel
            sessions={sortedSessions}
            roster={(c.enrollments ?? [])
              .filter((en) => ['Paid', 'Completed'].includes(en.payment_status))
              .map((en) => ({
                enrollmentId: en.id,
                studentName: `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim() || '—',
              }))
              .sort((a, b) => a.studentName.localeCompare(b.studentName))}
            recordedBy={adminEmail}
          />

          {/* PL-37: milestone score entry alongside attendance. */}
          <ScoresEntry
            classId={c.id}
            students={(c.enrollments ?? [])
              .filter((en) => en.students?.id)
              .map((en) => ({
                id: en.students!.id,
                name: `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim() || '—',
              }))
              .sort((a, b) => a.name.localeCompare(b.name))}
          />
        </div>

        {/* ROSTER — read-only source of truth about signups */}
        <div className="p-0 overflow-x-auto">
          {enrolledCount === 0 ? (
            <p className="text-sm text-gray-500 p-6 text-center italic">
              No students registered yet.
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                    Student
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                    Student email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                    Billing contact
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                    Parent email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                    Attendance
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                    Registered
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {c.enrollments?.map((en) => (
                  <tr key={en.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {en.students?.first_name} {en.students?.last_name}
                      {en.students?.id && (
                        <select
                          value={en.students.pronouns ?? ''}
                          onChange={(e) => handlePronouns(en.students!.id, e.target.value)}
                          title={`${en.students.first_name}'s pronouns — used in family emails; blank keeps the neutral wording`}
                          className="ml-2 border border-gray-200 rounded text-[11px] text-gray-500 bg-white px-1 py-0.5 align-middle"
                        >
                          <option value="">pronouns…</option>
                          <option value="she_her">she/her</option>
                          <option value="he_him">he/him</option>
                          <option value="they_them">they/them</option>
                          {/* PL-80: name-based wording, never a wrong pronoun */}
                          <option value="name_only">Something else / rather not say</option>
                        </select>
                      )}
                      {/* PL-53d: continuing to 1-on-1 (add-on bought, or a
                          tutoring schedule already exists) */}
                      {((en.enrollment_addons ?? []).length > 0 ||
                        (en.students?.id && tutoringStudentIds.has(en.students.id))) && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold align-middle">
                          continues to 1-on-1
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {en.students?.student_email ?? (
                        <span className="italic text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {en.students?.families?.parent_first_name}{' '}
                      {en.students?.families?.parent_last_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-hgl-blue">
                      {en.students?.families?.parent_email}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                          STATUS_STYLES[en.payment_status] ?? 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {/* PL-72: an early decline reads as its own thing, not
                            "expired unclaimed" */}
                        {en.payment_status === 'Expired' && en.waitlist_declined_at
                          ? 'Declined offer'
                          : en.payment_status}
                      </span>
                      {qboBadge(en)}
                      {(en.payment_status === 'Paid' ||
                        en.payment_status === 'Completed') && (
                        <button
                          onClick={() =>
                            handleMarkRefunded(
                              en.id,
                              `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim()
                            )
                          }
                          title="Records the refund and frees the spot — issue the actual refund in the Stripe dashboard"
                          className="ml-2 text-xs text-red-600 underline hover:text-red-800"
                        >
                          mark refunded
                        </button>
                      )}
                      {en.class_cancelled &&
                        ['Paid', 'Completed'].includes(en.payment_status) && (
                          <button
                            onClick={() =>
                              handleConvertToTutoring(
                                en,
                                `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim()
                              )
                            }
                            title={
                              en.converted_to_tutoring_at
                                ? `Converted ${new Date(en.converted_to_tutoring_at).toLocaleDateString()} — $${Number(en.tutoring_credit_amount ?? 0).toLocaleString()} credit on the family's Stripe balance. Click to re-send the availability email.`
                                : 'Credit the paid amount toward tutoring and send the availability request'
                            }
                            className={`ml-2 text-xs underline ${en.converted_to_tutoring_at ? 'text-emerald-700' : 'text-hgl-blue hover:text-hgl-slate'}`}
                          >
                            {en.converted_to_tutoring_at
                              ? `✓ tutoring credit $${Number(en.tutoring_credit_amount ?? 0).toLocaleString()}`
                              : 'convert to 1-on-1 tutoring'}
                          </button>
                        )}
                      {en.class_cancelled &&
                        (en.payment_status === 'Paid' ||
                          en.payment_status === 'Completed' ||
                          en.payment_status === 'Refunded') && (
                          <select
                            value={en.cancellation_outcome ?? ''}
                            onChange={(e) => handleOutcome(en.id, e.target.value)}
                            title="How this family resolved the cancellation (bookkeeping — from the billy@ reply thread)"
                            className="ml-2 border border-gray-300 rounded p-0.5 text-xs bg-white"
                          >
                            <option value="">outcome…</option>
                            <option value="refunded">refunded</option>
                            <option value="converted">converted to tutoring</option>
                            <option value="credited">credited to next course</option>
                          </select>
                        )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{attendanceSummary(c, en)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {formatTimestampAdmin(en.enrolled_at)}
                      <a
                        href={`/admin/communications?enrollment=${en.id}`}
                        title="Every email for this enrollment — sent, scheduled, cancelled"
                        className="block text-xs text-hgl-blue underline hover:text-hgl-slate"
                      >
                        comms
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-bold text-hgl-slate">HGL Admin</h1>
          <div className="flex items-center gap-4">
            <a
              href="/admin/tutoring"
              className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate"
            >
              Tutoring
            </a>
            <a
              href="/admin/leads"
              className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate"
            >
              Prospective students
            </a>
            <a
              href="/admin/communications"
              className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate"
            >
              Communications
            </a>
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              window.location.assign('/login')
            }}
            className="text-sm text-gray-500 hover:text-hgl-slate underline"
          >
            Sign out
          </button>
          </div>
        </div>

        <CollapsibleSection
          title="Add a new class"
          accent="border-hgl-slate"
          openSignal={wizardOpenSignal}
        >
          {/* Two paths (Phase 5): start blank, or copy a previous class. */}
          <div className="flex items-center gap-2 mb-5 text-sm">
            <button
              onClick={resetWizardToBlank}
              className={`px-4 py-1.5 rounded-full font-semibold border transition ${
                wizardMode === 'blank' && !wizardPrefill
                  ? 'bg-hgl-slate text-white border-hgl-slate'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-hgl-slate'
              }`}
            >
              Start blank
            </button>
            <button
              onClick={() => setWizardMode('pick')}
              className={`px-4 py-1.5 rounded-full font-semibold border transition ${
                wizardMode === 'pick' || wizardPrefill
                  ? 'bg-hgl-slate text-white border-hgl-slate'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-hgl-slate'
              }`}
            >
              Copy a previous class
            </button>
          </div>

          {wizardMode === 'pick' ? (
            <div>
              <input
                type="text"
                value={copySearch}
                onChange={(e) => setCopySearch(e.target.value)}
                placeholder="Filter by school or class type — e.g. SLS or SAT"
                className="block w-full border border-gray-300 rounded-md p-2 mb-3"
              />
              <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-h-80 overflow-y-auto">
                {rosters
                  .filter((c) => {
                    const q = copySearch.trim().toLowerCase()
                    if (!q) return true
                    return (
                      (c.schools?.nickname ?? '').toLowerCase().includes(q) ||
                      (c.schools?.name ?? '').toLowerCase().includes(q) ||
                      c.class_type.toLowerCase().includes(q)
                    )
                  })
                  .slice(0, 30)
                  .map((c) => (
                    <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span>
                        <strong className="text-hgl-slate">
                          {c.schools?.nickname ?? '—'} {c.class_type}
                        </strong>
                        <span className="text-gray-500">
                          {' '}· started {formatDateAdmin(c.start_date)} · {c.sessions?.length ?? 0} sessions
                          {c.status === 'cancelled' ? ' · cancelled' : ''}
                        </span>
                      </span>
                      <button
                        onClick={() => copyClass(c)}
                        className="bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-hgl-blue-hover transition"
                      >
                        Copy
                      </button>
                    </li>
                  ))}
              </ul>
              <p className="text-xs text-gray-500 mt-2">
                Most recent first, top 30 shown — type to narrow. Copying takes a snapshot:
                details and session times carry over, dates start blank, and the source class
                is never affected.
              </p>
            </div>
          ) : (
            <>
              {wizardPrefill && (
                <p className="mb-4 text-sm bg-blue-50 text-hgl-slate border border-blue-200 rounded p-3">
                  Pre-filled from <strong>{wizardSourceLabel}</strong> — everything below is
                  editable, and the source class is unaffected.{' '}
                  <button onClick={resetWizardToBlank} className="underline text-hgl-blue">
                    Start blank instead
                  </button>
                </p>
              )}
              <ClassWizard
                key={wizardKey}
                schools={schools}
                contacts={allCounselors}
                instructors={instructors}
                initial={wizardPrefill ?? undefined}
                onSchoolsChange={fetchSchools}
                onContactsChange={fetchAllCounselors}
                onInstructorsChange={fetchInstructors}
                onCreated={() => {
                  fetchRosters()
                  fetchRoomRequests()
                  // the wizard resets its own fields; drop the copy banner
                  // without remounting so the success message stays visible
                  setWizardPrefill(null)
                  setWizardSourceLabel('')
                }}
              />
            </>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Live class rosters" accent="border-hgl-blue" defaultOpen>
          {rosterError && (
            <div className="mb-4 p-3 rounded bg-red-100 text-red-700 font-semibold text-sm">
              {rosterError} — the classes below may be stale or missing. If this mentions a
              missing column, a migration in supabase/migrations has not been applied.
            </div>
          )}
          {fetchingRosters ? (
            <p className="text-gray-500 animate-pulse">Loading rosters from database...</p>
          ) : rosters.length === 0 ? (
            <p className="text-gray-500">No classes exist yet.</p>
          ) : (
            <div>
              <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-6">
                {liveClasses.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveTab(c.id)}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-md border border-b-0 transition ${
                      selectedTab === c.id
                        ? 'bg-white border-gray-200 text-hgl-blue -mb-px'
                        : 'bg-gray-50 border-transparent text-gray-500 hover:text-hgl-slate'
                    }`}
                  >
                    {(c.schools?.nickname ?? '—') + ' ' + c.class_type}
                  </button>
                ))}
                <button
                  onClick={() => setActiveTab('__past')}
                  className={`px-4 py-2 text-sm font-semibold rounded-t-md border border-b-0 transition ${
                    selectedTab === '__past'
                      ? 'bg-white border-gray-200 text-hgl-blue -mb-px'
                      : 'bg-gray-50 border-transparent text-gray-500 hover:text-hgl-slate'
                  }`}
                >
                  Past &amp; cancelled ({pastClasses.length})
                </button>
              </div>
              {selectedTab === '__past' ? (
                pastClasses.length === 0 ? (
                  <p className="text-gray-500 text-sm">No past or cancelled classes.</p>
                ) : (
                  <div className="space-y-8">{pastClasses.map((c) => classCard(c))}</div>
                )
              ) : (
                (() => {
                  const c = liveClasses.find((x) => x.id === selectedTab)
                  return c ? classCard(c) : <p className="text-gray-500 text-sm">No live classes.</p>
                })()
              )}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="School contacts"
          subtitle="The person + their school affiliation — portal access and digests follow active affiliations"
        >
          <CounselorsPanel schools={schools} onChange={fetchAllCounselors} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Instructors"
          subtitle="Default meeting links auto-fill online classes; instructors sign in with their email"
        >
          <InstructorsPanel instructors={instructors} onChange={fetchInstructors} />
        </CollapsibleSection>

        {/* Out-of-flow branding edits — setup happens in the new-school wizard branch. */}
        <CollapsibleSection
          title="School branding &amp; collateral defaults"
          subtitle="Logo, accent color, and default language for the generated flyer + parent letter"
        >
          <SchoolBrandingPanel schools={schools} onChange={fetchSchools} />
        </CollapsibleSection>

        {/* Phase 6: accounting integration — connection + mapping are
            admin-only; the sync log and retries are staff-wide. */}
        <CollapsibleSection
          title="QuickBooks"
          subtitle="Stripe payments post to QuickBooks automatically — connection, item mapping, and the sync log"
        >
          <QboPanel status={qboStatus} onStatusChange={fetchQboStatus} />
        </CollapsibleSection>

        {/* PL-33: owner-level config, grouped with QuickBooks here rather
            than cluttering the tutoring page the Ops Director works in daily. */}
        <CollapsibleSection
          title="Google Calendar"
          subtitle="Service-account connection and push queue for tutoring sessions"
        >
          <GcalPanel />
        </CollapsibleSection>

        {/* PL-50: renders only for admins (the API 403s managers). */}
        <ContactSettingsPanel />
      </div>
    </div>
  )
}
