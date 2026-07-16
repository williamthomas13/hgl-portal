'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { CollapsibleSection } from '../ui'
import GcalPanel from './gcal-panel'
import TutorsPanel from './tutors-panel'
import TimecardsPanel from './timecards-panel'
import InvoicesPanel from './invoices-panel'
import EngagementWizard from './engagement-wizard'
import EngagementsPanel from './engagements-panel'
import ScheduleView from './schedule-view'
import ActivityFeed from './activity-feed'
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
  const [nextSessions, setNextSessions] = useState<Record<string, string>>({})
  const [packageHoursUsed, setPackageHoursUsed] = useState<Record<string, number>>({})
  const [addonHours, setAddonHours] = useState<Record<string, number>>({})
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [tutorsRes, subjectsRes, studentsRes, engagementsRes, notesRes] = await Promise.all([
      supabase
        .from('instructors')
        .select('id, email, name, tutoring_active, subjects, timezone, google_calendar_id, default_location, offer_windows')
        .order('name'),
      supabase.from('subjects').select('*').order('category').order('name'),
      supabase
        .from('students')
        .select('id, first_name, last_name, families ( id, parent_first_name, parent_last_name, parent_email )')
        .order('first_name'),
      supabase
        .from('tutoring_engagements')
        .select(
          `id, student_id, tutor_id, subject_id, hourly_rate, funding, addon_id, recurrence,
           location, status, start_date, end_date, notes,
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

    // Next confirmed session per engagement + package draw-down (§5: hours
    // remaining = purchased − (completed + no_show + forfeited + upcoming
    // confirmed)).
    const engIds = engs.map((e) => e.id)
    if (engIds.length > 0) {
      const { data: upcoming } = await supabase
        .from('tutoring_sessions')
        .select('engagement_id, starts_at')
        .in('engagement_id', engIds)
        .eq('status', 'confirmed')
        .gte('starts_at', new Date().toISOString())
        .order('starts_at')
      const next: Record<string, string> = {}
      for (const s of upcoming ?? []) {
        if (!next[s.engagement_id]) next[s.engagement_id] = s.starts_at
      }
      setNextSessions(next)

      const packageEngIds = engs.filter((e) => e.funding === 'package').map((e) => e.id)
      if (packageEngIds.length > 0) {
        const { data: consuming } = await supabase
          .from('tutoring_sessions')
          .select('engagement_id, duration_minutes, status')
          .in('engagement_id', packageEngIds)
          .in('status', ['completed', 'no_show', 'forfeited', 'confirmed'])
        const used: Record<string, number> = {}
        for (const s of consuming ?? []) {
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
            <CollapsibleSection
              title="Schedule"
              subtitle="Per-tutor week (with Google busy shading) and all-tutors day"
              defaultOpen
            >
              <ScheduleView tutors={tutors} refreshSignal={refreshSignal} />
            </CollapsibleSection>

            <CollapsibleSection
              title="Recent parent activity"
              subtitle="Reschedules families completed themselves in the portal — nothing happens invisibly"
              defaultOpen
            >
              <ActivityFeed refreshSignal={refreshSignal} />
            </CollapsibleSection>

            <CollapsibleSection
              title="New student schedule"
              subtitle="Student → subject → tutor → weekly slots → rate → go"
              accent="border-hgl-blue"
            >
              <EngagementWizard
                students={students}
                subjects={subjects}
                tutors={tutors}
                tutorNotes={tutorNotes}
                onCreated={refresh}
              />
            </CollapsibleSection>

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
                onChange={refresh}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="Billing"
              subtitle="Monthly cycle: propose on the 20th → family confirms → invoice or autopay, due month-end"
            >
              <InvoicesPanel />
            </CollapsibleSection>

            <CollapsibleSection
              title="Timecards"
              subtitle="Semi-monthly, hours only — approve, then export for QBO Payroll"
            >
              <TimecardsPanel />
            </CollapsibleSection>

            <CollapsibleSection title="Tutors" subtitle="Who tutors, their subjects, timezone, and matching notes">
              <TutorsPanel tutors={tutors} subjects={subjects} notes={tutorNotes} onChange={refresh} />
            </CollapsibleSection>

            <CollapsibleSection title="Google Calendar" subtitle="Service-account connection and push queue">
              <GcalPanel />
            </CollapsibleSection>
          </>
        )}
      </div>
    </div>
  )
}
