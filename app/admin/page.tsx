'use client'

import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
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
import TeamAccessPanel from './team-access-panel'
import DashboardPanel from './dashboard-panel'
import AttendancePanel from '../portal/attendance-panel'
import { ConfirmAction } from './tutoring/confirm'
import ScoresEntry from '../components/ScoresEntry'
import ClassScoresGrid from '../components/ClassScoresGrid'
import ContactsDirectory from './contacts-directory'
import { SidebarNav } from './sidebar'
import CallsPanel from './calls-panel'
import { summarizeAttendance, type AttendanceRecord } from '../utils/attendance'
import { CollapsibleSection, DateHint, TimeSelect, to24h, useDeepLinkFocus } from './ui'
import { FamilyCommsRow } from './family-comms'
import { ChaseStatus } from './school-comms'

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
  waitlist_offer_sent_at: string | null
  waitlist_offer_expires_at: string | null
  waitlist_offer_round: number | null
  converted_to_tutoring_at: string | null
  converted_by: string | null
  tutoring_credit_amount: number | null
  cancellation_offer_hours: number | null
  amount_paid: number | null
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
  /** PL-237: skip-for-now stamp — the Needs Attention reminder shows while
   *  set AND short_link is still empty. */
  collateral_reminder_at: string | null
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
      // PL-268: inline error, no native alert().
      setError('Error adding session: ' + error.message)
      return
    }
    setDate(addDays(date, 7)) // pre-fill the next one: same values, a week on
    onAdded()
  }

  return (
    // PL-251: items-start, not items-end — bottom-aligning let the DateHint
    // under the date input push that input a line above Start/End.
    <div className="grid grid-cols-4 gap-2 items-start text-sm">
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

// PL-250: one small inline editor for the roster header's free-text class
// fields (Synap group, location) — view with an edit link, flipping to an
// input + save/cancel. No window.prompt (it loses context and can't cancel
// cleanly on mobile).
function InlineEditableText({
  label,
  value,
  emptyText,
  title,
  onSave,
}: {
  label: string
  value: string | null
  emptyText: string
  title?: string
  onSave: (next: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  if (!editing) {
    return (
      <p className="text-sm text-gray-600 flex items-center gap-2 flex-wrap" title={title}>
        <span className="font-semibold">{label}:</span>
        {value ? (
          <span className="break-all">{value}</span>
        ) : (
          <span className="italic text-gray-400">{emptyText}</span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? '')
            setEditing(true)
          }}
          className="text-xs text-gray-500 underline hover:text-hgl-blue"
        >
          edit
        </button>
      </p>
    )
  }
  return (
    <p className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
      <span className="font-semibold">{label}:</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="border border-gray-300 rounded p-1 text-xs w-72 max-w-full"
        autoFocus
      />
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true)
          try {
            await onSave(draft.trim() || null)
            setEditing(false)
          } finally {
            setSaving(false)
          }
        }}
        className="text-xs bg-hgl-slate text-white rounded px-2 py-0.5 disabled:opacity-50"
      >
        {saving ? 'saving…' : 'save'}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 underline">
        cancel
      </button>
    </p>
  )
}

