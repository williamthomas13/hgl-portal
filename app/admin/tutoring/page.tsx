'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { CollapsibleSection, useDeepLinkFocus } from '../ui'
import { SidebarLayout, SidebarPanel } from '../sidebar'
import TutorsPanel from './tutors-panel'
import TimecardsPanel from './timecards-panel'
import InvoicesPanel from './invoices-panel'
import EngagementWizard, { type ScheduleDraftRow } from './engagement-wizard'
import ScheduleDraftsCard from './schedule-drafts-card'
import EngagementsPanel from './engagements-panel'
import ScheduleView from './schedule-view'
import ActivityFeed from './activity-feed'
import DriftBanner from './drift-banner'
import AvailabilityReviewCard from './availability-review-card'
import AssignmentConflictsCard from './assignment-conflicts-card'
import type { Engagement, StudentOption, Subject, Tutor } from './types'

// Ops Director scheduling surface (Phase 7a, docs/PHASE7_SPEC.md §5). Reads run on the
// browser client under staff RLS like the rest of /admin; mutations go
// through /api/admin/tutoring/* and /api/gcal/*. Ship line: the Ops Director schedules
// here instead of typing sessions into Google Calendar.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export default function TutoringAdmin() {
  const [tutors, setTutors] = useState<Tutor[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<StudentOption[]>([])
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [tutorNotes, setTutorNotes] = useState<Record<string, string>>({})
  // PL-339: start + end travel together so "next:" can speak the range.
  const [nextSessions, setNextSessions] = useState<Record<string, { starts_at: string; ends_at: string | null }>>({})
  const [packageHoursUsed, setPackageHoursUsed] = useState<Record<string, number>>({})
  const [addonHours, setAddonHours] = useState<Record<string, number>>({})
  // PL-84: family_id → cancellation-conversion packages (the authoritative
  // "what was promised" record on the family profile).
  const [conversions, setConversions] = useState<Record<string, { label: string; hours: number; paid: number }[]>>({})
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  // PL-90/92: alert deep-links — ?invoice={id} / ?family={id} / ?schedule=
  // {studentId} open the right section and highlight the exact record.
  const [billingOpenSignal, setBillingOpenSignal] = useState(0)
  const [wizardOpenSignal, setWizardOpenSignal] = useState(0)
  const [focusElement, setFocusElement] = useState<string | null>(null)
  const [wizardPreload, setWizardPreload] = useState<string | null>(null)
  // PL-227: the five lower tiles are sidebar sections — deep links must
  // land with the RIGHT section selected (hidden panels stay mounted, but a
  // scroll-into-view inside a hidden panel would be invisible).
  // PL-254: the wizard + schedules are a section too ('schedule', the
  // default landing) so the sidebar wraps the WHOLE page — pinning them
  // above the SidebarLayout pushed the menu ~1100px down, which read as
  // "the side menu fell to the bottom of the page".
  const [activeSection, setActiveSection] = useState<string>('schedule')
  // PL-262: the reschedule-request alert deep-links a specific session —
  // ?session={id} (+ &ack=1 or &reschedule=1) opens its dialog ready to act.
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null)
  const [focusSessionAction, setFocusSessionAction] = useState<'ack' | 'reschedule' | null>(null)
  const [focusWhy, setFocusWhy] = useState<string | null>(null)
  // PL-338: saved schedule drafts — the card lists them, Resume hands one to
  // the wizard, and any change bumps the version so the list recounts.
  const [draftToResume, setDraftToResume] = useState<ScheduleDraftRow | null>(null)
  const [draftsVersion, setDraftsVersion] = useState(0)
  // PL-389B: ?continue={engagementId} deep-links "Schedule the continuation" —
  // the Students section opens with that engagement's edit-schedule form
  // pre-filled and the continuation context bannered.
  const [scheduleContinuationFor, setScheduleContinuationFor] = useState<string | null>(null)
  const [continuationBanner, setContinuationBanner] = useState<string | null>(null)
  // PL-424D: ?availability={studentId} opens the shared-windows review card.
  const [availabilityReviewFor, setAvailabilityReviewFor] = useState<string | null>(null)
  // PL-438B: ?drift={sessionId} lands ON that drift in the banner.
  const [focusDriftId, setFocusDriftId] = useState<string | null>(null)
  // PL-434B: ?assignment={classId} opens the conflict-resolution card.
  const [assignmentReviewFor, setAssignmentReviewFor] = useState<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const invoice = q.get('invoice')
    const family = q.get('family')
    const schedule = q.get('schedule')
    const session = q.get('session')
    const continueFor = q.get('continue')
    if (continueFor) {
      setActiveSection('students')
      setScheduleContinuationFor(continueFor)
      const hours = q.get('hours')
      setContinuationBanner(
        `Scheduling the continuation the family confirmed${hours ? ` (${hours === 'monthly' ? 'monthly, until they cancel' : `${hours} more hours`})` : ''} — the current weekly pattern is pre-filled below; adjust if the old times no longer work, then Save.`
      )
      return
    }
    const assignmentReview = q.get('assignment')
    if (assignmentReview) {
      setActiveSection('schedule')
      setAssignmentReviewFor(assignmentReview)
      return
    }
    const driftFocus = q.get('drift')
    if (driftFocus) {
      setActiveSection('schedule')
      setFocusDriftId(driftFocus)
      return
    }
    const availabilityReview = q.get('availability')
    if (availabilityReview) {
      setActiveSection('schedule')
      setAvailabilityReviewFor(availabilityReview)
      return
    }
    if (session) {
      setActiveSection('schedule')
      setFocusSessionId(session)
      setFocusSessionAction(q.get('ack') ? 'ack' : q.get('reschedule') ? 'reschedule' : null)
      // PL-446A: the originating conflict rides the link so the dialog can
      // say what it's resolving ('assignment:{classId}' or 'availability').
      setFocusWhy(q.get('why'))
      return
    }
    if (invoice) {
      setActiveSection('billing')
      setBillingOpenSignal((n) => n + 1)
      setFocusElement(`invoice-${invoice}`)
    } else if (family) {
      setActiveSection('students')
      setFocusElement(`family-${family}`)
    } else if (schedule) {
      setActiveSection('schedule')
      setWizardOpenSignal((n) => n + 1)
      setWizardPreload(schedule)
    } else {
      // PL-298: ?section= lands on a named section (the dashboard's
      // timecard to-do uses it) — same contract as /admin's sidebar links.
      const section = q.get('section')
      if (section && ['schedule', 'activity', 'students', 'billing', 'timecards', 'tutors'].includes(section)) {
        setActiveSection(section)
      }
    }
  }, [])
  useDeepLinkFocus(focusElement)

  const load = useCallback(async () => {
    const [tutorsRes, subjectsRes, studentsRes, engagementsRes, notesRes] = await Promise.all([
      supabase
        .from('instructors')
        .select('id, email, name, tutoring_active, active, subjects, subjects_with_prep, timezone, google_calendar_id, default_meeting_link, offer_windows, pay_type_titles, pay_type, calendar_color')
        .order('name'),
      supabase.from('subjects').select('*').order('category').order('name'),
      supabase
        .from('students')
        .select('id, first_name, last_name, families ( id, parent_first_name, parent_last_name, parent_email )')
        .order('first_name'),
      supabase
        .from('tutoring_engagements')
        .select(
          `id, student_id, tutor_id, subject_id, hourly_rate, funding, addon_id, overdraw_ack_hours, recurrence,
           block_confirmation, location, status, start_date, end_date, notes,
           students ( id, first_name, last_name, families ( id, parent_first_name, parent_last_name, parent_email ) ),
           subjects ( name, category ),
           instructors ( name, email, timezone )`
        )
        .order('created_at', { ascending: false }),
      supabase.from('tutor_notes').select('instructor_id, notes'),
    ])

    setTutors((tutorsRes.data as Tutor[]) ?? [])
    setSubjects((subjectsRes.data as Subject[]) ?? [])
    setStudents(
      ((studentsRes.data as any[]) ?? []).map((s) => ({ ...s, families: one(s.families) })) as StudentOption[]
    )
    const engs = (((engagementsRes.data as any[]) ?? []).map((e) => ({
      ...e,
      students: e.students ? { ...one<any>(e.students), families: one<any>(one<any>(e.students)?.families) } : null,
      subjects: one(e.subjects),
      instructors: one(e.instructors),
    })) ?? []) as Engagement[]
    setEngagements(engs)
    setTutorNotes(
      Object.fromEntries((((notesRes.data as any[]) ?? []).map((n) => [n.instructor_id, n.notes ?? ''])))
    )

    // Next confirmed session per engagement + package draw-down — the same
    // status set as packageHoursUsedBefore, the function that actually bills
    // (PL-130's rule: never a parallel count that can drift from billing).
    const engIds = engs.map((e) => e.id)
    if (engIds.length > 0) {
      const { data: upcoming } = await supabase
        .from('tutoring_sessions')
        .select('engagement_id, starts_at, ends_at')
        .in('engagement_id', engIds)
        .eq('status', 'confirmed')
        .gte('starts_at', new Date().toISOString())
        .order('starts_at')
      const next: Record<string, { starts_at: string; ends_at: string | null }> = {}
      for (const s of upcoming ?? []) {
        if (!next[s.engagement_id]) next[s.engagement_id] = { starts_at: s.starts_at, ends_at: s.ends_at ?? null }
      }
      setNextSessions(next)

      const packageEngIds = engs.filter((e) => e.funding === 'package').map((e) => e.id)
      if (packageEngIds.length > 0) {
        const { data: consuming } = await supabase
          .from('tutoring_sessions')
          .select('engagement_id, duration_minutes, status, reschedule_notice')
          .in('engagement_id', packageEngIds)
          .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
        const used: Record<string, number> = {}
        for (const s of consuming ?? []) {
          if (s.status === 'rescheduled' && s.reschedule_notice !== 'late') continue
          used[s.engagement_id] = (used[s.engagement_id] ?? 0) + s.duration_minutes / 60
        }
        setPackageHoursUsed(used)

        const addonIds = engs.map((e) => e.addon_id).filter((x): x is string => !!x)
        if (addonIds.length > 0) {
          const { data: addons } = await supabase.from('enrollment_addons').select('id, hours').in('id', addonIds)
          setAddonHours(Object.fromEntries((addons ?? []).map((a) => [a.id, Number(a.hours)])))
        }
      }
    } else {
      setNextSessions({})
    }

    // PL-84: hours packages minted from class cancellations, keyed by family.
    const { data: conversionRows } = await supabase
      .from('enrollment_addons')
      .select(
        `hours, price_paid,
         enrollments!inner ( class_id, classes ( class_type, schools ( nickname ) ),
           students!inner ( family_id ) )`
      )
      .eq('source', 'cancellation_conversion')
    const byFam: Record<string, { label: string; hours: number; paid: number }[]> = {}
    for (const row of (conversionRows as any[]) ?? []) {
      const enr = one<any>(row.enrollments)
      const cls = one<any>(enr?.classes)
      const school = one<any>(cls?.schools)
      const famId = one<any>(enr?.students)?.family_id
      if (!famId) continue
      const label = cls ? `${school?.nickname ?? 'HGL'} ${cls.class_type}` : 'class'
      ;(byFam[famId] ??= []).push({ label, hours: Number(row.hours), paid: Number(row.price_paid) })
    }
    setConversions(byFam)
    setLoaded(true)
  }, [])
  /* eslint-enable @typescript-eslint/no-explicit-any */

  useEffect(() => {
    load()
  }, [load, refreshSignal])

  const refresh = () => setRefreshSignal((n) => n + 1)
  // Student-centric count (Scarlett's rule): distinct students, not rows.
  const activeStudents = new Set(engagements.filter((e) => e.status === 'active').map((e) => e.student_id)).size

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-hgl-slate">1-on-1 Tutoring</h1>
            <p className="text-sm text-gray-500 mt-1">
              Schedule here — sessions appear on tutors&apos; Google Calendars automatically. Tutors
              keep blocking their availability in Google exactly as before.
            </p>
          </div>
          <a href="/admin" className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate">
            ← Back to admin
          </a>
        </div>

        {!loaded ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            {/* PL-180: calendar-side edits surface FIRST — a decision is
                pending and everything below may be affected by it. */}
            <DriftBanner focusDriftId={focusDriftId} />
            {/* PL-424D: the availability-alert click-through's resolution
                surface — the same diff the email carried + what's downstream. */}
            {availabilityReviewFor && (
              <AvailabilityReviewCard
                studentId={availabilityReviewFor}
                onClose={() => setAvailabilityReviewFor(null)}
              />
            )}
            {/* PL-434B: the assignment-conflict NA row's resolution surface. */}
            {assignmentReviewFor && (
              <AssignmentConflictsCard
                classId={assignmentReviewFor}
                onClose={() => setAssignmentReviewFor(null)}
              />
            )}
            {/* PL-227/PL-254: every section, scheduling included, lives in
                ONE page-level sidebar layout (one visible at a time,
                Contacts-style) — the menu is a real sidebar again instead of
                landing below two tall pinned sections. Panels stay
                mounted-hidden — the PL-99 lesson. */}
            <SidebarLayout
              entries={[
                { id: 'schedule', label: 'Scheduling' },
                { id: 'activity', label: 'Recent parent activity' },
                { id: 'students', label: 'Students' },
                { id: 'billing', label: 'Billing' },
                { id: 'timecards', label: 'Timecards' },
                { id: 'tutors', label: 'Tutors' },
              ]}
              active={activeSection}
              onSelect={setActiveSection}
            >
              <SidebarPanel id="schedule" active={activeSection}>
                {/* PL-20: the wizard sits above the calendars — it's the
                    "start here" action when a family calls. */}
                <CollapsibleSection
                  title="New student schedule"
                  subtitle="Student → subject → tutor → weekly slots → rate → go"
                  accent="border-hgl-blue"
                  openSignal={wizardOpenSignal}
                >
                  <EngagementWizard
                    students={students}
                    subjects={subjects}
                    tutors={tutors}
                    tutorNotes={tutorNotes}
                    preloadStudentId={wizardPreload}
                    serverDraft={draftToResume}
                    onServerDraftConsumed={() => setDraftToResume(null)}
                    onDraftsChanged={() => setDraftsVersion((v) => v + 1)}
                    onCreated={refresh}
                  />
                </CollapsibleSection>

                {/* PL-338 C: saved drafts, right under the wizard they feed. */}
                <ScheduleDraftsCard
                  version={draftsVersion}
                  tutors={tutors}
                  onResume={(d) => {
                    setDraftToResume(d)
                    setWizardOpenSignal((n) => n + 1)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                />

                <div className="mt-6">
                  <CollapsibleSection
                    title="Current Student Schedules"
                    subtitle="Per-tutor week (with Google busy shading) and all-tutors day"
                    defaultOpen
                  >
                    <ScheduleView
                      tutors={tutors}
                      refreshSignal={refreshSignal}
                      focusSessionId={focusSessionId}
                      focusAction={focusSessionAction}
                      focusWhy={focusWhy}
                      // PL-337 C: "Use this schedule" prefills the wizard —
                      // same handoff shape as resuming a saved draft.
                      onUseProposal={(payload) => {
                        setDraftToResume({
                          id: '',
                          created_by: '',
                          student_label: null,
                          payload,
                          created_at: '',
                          updated_at: '',
                        })
                        setWizardOpenSignal((n) => n + 1)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      onDraftsChanged={() => setDraftsVersion((v) => v + 1)}
                    />
                  </CollapsibleSection>
                </div>
              </SidebarPanel>

              <SidebarPanel id="activity" active={activeSection}>
                <CollapsibleSection
                  title="Recent parent activity"
                  subtitle="Everything families did from the portal — completed moves AND requests waiting on you"
                  defaultOpen
                >
                  <ActivityFeed refreshSignal={refreshSignal} />
                </CollapsibleSection>
              </SidebarPanel>

              <SidebarPanel id="students" active={activeSection}>
                <CollapsibleSection
                  title="Students"
                  subtitle={`${activeStudents} student${activeStudents === 1 ? '' : 's'} with a regular schedule`}
                  defaultOpen
                >
                  <EngagementsPanel
                    engagements={engagements}
                    nextSessions={nextSessions}
                    packageHoursUsed={packageHoursUsed}
                    addonHours={addonHours}
                    conversions={conversions}
                    onChange={refresh}
                    tutors={tutors}
                    openScheduleEditorFor={scheduleContinuationFor}
                    continuationContext={continuationBanner}
                  />
                </CollapsibleSection>
              </SidebarPanel>

              <SidebarPanel id="billing" active={activeSection}>
                <CollapsibleSection
                  title="Billing"
                  subtitle="Monthly cycle: propose on the 20th → family confirms → invoice or autopay, due month-end"
                  defaultOpen
                  openSignal={billingOpenSignal}
                >
                  <InvoicesPanel />
                </CollapsibleSection>
              </SidebarPanel>

              <SidebarPanel id="timecards" active={activeSection}>
                <CollapsibleSection
                  title="Timecards"
                  subtitle="Semi-monthly, hours only — approve, then export for QBO Payroll"
                  defaultOpen
                >
                  <TimecardsPanel />
                </CollapsibleSection>
              </SidebarPanel>

              <SidebarPanel id="tutors" active={activeSection}>
                <CollapsibleSection
                  title="Tutors"
                  subtitle="Who tutors, their subjects, timezone, and matching notes"
                  defaultOpen
                >
                  <TutorsPanel tutors={tutors} subjects={subjects} notes={tutorNotes} onChange={refresh} />
                </CollapsibleSection>
              </SidebarPanel>
            </SidebarLayout>

            {/* PL-33: the Google Calendar connection card moved to the main
                admin page, grouped with QuickBooks — owner-level config, not
                the Ops Director's daily surface. */}
          </>
        )}
      </div>
    </div>
  )
}
