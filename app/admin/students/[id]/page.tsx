'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../utils/supabase'
import { CollapsibleSection } from '../../ui'
import { FamilyCommsTimeline } from '../../family-comms'
import ScoresEntry from '../../../components/ScoresEntry'
import { formatDateShort } from '../../../utils/dates'

// PL-193: the student profile — everything we know about one student, one
// organized place, every section reading from its EXISTING store (this page
// aggregates; it never duplicates data or widens access — staff RLS, same as
// the rest of /admin). Reached from Contacts (PL-192), the pipeline, and the
// class rosters.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const money = (n: number | string | null | undefined) =>
  n == null ? '—' : `$${Number(n).toFixed(2).replace(/\.00$/, '')}`

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

type Profile = {
  student: any
  family: any
  siblings: any[]
  engagements: any[]
  sessions: any[]
  enrollments: any[]
  addons: any[]
  invoices: any[]
  acceptances: any[]
  consults: any[]
  scoresByClass: Record<string, any[]>
}

export default function StudentProfilePage() {
  const params = useParams<{ id: string }>()
  const studentId = params?.id ?? ''
  const [p, setP] = useState<Profile | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!studentId) return
    const { data: student, error: sErr } = await supabase
      .from('students')
      .select(
        `id, first_name, last_name, pronouns, student_email, student_phone, school, grade_level,
         graduating_year, special_needs, family_id, created_at,
         families ( id, parent_first_name, parent_last_name, parent_email, parent_phone,
                    guardian2_name, guardian2_email, guardian2_phone, billing_email, autopay, timezone )`
      )
      .eq('id', studentId)
      .maybeSingle()
    if (sErr || !student) {
      setError(sErr?.message ?? 'No student with this id.')
      return
    }
    const family = one<any>(student.families)
    const familyId = family?.id ?? student.family_id

    const [siblingsRes, engRes, sessRes, enrRes, invRes, accRes, leadRes] = await Promise.all([
      familyId
        ? supabase
            .from('students')
            .select('id, first_name, last_name, grade_level')
            .eq('family_id', familyId)
            .neq('id', studentId)
            .order('first_name')
        : Promise.resolve({ data: [] } as any),
      supabase
        .from('tutoring_engagements')
        .select(
          `id, hourly_rate, funding, recurrence, location, status, start_date, end_date, addon_id,
           subjects ( name ), instructors ( name )`
        )
        .eq('student_id', studentId)
        .order('created_at', { ascending: false }),
      supabase
        .from('tutoring_sessions')
        .select('id, starts_at, duration_minutes, status, engagement_id, reschedule_notice')
        .eq('student_id', studentId)
        .order('starts_at', { ascending: false })
        .limit(400),
      supabase
        .from('enrollments')
        .select(
          `id, payment_status, enrolled_at, amount_paid, class_cancelled, cancellation_outcome,
           classes ( id, class_type, start_date, end_date, schools ( nickname, name ) ),
           enrollment_addons ( id, hours, price_paid, source, purchased_at )`
        )
        .eq('student_id', studentId)
        .order('enrolled_at', { ascending: false }),
      familyId
        ? supabase
            .from('tutoring_invoices')
            .select('id, period, status, total, due_at, paid_at')
            .eq('family_id', familyId)
            .order('period', { ascending: false })
            .limit(12)
        : Promise.resolve({ data: [] } as any),
      familyId
        ? supabase
            .from('agreement_acceptances')
            .select('id, accepted_by_name, accepted_by_email, accepted_at, agreement_templates ( title, version )')
            .eq('family_id', familyId)
            .order('accepted_at', { ascending: false })
        : Promise.resolve({ data: [] } as any),
      // PL-189: phone consults live on the lead record too.
      supabase
        .from('leads')
        .select('id, consult_at, consult_owner_email, consult_mode, status')
        .eq('student_id', studentId)
        .not('consult_at', 'is', null),
    ])

    // PL-181's store: this student's class-linked diagnostics, inline on the
    // class entries below (the standalone entry widget shows the full list).
    const classIds = ((enrRes.data as any[]) ?? [])
      .map((e) => one<any>(e.classes)?.id)
      .filter(Boolean)
    const scoresByClass: Record<string, any[]> = {}
    if (classIds.length > 0) {
      const { data: classScores } = await supabase
        .from('student_scores')
        .select('class_id, test_label, total, taken_at')
        .eq('student_id', studentId)
        .in('class_id', classIds)
      for (const r of classScores ?? []) {
        ;(scoresByClass[r.class_id] ??= []).push(r)
      }
    }

    setP({
      student,
      family,
      siblings: (siblingsRes.data as any[]) ?? [],
      engagements: (((engRes.data as any[]) ?? []).map((e) => ({
        ...e,
        subjects: one(e.subjects),
        instructors: one(e.instructors),
      }))),
      sessions: (sessRes.data as any[]) ?? [],
      enrollments: (((enrRes.data as any[]) ?? []).map((e) => ({ ...e, classes: one(e.classes) }))),
      addons: [],
      invoices: (invRes.data as any[]) ?? [],
      acceptances: (((accRes.data as any[]) ?? []).map((a) => ({ ...a, agreement_templates: one(a.agreement_templates) }))),
      consults: (leadRes.data as any[]) ?? [],
      scoresByClass,
    })
  }, [studentId])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <div className="max-w-4xl mx-auto">
          <p className="text-sm text-red-600">{error}</p>
          <a href="/admin?tab=contacts" className="text-sm text-hgl-blue underline">← Back to Contacts</a>
        </div>
      </div>
    )
  }
  if (!p) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <p className="max-w-4xl mx-auto text-sm text-gray-500">Loading…</p>
      </div>
    )
  }

  const { student: st, family: fam } = p
  const fullName = `${st.first_name} ${st.last_name}`.trim()
  const upcoming = p.sessions.filter((s) => s.status === 'confirmed' && new Date(s.starts_at) > new Date())
  // PL-197: package drawdown, NEVER capped — same consuming rule as billing.
  const usedOnAddon = (addonId: string) => {
    const engIds = new Set(p.engagements.filter((e) => e.addon_id === addonId).map((e) => e.id))
    return p.sessions
      .filter((s) => engIds.has(s.engagement_id))
      .filter((s) => ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'].includes(s.status))
      .filter((s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late')
      .reduce((sum, s) => sum + s.duration_minutes / 60, 0)
  }
  const completedHours = p.sessions
    .filter((s) => s.status === 'completed')
    .reduce((a, s) => a + s.duration_minutes / 60, 0)

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-hgl-slate">
              {fullName}
              {st.pronouns && <span className="text-base font-normal text-gray-500 ml-2">({st.pronouns})</span>}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {[st.grade_level && `Grade ${st.grade_level}`, st.graduating_year && `class of ${st.graduating_year}`, st.school]
                .filter(Boolean)
                .join(' · ') || 'Student'}
            </p>
          </div>
          <a href="/admin?tab=contacts" className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate">
            ← Contacts
          </a>
        </div>

        {/* People — the family around the student. */}
        <CollapsibleSection title="People" subtitle="Parents, guardians, and siblings" defaultOpen>
          <div className="text-sm space-y-3">
            {fam ? (
              <div>
                <p className="font-semibold text-hgl-slate">
                  {`${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim() || '—'}
                  <span className="ml-2 text-xs font-normal text-gray-500">parent</span>
                </p>
                <p className="text-xs text-gray-600">
                  {[fam.parent_email, fam.parent_phone].filter(Boolean).join(' · ') || 'no contact info'}
                </p>
                {fam.guardian2_name && (
                  <p className="text-xs text-gray-600 mt-1">
                    <span className="font-semibold">{fam.guardian2_name}</span>
                    {' · '}
                    {[fam.guardian2_email, fam.guardian2_phone].filter(Boolean).join(' · ') || 'no contact info'}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-gray-500 italic">No family record linked yet.</p>
            )}
            {p.siblings.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Siblings</p>
                <ul className="space-y-0.5">
                  {p.siblings.map((s) => (
                    <li key={s.id}>
                      <a href={`/admin/students/${s.id}`} className="text-hgl-blue underline">
                        {s.first_name} {s.last_name}
                      </a>
                      {s.grade_level && <span className="text-xs text-gray-500 ml-1.5">Grade {s.grade_level}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* The student's own contact information. */}
        <CollapsibleSection title="Contact information" subtitle={`${st.first_name}'s own details`} defaultOpen>
          <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            <div><dt className="text-xs font-semibold text-gray-500">Email</dt><dd>{st.student_email ?? '—'}</dd></div>
            <div><dt className="text-xs font-semibold text-gray-500">Phone</dt><dd>{st.student_phone ?? '—'}</dd></div>
            <div><dt className="text-xs font-semibold text-gray-500">School</dt><dd>{st.school ?? '—'}</dd></div>
            <div><dt className="text-xs font-semibold text-gray-500">Grade</dt><dd>{st.grade_level ?? '—'}</dd></div>
            {st.special_needs && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-gray-500">Learning notes</dt>
                <dd>{st.special_needs}</dd>
              </div>
            )}
          </dl>
        </CollapsibleSection>

        {/* Money — per-student where it is, family-level where it's shared. */}
        <CollapsibleSection title="Money" subtitle="Rates and packages for this student; invoices are family-level">
          <div className="text-sm space-y-4">
            {p.engagements.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Tutoring rates</p>
                <ul className="space-y-0.5">
                  {p.engagements.map((e) => (
                    <li key={e.id} className="text-xs">
                      {e.subjects?.name ?? 'Tutoring'} with {e.instructors?.name ?? '—'} —{' '}
                      <span className="font-semibold">{money(e.hourly_rate)}/h</span>
                      {' · '}
                      {e.funding === 'package' ? 'billed against an hours package' : 'monthly invoice'}
                      {' · '}
                      {e.status}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.enrollments.some((e) => (e.enrollment_addons ?? []).length > 0) && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Hours packages</p>
                <ul className="space-y-0.5">
                  {p.enrollments.flatMap((e) =>
                    ((e.enrollment_addons ?? []) as any[]).map((a, i) => {
                      const used = a.id ? usedOnAddon(a.id) : 0
                      const over = Math.max(0, used - Number(a.hours))
                      return (
                        <li key={`${e.id}-${i}`} className="text-xs">
                          {Number(a.hours)}h — {money(a.price_paid)}
                          {a.source === 'cancellation_conversion' && ' (from a class cancellation)'}
                          {a.purchased_at && ` · ${formatDateShort(a.purchased_at)}`}
                          {used > 0 && over <= 0 && (
                            <span className="text-gray-500"> · {used.toFixed(1)} of {Number(a.hours)}h used</span>
                          )}
                          {over > 0 && (
                            /* PL-197: reads "over", never "full". */
                            <span className="text-red-600 font-semibold"> · {used.toFixed(1)} of {Number(a.hours)}h used — {over.toFixed(1)}h over</span>
                          )}
                        </li>
                      )
                    })
                  )}
                </ul>
              </div>
            )}
            {p.enrollments.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Class payments</p>
                <ul className="space-y-0.5">
                  {p.enrollments.map((e) => (
                    <li key={e.id} className="text-xs">
                      {one<any>(e.classes?.schools)?.nickname ?? ''} {e.classes?.class_type ?? 'class'} —{' '}
                      {e.amount_paid != null ? money(e.amount_paid) : e.payment_status}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.invoices.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">
                  Family invoices <span className="font-normal text-gray-400">(whole family, not just {st.first_name})</span>
                </p>
                <ul className="space-y-0.5">
                  {p.invoices.map((inv) => (
                    <li key={inv.id} className="text-xs">
                      <a href={`/admin/tutoring?invoice=${inv.id}`} className="text-hgl-blue underline">
                        {inv.period}
                      </a>{' '}
                      — {money(inv.total)} · {inv.paid_at ? `paid ${formatDateShort(inv.paid_at)}` : inv.status}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.engagements.length === 0 && p.enrollments.length === 0 && p.invoices.length === 0 && (
              <p className="text-gray-500 italic">No billing history yet.</p>
            )}
          </div>
        </CollapsibleSection>

        {/* Agreements — family-scoped acceptances. */}
        <CollapsibleSection title="Agreements" subtitle="Signed agreements on the family record">
          {p.acceptances.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No signed agreements yet.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {p.acceptances.map((a) => (
                <li key={a.id} className="text-xs">
                  <span className="font-semibold">{a.agreement_templates?.title ?? 'Agreement'}</span>
                  {a.agreement_templates?.version != null && ` v${a.agreement_templates.version}`}
                  {' — accepted by '}
                  {a.accepted_by_name ?? a.accepted_by_email ?? '—'} on {fmtWhen(a.accepted_at)}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* Schedule, past and current — consults, 1-on-1, classes. */}
        <CollapsibleSection
          title="Schedule"
          subtitle={`${upcoming.length} upcoming session${upcoming.length === 1 ? '' : 's'} · ${completedHours.toFixed(1).replace(/\.0$/, '')}h completed`}
          defaultOpen
        >
          <div className="text-sm space-y-4">
            {p.consults.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Consultation</p>
                <ul className="space-y-0.5">
                  {p.consults.map((c) => (
                    <li key={c.id} className="text-xs">
                      {fmtWhen(c.consult_at)}
                      {c.consult_mode === 'phone' ? ' — happened by phone' : ''}
                      {c.consult_owner_email && ` · with ${c.consult_owner_email}`}
                      {' · '}
                      <a href={`/admin/leads?lead=${c.id}`} className="text-hgl-blue underline">
                        pipeline record
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.engagements.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">1-on-1 tutoring</p>
                <ul className="space-y-0.5">
                  {p.engagements.map((e) => (
                    <li key={e.id} className="text-xs">
                      {e.subjects?.name ?? 'Tutoring'} with {e.instructors?.name ?? '—'} — {e.status}
                      {e.start_date && ` · since ${formatDateShort(e.start_date)}`}
                      {' · '}
                      <a href={`/admin/tutoring?family=${fam?.id ?? ''}`} className="text-hgl-blue underline">
                        manage
                      </a>
                    </li>
                  ))}
                </ul>
                {upcoming.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Next: {fmtWhen(upcoming[upcoming.length - 1].starts_at)}
                  </p>
                )}
              </div>
            )}
            {p.enrollments.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Classes</p>
                <ul className="space-y-1">
                  {p.enrollments.map((e) => {
                    const cls = e.classes
                    const scores = (cls && p.scoresByClass[cls.id]) || []
                    return (
                      <li key={e.id} className="text-xs">
                        <a href={`/admin?class=${cls?.id ?? ''}`} className="text-hgl-blue underline">
                          {one<any>(cls?.schools)?.nickname ?? ''} {cls?.class_type ?? 'class'}
                        </a>
                        {cls?.start_date && ` · ${formatDateShort(cls.start_date)}–${cls.end_date ? formatDateShort(cls.end_date) : ''}`}
                        {e.class_cancelled && ' · class cancelled'}
                        {/* PL-181: the two class diagnostics inline on the class entry. */}
                        {scores.length > 0 && (
                          <span className="text-gray-600">
                            {' — '}
                            {scores
                              .slice()
                              .sort((a: any, b: any) => String(a.test_label).localeCompare(String(b.test_label)))
                              .map((s: any) => `${s.test_label}: ${s.total ?? '—'}`)
                              .join(' · ')}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {p.consults.length === 0 && p.engagements.length === 0 && p.enrollments.length === 0 && (
              <p className="text-gray-500 italic">No schedule history yet.</p>
            )}
          </div>
        </CollapsibleSection>

        {/* All test scores — PL-181's store, full history + entry. */}
        <CollapsibleSection title="Test scores" subtitle="Full history — every surface writes to this same store" defaultOpen>
          <ScoresEntry classId={null} students={[{ id: st.id, name: fullName }]} />
        </CollapsibleSection>

        {/* Communications — the family timeline (PL-83/164 machinery). */}
        <CollapsibleSection title="Communications" subtitle="Everything this family was sent, newest first">
          <FamilyCommsTimeline studentId={st.id} />
        </CollapsibleSection>
      </div>
    </div>
  )
}