// PL-190: the old flat sidebar (PL-101) refiled under Scarlett's topline
// tabs (Jul 28 IA). Section ids are unchanged — they match the visibility
// wrappers below, so every pre-restructure deep link keeps landing where it
// always did. School contacts deliberately has TWO homes (Classes and
// Contacts). Communications and Agreements are their own pages, filed under
// Contacts as links.
type NavEntry = { id: string; label: string; href?: string }
const NAV_GROUPS: Record<string, { default: string; entries: NavEntry[] }> = {
  dashboard: {
    default: 'dashboard',
    entries: [{ id: 'dashboard', label: 'Dashboard' }],
  },
  classes: {
    default: 'rosters',
    entries: [
      { id: 'rosters', label: 'Live class rosters' },
      { id: 'add-class', label: 'Add a new class' },
      { id: 'contacts', label: 'Schools' },
      { id: 'branding', label: 'Branding & collateral' },
    ],
  },
  contacts: {
    // PL-192: Students is the tab's landing view (QBO habit — student-first).
    default: 'students',
    entries: [
      { id: 'students', label: 'Students' },
      { id: 'parents', label: 'Parents' },
      { id: 'instructors', label: 'Instructors' },
      { id: 'contacts', label: 'Schools' },
      { id: 'communications', label: 'Communications', href: '/admin/communications' },
      // PL-201: offers live beside the comms machinery they ride on.
      { id: 'campaigns', label: 'Campaigns', href: '/admin/campaigns' },
      { id: 'agreements', label: 'Agreements', href: '/admin/agreements' },
    ],
  },
  settings: {
    default: 'qbo',
    entries: [
      { id: 'qbo', label: 'QuickBooks' },
      { id: 'gcal', label: 'Google Calendar' },
      { id: 'settings', label: 'Contact settings' },
      // PL-213: who can open the admin side (admin-only; hidden for managers).
      { id: 'team', label: 'Team access' },
      // PL-202: the Quo calls integration (setup + enable switch).
      { id: 'calls', label: 'Phone calls' },
      // PL-198: View-as files here (Scarlett's Jul 29 filing).
      { id: 'view-as', label: 'View as…', href: '/admin/view-as' },
    ],
  },
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
  // PL-89/92 standing rule: alert deep-links land on the exact record —
  // ?class={id} selects that class's roster tab; ?qbo={rowId} opens the
  // QuickBooks section and highlights the failed sync row.
  const [qboOpenSignal, setQboOpenSignal] = useState(0)
  const [deepFocus, setDeepFocus] = useState<string | null>(null)
  // PL-101: vertical section tabs — one section visible at a time, all of
  // them always MOUNTED (hidden, not unmounted) so deep-link focus polling
  // and data loads behave exactly as before (the PL-99 late-mount lesson).
  const [activeSection, setActiveSection] = useState<string>('dashboard')
  // PL-237: which class the Branding & collateral tab's collateral card shows.
  const [collateralClassId, setCollateralClassId] = useState('')
  // PL-190: which topline tab's sub-nav is showing. Changes only via the
  // topline (a real navigation with ?tab=) or a deep-link param.
  const [activeGroup, setActiveGroup] = useState<string>('dashboard')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    // PL-190: topline tabs land on the group's most useful default.
    const tab = q.get('tab')
    if (tab && NAV_GROUPS[tab]) {
      setActiveGroup(tab)
      // PL-229: ?section= lands on a specific filed page (the standalone
      // pages' sidebars link back here with it); default otherwise.
      const section = q.get('section')
      setActiveSection(
        section && NAV_GROUPS[tab].entries.some((e) => e.id === section && !e.href)
          ? section
          : NAV_GROUPS[tab].default
      )
    }
    const classId = q.get('class')
    if (classId) {
      setActiveTab(classId)
      setActiveGroup('classes')
      setActiveSection('rosters')
    }
    // PL-242: names are doors — ?school={id} lands on that school's card
    // (the panel scrolls to and highlights it).
    const schoolCard = q.get('school')
    if (schoolCard) {
      setActiveGroup('classes')
      setActiveSection('contacts')
    }
    // PL-237: the skip-for-now reminder deep-links ?collateral={classId} —
    // land on the Branding & collateral section with that class picked.
    const collateralClass = q.get('collateral')
    if (collateralClass) {
      setActiveGroup('classes')
      setActiveSection('branding')
      setCollateralClassId(collateralClass)
    }
    const qboRow = q.get('qbo')
    if (qboRow) {
      setQboOpenSignal((n) => n + 1)
      setDeepFocus(`qbo-${qboRow}`)
    }
    // PL-94: the rollover alert lands with the family's row in view.
    const enrollmentRow = q.get('enrollment')
    if (enrollmentRow) {
      setDeepFocus(`enrollment-${enrollmentRow}`)
      setActiveGroup('classes')
      setActiveSection('rosters')
    }
  }, [])
  // Signals that used to just expand a section now also select its tab.
  useEffect(() => {
    if (qboOpenSignal > 0) {
      setActiveGroup('settings')
      setActiveSection('qbo')
    }
  }, [qboOpenSignal])
  useDeepLinkFocus(deepFocus)
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
  // PL-268: outcomes surface in ONE inline banner (bottom-right toast) —
  // native alert()/confirm() freeze the browser automation bridge and are
  // banned by the standing rule. Confirms are per-button ConfirmAction.
  const [actionNotice, setActionNotice] = useState('')
  // PL-268: the waitlist over-cap override asks INLINE (it used to be a
  // nested native confirm) — state carries the 409 payload until answered.
  const [overCapAsk, setOverCapAsk] = useState<{
    en: Enrollment
    studentName: string
    action: 'add_back' | 're_offer'
    position?: number
    taken: number
    capacity: number
  } | null>(null)
  // PL-54 amendment: the NW button targets the class's hgl.co marketing
  // page. A blank field means the button would deep-link the portal
  // registration page — warn so the Ops Director fills it in first or
  // knowingly accepts the direct link. PL-268: the warning lives in the
  // button's inline ConfirmAction message, not a native confirm().
  function notifyInterestMsg(count: number, shortLink: string | null): string {
    const linkNote = (shortLink ?? '').trim()
      ? `The button points at ${shortLink!.trim()}.`
      : `⚠ No hgl.co link on this class — the button will point at the portal registration page. Add the short link on the collateral card first if families should see the sales page.`
    return `Email ${count} waiting famil${count === 1 ? 'y' : 'ies'} that this class is open? Each gets the "next class open" note. ${linkNote}`
  }
  async function notifyInterest(classId: string) {
    setNotifying(classId)
    try {
      const res = await fetch('/api/admin/notify-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setActionNotice('Problem: ' + (json.error ?? res.status))
      else setActionNotice(`Done — ${json.notified} notified.`)
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
  useEffect(() => {
    if (wizardOpenSignal > 0) setActiveSection('add-class')
  }, [wizardOpenSignal])

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
      .select('id, email, name, phone, default_meeting_link, comms_enabled, active')
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
    if (res.ok) setQboStatus(await res.json().catch(() => ({})))
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
          waitlist_offer_sent_at,
          waitlist_offer_expires_at,
          waitlist_offer_round,
          converted_to_tutoring_at,
          converted_by,
          tutoring_credit_amount,
          cancellation_offer_hours,
          amount_paid,
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
      setActionNotice('Use YYYY-MM-DD format, or leave blank for the default.')
      return
    }
    const { error } = await supabase
      .from('classes')
      .update({ registration_close_date: trimmed || null })
      .eq('id', c.id)
    if (error) {
      setActionNotice('Error updating close date: ' + error.message)
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
      setActionNotice('Error setting follow-on class: ' + error.message)
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
      setActionNotice('Slug cannot be empty.')
      return
    }
    const { error } = await supabase.from('classes').update({ slug: cleaned }).eq('id', c.id)
    if (error) {
      setActionNotice(
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
  // PL-268: the confirm lives on the button (ConfirmAction); this just acts.
  async function handleMarkRefunded(enrollmentId: string) {
    const { error } = await supabase
      .from('enrollments')
      .update({ payment_status: 'Refunded' })
      .eq('id', enrollmentId)
      .in('payment_status', ['Paid', 'Completed']) // guard: only paid rows
    if (error) {
      setActionNotice('Error marking refunded: ' + error.message)
      return
    }
    fetchRosters()
  }

  // Bookkeeping after a cancellation: how each paid family resolved it
  // (refunded / converted / credited) — recorded from the billy@ reply
  // thread, no Stripe automation (PHASE4_SPEC §12).
  // PL-76: one click converts and sends the CX-T availability request — the
  // on-ramp to the standard tutoring pipeline. PL-84: when the cancellation
  // carried an HOURS offer (the normal case), conversion mints an hours
  // package via the add-on machinery — the promised hours are the record,
  // not a dollar balance that can run dry early. Dollar Stripe credit only
  // when no hours were offered. Idempotent; a second click offers resend.
  // PL-268: the consequence copy renders in the button's inline ConfirmAction.
  function convertToTutoringMsg(en: Enrollment, studentName: string): string {
    const already = Boolean(en.converted_to_tutoring_at)
    const offered = Number(en.cancellation_offer_hours ?? 0)
    const who =
      en.converted_by === 'family'
        ? `self-serve, ${en.converted_to_tutoring_at ? new Date(en.converted_to_tutoring_at).toLocaleDateString() : ''}`
        : `by ${en.converted_by ?? 'the Ops Director'}`
    return already
      ? offered > 0
        ? `${studentName} was already converted (${offered}-hour tutoring package — ${who}). Re-send the availability email?`
        : `${studentName} was already converted ($${Number(en.tutoring_credit_amount ?? 0).toLocaleString()} credit — ${who}). Re-send the availability email?`
      : offered > 0
        ? `Convert ${studentName} to 1-on-1 tutoring? The family gets the ${offered} hours offered at cancellation as a tutoring package (paid $${Number(en.amount_paid ?? 0).toLocaleString()}), plus the availability request email.`
        : `Convert ${studentName} to 1-on-1 tutoring? No hours offer is on the cancellation record, so the paid amount becomes a Stripe credit toward tutoring invoices, and the family gets the availability request email.`
  }
  async function handleConvertToTutoring(en: Enrollment) {
    const already = Boolean(en.converted_to_tutoring_at)
    const res = await fetch('/api/admin/convert-to-tutoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentId: en.id, resend: already }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setActionNotice(json.error ?? 'Conversion failed.')
    else if (json.already && !already) setActionNotice('Already converted — nothing re-credited.')
    fetchRosters()
  }

  // PL-250: assign/change the instructor from the roster — we often don't
  // know who's teaching until well after creation, and the wizard was the
  // only surface that could set it. Goes through the assign-instructor API
  // (shared with the calendar's PL-249 button) so the International Classes
  // calendar resyncs on the fast path.
  // PL-268: a select can't wear ConfirmAction, so the change parks in
  // pendingAssign and an inline banner right under the row asks — the select
  // itself snaps back to the saved value until confirmed.
  const [pendingAssign, setPendingAssign] = useState<{
    classId: string
    instructorId: string
    msg: string
  } | null>(null)
  function requestAssignInstructor(c: ClassRow, instructorId: string) {
    if ((c.instructor_id ?? '') === instructorId) return
    const label = `${c.schools?.nickname ?? '—'} ${c.class_type}`
    const inst = instructors.find((i) => i.id === instructorId)
    const msg = instructorId
      ? `Assign ${inst?.name ?? inst?.email} as the instructor for ${label}?`
      : `Clear the instructor for ${label}? It goes back to "not yet assigned".`
    setPendingAssign({ classId: c.id, instructorId, msg })
  }
  async function confirmAssignInstructor() {
    if (!pendingAssign) return
    const res = await fetch('/api/admin/assign-instructor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: pendingAssign.classId, instructorId: pendingAssign.instructorId || null }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setActionNotice(json.error ?? 'Assignment failed — try again.')
    setPendingAssign(null)
    fetchRosters()
  }

  // PL-250: Synap group and location become editable where they're read.
  async function handleClassField(c: ClassRow, field: 'synap_group' | 'default_location', value: string | null) {
    const { error } = await supabase
      .from('classes')
      .update({ [field]: value })
      .eq('id', c.id)
    if (error) setActionNotice('Error saving: ' + error.message)
    else fetchRosters()
  }

  // PL-69: the Ops Director sets pronouns when she learns them (on a call,
  // in a reply). Optional; unset keeps the neutral they/them email copy.
  async function handlePronouns(studentId: string, value: string) {
    const { error } = await supabase
      .from('students')
      .update({ pronouns: value || null })
      .eq('id', studentId)
    if (error) setActionNotice('Error saving pronouns: ' + error.message)
    else fetchRosters()
  }

  // PL-94: waitlist rescue — the hour-49 phone call. Both actions are
  // admin-authed one-clicks; the rollover alert only deep-links here.
  // PL-268: the re-offer confirm is the button's ConfirmAction; the over-cap
  // override asks in the inline banner (it used to be a NESTED native
  // confirm). The add-back position prompt stays for now (it needs a number,
  // not a yes/no — flagged as follow-up debt, it doesn't freeze automation
  // the way confirm() chains did).
  async function handleWaitlistRescue(
    en: Enrollment,
    studentName: string,
    action: 'add_back' | 're_offer',
    opts: { position?: number; confirmOverCap?: boolean } = {}
  ) {
    let position = opts.position
    if (action === 'add_back' && position === undefined) {
      const raw = prompt(
        `Add ${studentName} back to the waitlist at which position?\n\n#1 = next in line (a live 48h offer already out to another family is never revoked — they'd be next after it resolves).`,
        '1'
      )
      if (raw == null) return
      position = Math.max(1, Number(raw) || 1)
    }
    const res = await fetch('/api/admin/waitlist-rescue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, enrollmentId: en.id, position, confirmOverCap: opts.confirmOverCap ?? false }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.status === 409 && json.needsOverCapConfirm) {
      // The explicit, logged over-cap confirm — informed override, never
      // silent. Renders in the banner; confirming re-sends with the flag.
      setOverCapAsk({ en, studentName, action, position, taken: json.taken, capacity: json.capacity })
      return
    }
    if (!res.ok) setActionNotice(json.error ?? 'Rescue failed.')
    else if (action === 'add_back') setActionNotice(`${studentName} is back on the waitlist at #${json.position} — confirmation email sent.`)
    else setActionNotice(`Fresh 48-hour offer sent to ${studentName}${json.overCap ? ' (over-cap override logged)' : ''}.`)
    fetchRosters()
  }

  async function handleOutcome(enrollmentId: string, outcome: string) {
    const { error } = await supabase
      .from('enrollments')
      .update({ cancellation_outcome: outcome || null })
      .eq('id', enrollmentId)
    if (error) {
      setActionNotice('Error recording outcome: ' + error.message)
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

  // PL-277: per-session Edit — saved through /api/admin/class-session, which
  // updates the row AND sends the SU schedule-update emails to every family
  // that already received class details (event-driven; the sweep's snapshot
  // diff doesn't see per-session changes).
  const [editingSession, setEditingSession] = useState<{
    id: string
    classId: string
    date: string
    start: string
    end: string
    location: string
  } | null>(null)
  const [sessionSaving, setSessionSaving] = useState(false)
  async function handleEditSession(classId: string) {
    if (!editingSession || editingSession.classId !== classId) return
    if (editingSession.start && editingSession.end && editingSession.end <= editingSession.start) {
      setActionNotice('End time must be after the start time.')
      return
    }
    setSessionSaving(true)
    try {
      const res = await fetch('/api/admin/class-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          id: editingSession.id,
          session_date: editingSession.date,
          start_time: editingSession.start || null,
          end_time: editingSession.end || null,
          location: editingSession.location.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setActionNotice(json.error ?? 'Saving the session failed — try again.')
      else {
        setActionNotice(
          json.changed
            ? `Session saved — ${json.emailed} schedule-update email${json.emailed === 1 ? '' : 's'} sent.`
            : 'Nothing changed — no emails sent.'
        )
        setEditingSession(null)
        fetchRosters()
      }
    } finally {
      setSessionSaving(false)
    }
  }

  // PL-268: the confirm is the button's ConfirmAction.
  async function handleDeleteSession(sessionId: string) {
    const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
    if (error) {
      setActionNotice('Error removing session: ' + error.message)
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
            <p className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
              <span className="font-semibold">Instructor:</span>
              {/* PL-250: assignable right here — the wizard used to be the
                  only surface that could set it. */}
              <select
                value={c.instructor_id ?? ''}
                onChange={(e) => requestAssignInstructor(c, e.target.value)}
                disabled={isCancelled}
                className={`border border-gray-300 rounded p-0.5 text-xs bg-white max-w-64 ${
                  c.instructor_id ? '' : 'italic text-amber-700'
                }`}
              >
                <option value="">not yet assigned</option>
                {instructors
                  .filter((i) => i.active || i.id === c.instructor_id)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name ? `${i.name} (${i.email})` : i.email}
                    </option>
                  ))}
              </select>
              {/* PL-268: the change parks here until confirmed — the select
                  above snaps back to the saved value meanwhile. */}
              {pendingAssign?.classId === c.id && (
                <span className="inline-flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded px-2 py-1 text-xs max-w-md whitespace-normal">
                  <span className="text-amber-900">{pendingAssign.msg}</span>
                  <button onClick={confirmAssignInstructor} className="text-green-700 font-semibold underline">
                    Yes, do it
                  </button>
                  <button onClick={() => setPendingAssign(null)} className="text-gray-500 underline">
                    cancel
                  </button>
                </span>
              )}
              {/* PL-161: the fit suggester — advisory, overlaid on the calendar */}
              <a
                href={`/admin/calendar?suggest=${c.id}`}
                className="text-xs text-purple-700 underline"
                title="Rank every active instructor against this class's session times — Google busy, portal commitments, and travel windows, shown on the calendar"
              >
                who&apos;s free to teach it?
              </a>
              <span>· Starts: {formatDateAdmin(effectiveStartDate(c.start_date, sortedSessions))}</span>
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
    {notifying === c.id ? (
                      <span className="text-hgl-blue font-semibold">notifying…</span>
                    ) : (
                      <ConfirmAction
                        label="notify them?"
                        message={notifyInterestMsg(interestCounts[`${c.school_id}|${c.class_type}`] ?? 0, c.short_link)}
                        confirmLabel="Yes, email them"
                        className="text-hgl-blue underline font-semibold"
                        confirmClassName="text-hgl-blue font-semibold underline"
                        onConfirm={() => notifyInterest(c.id)}
                      />
                    )}
                  </span>
                </p>
              )}
            <p className="text-sm text-gray-600">
              Timezone: {c.schools?.timezone ?? '—'}{' '}
              <span className="text-xs text-gray-400">(from the school record)</span>
            </p>
            {/* PL-250: visible and editable even when unset — counselors
                often skip the form and just reply by email with the room. */}
            <InlineEditableText
              label="Location"
              value={c.default_location}
              emptyText="not set"
              title="The class's default location — sessions without their own location fall back to this"
              onSave={(v) => handleClassField(c, 'default_location', v)}
            />
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
                  {/* PL-93: the CR chase line with open state — "nudged Aug 27
                      (not yet opened)" is the difference between sending CR3
                      and picking up the phone. */}
                  {rr?.status === 'pending' && <ChaseStatus classId={c.id} />}
                </p>
              )
            })()}
            <InlineEditableText
              label="Synap group"
              value={c.synap_group}
              emptyText="not set"
              onSave={(v) => handleClassField(c, 'synap_group', v)}
            />
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

        {/* ROSTER — PL-106: the FIRST thing on the card is who's registered
            (and paid state); sessions and setup come after. */}
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
                  <Fragment key={en.id}>
                  <tr id={`enrollment-${en.id}`} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {/* PL-193: the click lands on the student profile. */}
                      {en.students?.id ? (
                        <a href={`/admin/students/${en.students.id}`} className="hover:underline text-hgl-slate" title="Open the student profile">
                          {en.students.first_name} {en.students.last_name}
                        </a>
                      ) : (
                        <>{en.students?.first_name} {en.students?.last_name}</>
                      )}
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
                      {/* PL-94: waitlist rescue on expired/declined/rolled rows
                          (and stale offers) — the hour-49 phone call. */}
                      {((en.payment_status === 'Expired' &&
                        (en.waitlist_declined_at || en.waitlist_offer_sent_at)) ||
                        (en.payment_status === 'Waitlisted' &&
                          en.waitlist_offer_expires_at &&
                          new Date(en.waitlist_offer_expires_at).getTime() <= Date.now())) && (
                        <>
                          <span className="ml-2">
                            <ConfirmAction
                              label="re-offer the spot"
                              message={`Re-offer the spot to ${`${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim()} now? They get a fresh 48-hour claim window. (Over-cap asks separately, and is logged.)`}
                              confirmLabel="Yes, re-offer"
                              className="text-xs text-hgl-blue underline hover:text-hgl-slate"
                              confirmClassName="text-xs text-hgl-blue font-semibold underline"
                              onConfirm={() =>
                                handleWaitlistRescue(
                                  en,
                                  `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim(),
                                  're_offer'
                                )
                              }
                            />
                          </span>
                          <button
                            onClick={() =>
                              handleWaitlistRescue(
                                en,
                                `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim(),
                                'add_back'
                              )
                            }
                            title="Reinsert on the waitlist at a chosen position (live offers are never revoked); the family gets a fresh position confirmation"
                            className="ml-2 text-xs text-hgl-blue underline hover:text-hgl-slate"
                          >
                            add back at #…
                          </button>
                        </>
                      )}
                      {qboBadge(en)}
                      {(en.payment_status === 'Paid' ||
                        en.payment_status === 'Completed') && (
                        <span className="ml-2" title="Records the refund and frees the spot — issue the actual refund in the Stripe dashboard">
                          <ConfirmAction
                            label="mark refunded"
                            message={`Mark ${`${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim()}'s enrollment as Refunded? This records the refund and frees the spot (waitlist offers go out automatically). Issue the actual refund in the Stripe dashboard — the portal moves no money.`}
                            confirmLabel="Yes, mark refunded"
                            className="text-xs text-red-600 underline hover:text-red-800"
                            confirmClassName="text-xs text-red-700 font-semibold underline"
                            onConfirm={() => handleMarkRefunded(en.id)}
                          />
                        </span>
                      )}
                      {en.class_cancelled &&
                        ['Paid', 'Completed'].includes(en.payment_status) && (
                          <span
                            className="ml-2"
                            title={
                              en.converted_to_tutoring_at
                                ? Number(en.cancellation_offer_hours ?? 0) > 0
                                  ? `Converted ${new Date(en.converted_to_tutoring_at).toLocaleDateString()} — ${en.cancellation_offer_hours}-hour tutoring package (paid $${Number(en.amount_paid ?? 0).toLocaleString()}). Click to re-send the availability email.`
                                  : `Converted ${new Date(en.converted_to_tutoring_at).toLocaleDateString()} — $${Number(en.tutoring_credit_amount ?? 0).toLocaleString()} credit on the family's Stripe balance. Click to re-send the availability email.`
                                : Number(en.cancellation_offer_hours ?? 0) > 0
                                  ? `Convert the ${en.cancellation_offer_hours} hours offered at cancellation into a tutoring package and send the availability request`
                                  : 'No hours offer on record — credit the paid amount toward tutoring and send the availability request'
                            }
                          >
                            <ConfirmAction
                              label={
                                en.converted_to_tutoring_at
                                  ? Number(en.cancellation_offer_hours ?? 0) > 0
                                    ? `✓ ${en.cancellation_offer_hours}h tutoring package${en.converted_by === 'family' ? ' (self-serve)' : ''}`
                                    : `✓ tutoring credit $${Number(en.tutoring_credit_amount ?? 0).toLocaleString()}${en.converted_by === 'family' ? ' (self-serve)' : ''}`
                                  : 'convert to 1-on-1 tutoring'
                              }
                              message={convertToTutoringMsg(en, `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim())}
                              confirmLabel={en.converted_to_tutoring_at ? 'Yes, re-send it' : 'Yes, convert'}
                              className={`text-xs underline ${en.converted_to_tutoring_at ? 'text-emerald-700' : 'text-hgl-blue hover:text-hgl-slate'}`}
                              confirmClassName="text-xs text-hgl-blue font-semibold underline"
                              onConfirm={() => handleConvertToTutoring(en)}
                            />
                          </span>
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
                  {/* PL-83: the family's full comms history — every email the
                      family received or will receive across ALL classes and
                      tutoring, badged automatic / by hand / test. */}
                  {en.students?.id && <FamilyCommsRow studentId={en.students.id} colSpan={7} />}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* PL-237: the collateral panel moved OUT of the roster view — its
            homes are the wizard's Branding & Collateral step and Classes →
            Branding & collateral (class picker there). */}

        {/* SESSIONS — same visual calendar as the public registration page */}
        <div className="p-6 border-b border-gray-200">
          <h4 className="font-semibold text-hgl-slate mb-1">Sessions</h4>
          <p className="text-xs text-gray-500 mb-3">
            All times in <span className="font-semibold">{c.schools?.timezone ?? '—'}</span>{' '}
            (from the school record, read-only)
          </p>
          {/* PL-277: ONE list — the card list — with Edit + Remove inside
              each card (the second, remove-only list is gone). */}
          {sortedSessions.length === 0 ? (
            <p className="text-sm text-gray-500 italic mb-3">No sessions scheduled yet.</p>
          ) : (
            <div className="mb-3 max-w-2xl">
              <SessionCalendar
                sessions={sortedSessions}
                defaultLocation={c.default_location}
                hour24
                renderActions={(s) => (
                  <span className="flex gap-2 text-xs items-center">
                    <button
                      onClick={() =>
                        setEditingSession({
                          id: s.id!,
                          classId: c.id,
                          date: s.session_date,
                          start: to24h(s.start_time),
                          end: to24h(s.end_time),
                          location: s.location ?? '',
                        })
                      }
                      className="text-hgl-blue underline"
                    >
                      Edit
                    </button>
                    <ConfirmAction
                      label="Remove"
                      message="Remove this session?"
                      confirmLabel="Yes, remove"
                      className="text-red-600 hover:underline"
                      confirmClassName="text-xs text-red-700 font-semibold underline"
                      onConfirm={() => handleDeleteSession(s.id!)}
                    />
                  </span>
                )}
              />
              {editingSession?.classId === c.id && (
                <div className="mt-2 border border-hgl-blue/40 bg-blue-50/40 rounded-md p-3">
                  <p className="text-xs font-semibold text-hgl-slate mb-2">
                    Editing the {formatDateAdmin(
                      sortedSessions.find((s) => s.id === editingSession.id)?.session_date ?? editingSession.date
                    )}{' '}
                    session
                  </p>
                  <div className="grid grid-cols-4 gap-2 items-start text-sm">
                    <div>
                      <label className="block text-xs text-gray-600">Date</label>
                      <input
                        type="date"
                        value={editingSession.date}
                        onChange={(e) => setEditingSession({ ...editingSession, date: e.target.value })}
                        className="mt-1 w-full border rounded p-1"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Start (24h)</label>
                      <div className="mt-1">
                        <TimeSelect
                          value={editingSession.start}
                          onChange={(v) => setEditingSession({ ...editingSession, start: v })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">End (24h)</label>
                      <div className="mt-1">
                        <TimeSelect
                          value={editingSession.end}
                          onChange={(v) => setEditingSession({ ...editingSession, end: v })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Location (blank = default)</label>
                      <input
                        type="text"
                        value={editingSession.location}
                        onChange={(e) => setEditingSession({ ...editingSession, location: e.target.value })}
                        className="mt-1 w-full border rounded p-1"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <ConfirmAction
                      label={sessionSaving ? 'saving…' : 'Save changes'}
                      message="Save this session change? Every registered family that already received the class-details email gets the schedule-update email automatically (the instructor gets their FYI too). Families who haven't received details yet see the new schedule when their details email sends."
                      confirmLabel="Yes, save & email"
                      className="bg-hgl-slate text-white rounded px-3 py-1 font-semibold"
                      confirmClassName="text-green-700 font-semibold underline"
                      disabled={sessionSaving}
                      onConfirm={() => handleEditSession(c.id)}
                    />
                    <button onClick={() => setEditingSession(null)} className="text-gray-500 underline">
                      cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <AddSessionForm
            key={`${c.id}:${sortedSessions.length}`}
            classId={c.id}
            defaultLocation={c.default_location}
            lastSession={lastSession}
            onAdded={fetchRosters}
          />

          {/* PL-106: instructors take attendance in their portal; here it's a
              live read-only reflection with an explicit admin override
              (staff RLS still covers the override writes). */}
          <AttendancePanel
            adminReadOnly
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
            defaultExam={c.class_type.includes('ACT') ? 'ACT' : 'SAT'}
            students={(c.enrollments ?? [])
              .filter((en) => en.students?.id)
              .map((en) => ({
                id: en.students!.id,
                name: `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim() || '—',
              }))
              .sort((a, b) => a.name.localeCompare(b.name))}
          />
          {/* PL-181: the group read — both diagnostics side by side, column
              entry in one sitting. Same store; a score entered anywhere
              shows everywhere instantly. */}
          <ClassScoresGrid
            classId={c.id}
            defaultExam={c.class_type.includes('ACT') ? 'ACT' : 'SAT'}
            students={(c.enrollments ?? [])
              .filter((en) => en.students?.id)
              .map((en) => ({
                id: en.students!.id,
                name: `${en.students?.first_name ?? ''} ${en.students?.last_name ?? ''}`.trim() || '—',
              }))
              .sort((a, b) => a.name.localeCompare(b.name))}
          />
        </div>

      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 p-10">
      {/* PL-268: the one inline outcome banner — every action result that
          used to be a native alert() lands here, dismissible, never modal. */}
      {actionNotice && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-md rounded-lg shadow-lg border p-3 text-sm flex items-start gap-3 ${
            /^(Error|Problem|Use |Slug |That slug)/.test(actionNotice)
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-green-50 border-green-200 text-green-800'
          }`}
        >
          <span className="flex-1">{actionNotice}</span>
          <button onClick={() => setActionNotice('')} className="font-bold" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {/* PL-268: the waitlist over-cap override — an informed, logged
          yes/no that used to be a nested native confirm(). */}
      {overCapAsk && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg shadow-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          <p>
            The class is at {overCapAsk.taken}/{overCapAsk.capacity}. Re-offering enrolls{' '}
            <strong>{overCapAsk.studentName}</strong> at {overCapAsk.taken + 1}/{overCapAsk.capacity} —
            sure? This is logged as an Ops override.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                const ask = overCapAsk
                setOverCapAsk(null)
                handleWaitlistRescue(ask.en, ask.studentName, ask.action, {
                  position: ask.position,
                  confirmOverCap: true,
                })
              }}
              className="text-red-700 font-semibold underline"
            >
              Yes, go over cap
            </button>
            <button onClick={() => setOverCapAsk(null)} className="text-gray-600 underline">
              cancel
            </button>
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-bold text-hgl-slate">HGL Admin</h1>
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

        {/* PL-190 (was PL-101): the sidebar now shows only the ACTIVE topline
            tab's filed pages — the topline bar (layout) switches groups, this
            switches within one. Panels still hide with CSS instead of
            unmounting so deep links, data loads, and the focus machinery
            behave exactly as before. */}
        <div className="md:flex md:gap-6 md:items-start">
          {/* PL-229: shared SidebarNav — href entries lost their ↗ because
              those pages now wear this same sidebar chrome; nothing
              navigates you out of the left-hand navigation anymore. */}
          {(NAV_GROUPS[activeGroup]?.entries.length ?? 0) > 1 && (
            <SidebarNav
              entries={NAV_GROUPS[activeGroup].entries}
              active={activeSection}
              onSelect={setActiveSection}
            />
          )}
          <div className="flex-1 min-w-0 space-y-6">

        <div className={activeSection === 'dashboard' ? '' : 'hidden'}>
          {/* PL-100: the landing view — Needs Attention (state-driven) +
              Recent Activity + a couple of restrained glance cards. */}
          <DashboardPanel />
        </div>

        <div className={activeSection === 'add-class' ? '' : 'hidden'}>
        {/* PL-241 (PL-229A rule): selecting the section IS the intent. */}
        <CollapsibleSection
          title="Add a new class"
          accent="border-hgl-slate"
          defaultOpen
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
                  Pre-filled from <strong>{wizardSourceLabel}</strong>{' '}— everything below is
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

        </div>

        <div className={activeSection === 'rosters' ? '' : 'hidden'}>
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

        </div>

        <div className={activeSection === 'contacts' ? '' : 'hidden'}>
        {/* PL-229: selecting the section IS the intent to open it.
            PL-242: the section is SCHOOLS — real editable records; contacts
            are an attribute on each school's card. */}
        <CollapsibleSection
          title="Schools"
          subtitle="Each school's identity, branding, and contacts — portal access and digests follow active affiliations"
          defaultOpen
        >
          {/* PL-242: school edits change the schools list itself — refresh both. */}
          <CounselorsPanel
            schools={schools}
            onChange={() => {
              fetchSchools()
              fetchAllCounselors()
            }}
          />
        </CollapsibleSection>

        </div>

        <div className={activeSection === 'instructors' ? '' : 'hidden'}>
        {/* PL-229: selecting the section IS the intent to open it. */}
        <CollapsibleSection
          title="Instructors"
          subtitle="Default meeting links auto-fill online classes; instructors sign in with their email"
          defaultOpen
        >
          <InstructorsPanel instructors={instructors} onChange={fetchInstructors} />
        </CollapsibleSection>

        </div>

        {/* PL-202: Quo calls setup — configure, verify, enable. */}
        <div className={activeSection === 'calls' ? '' : 'hidden'}>
          <CollapsibleSection
            title="Phone calls (Quo)"
            subtitle="Calls sync into family records; unknown callers join the pipeline"
            defaultOpen
          >
            <CallsPanel />
          </CollapsibleSection>
        </div>

        {/* PL-192: the two-way Contacts directory — two indexes, one truth. */}
        <div className={activeSection === 'students' ? '' : 'hidden'}>
          <ContactsDirectory mode="students" />
        </div>
        <div className={activeSection === 'parents' ? '' : 'hidden'}>
          <ContactsDirectory mode="parents" />
        </div>

        {/* Out-of-flow branding edits — setup happens in the new-school wizard branch. */}
        <div className={activeSection === 'branding' ? '' : 'hidden'}>
        {/* PL-237 D: the per-class collateral panel's home outside the wizard
            — pick a class, get the full card (fields, downloads, previews,
            CS send). The skip-for-now Needs Attention row deep-links here. */}
        <CollapsibleSection
          title="Class collateral"
          subtitle="Pick a class — flyer & parent-letter fields, downloads, and the school welcome"
          accent="border-hgl-blue"
          defaultOpen
        >
          <select
            value={collateralClassId}
            onChange={(e) => setCollateralClassId(e.target.value)}
            className="border border-gray-300 rounded-md p-2 bg-white text-sm mb-4"
          >
            <option value="">Pick a class…</option>
            {rosters
              .filter((c) => c.status !== 'cancelled')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.schools?.nickname ?? '—'} {c.class_type} · starts {c.start_date}
                  {c.collateral_reminder_at && !c.short_link ? ' — collateral not set up' : ''}
                </option>
              ))}
          </select>
          {(() => {
            const c = rosters.find((x) => x.id === collateralClassId)
            if (!c) return <p className="text-sm text-gray-500 italic">No class picked yet.</p>
            const sortedSessions = [...(c.sessions ?? [])].sort((a, b) =>
              a.session_date.localeCompare(b.session_date)
            )
            return (
              <CollateralCard
                classId={c.id}
                classType={c.class_type}
                inPerson={c.delivery_mode !== 'online'}
                sessionDates={sortedSessions.map((s) => s.session_date)}
                fields={c}
                school={schools.find((s) => s.id === c.school_id) ?? null}
                onSaved={fetchRosters}
              />
            )
          })()}
        </CollapsibleSection>

        {/* PL-241 (PL-229A rule): selecting the section IS the intent. */}
        <CollapsibleSection
          title="School branding &amp; collateral defaults"
          subtitle="Logo, accent color, and default language for the generated flyer + parent letter"
          defaultOpen
        >
          <SchoolBrandingPanel schools={schools} onChange={fetchSchools} />
        </CollapsibleSection>

        {/* Phase 6: accounting integration — connection + mapping are
            admin-only; the sync log and retries are staff-wide. */}
        </div>

        <div className={activeSection === 'qbo' ? '' : 'hidden'}>
        {/* PL-241 (PL-229A rule): selecting the section IS the intent. */}
        <CollapsibleSection
          title="QuickBooks"
          subtitle="Stripe payments post to QuickBooks automatically — connection, item mapping, and the sync log"
          defaultOpen
          openSignal={qboOpenSignal}
        >
          <QboPanel status={qboStatus} onStatusChange={fetchQboStatus} />
        </CollapsibleSection>

        {/* PL-33: owner-level config, grouped with QuickBooks here rather
            than cluttering the tutoring page the Ops Director works in daily. */}
        </div>

        <div className={activeSection === 'gcal' ? '' : 'hidden'}>
        {/* PL-241 (PL-229A rule): selecting the section IS the intent. */}
        <CollapsibleSection
          title="Google Calendar"
          subtitle="Service-account connection and push queue for tutoring sessions"
          defaultOpen
        >
          <GcalPanel />
        </CollapsibleSection>

        </div>

        {/* PL-50: renders only for admins (the API 403s managers). */}
        <div className={activeSection === 'settings' ? '' : 'hidden'}>
        <ContactSettingsPanel />
        </div>

        {/* PL-213: Team access — admin-only (same self-gating pattern). */}
        <div className={activeSection === 'team' ? '' : 'hidden'}>
        <TeamAccessPanel />
        </div>

          </div>
        </div>
      </div>
    </div>
  )
}
