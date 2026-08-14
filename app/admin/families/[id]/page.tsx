'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../utils/supabase'
import { CollapsibleSection } from '../../ui'
import { SidebarLayout, SidebarPanel, type SidebarEntry } from '../../sidebar'
import { FamilyCommsTimeline } from '../../family-comms'
import ScoresEntry from '../../../components/ScoresEntry'
import { formatDateShort, formatTimeRange } from '../../../utils/dates'
import { pronounsDisplayLabel } from '../../../utils/pronoun-label'

// PL-230: ONE Family profile per household — the canonical person-record hub
// (route: /admin/families/{id}; every "names are doors" link points here).
// The data was always family-shaped: families own login/billing/agreements/
// autopay/consult history; students own enrollments, tutoring, scores,
// notes. This page absorbs the old per-student profile (that route now
// redirects here) and the never-built parent page. Everything reads from
// its EXISTING store — this page aggregates, it never duplicates data or
// widens access (staff RLS, same as the rest of /admin).
//
// Landing is origin-dependent via query params:
//   ?section=household   (Agreements, parent-lens results — the default)
//   ?section=comms       (Communications)
//   ?section=billing     (billing rows)
//   ?section=prospect    (pipeline)
//   ?student={studentId} (rosters, tutoring, student-lens results)

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const money = (n: number | string | null | undefined) =>
  n == null ? '—' : `$${Number(n).toFixed(2).replace(/\.00$/, '')}`

const ENGAGEMENT_STATUS_LABELS: Record<string, string> = {
  pending_parent_confirmation: 'awaiting family confirmation',
  active: 'active',
  paused: 'paused',
  ended: 'ended',
}
const engStatus = (s: string) => ENGAGEMENT_STATUS_LABELS[s] ?? s

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/** PL-339: "Nov 9, 2026, 4:00–5:30 PM" — date + full range (end derived
 *  from the session's duration; the query carries no ends_at). */
const fmtWhenRange = (iso: string, durationMinutes: number) => {
  const end = new Date(new Date(iso).getTime() + durationMinutes * 60_000)
  const day = new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${day}, ${formatTimeRange(iso, end, 'America/Denver')}`
}

// PL-231: contact info is actionable — plain protocol handoff, OS picks the app.
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
const Email = ({ v }: { v: string }) => (
  <a href={`mailto:${v}`} className="text-hgl-blue hover:underline">
    {v}
  </a>
)
const Phone = ({ v }: { v: string }) => (
  <a href={telHref(v)} className="text-hgl-blue hover:underline">
    {v}
  </a>
)

type Data = {
  family: any
  students: any[]
  engagements: any[]
  sessions: any[]
  enrollments: any[]
  invoices: any[]
  acceptances: any[]
  leads: any[]
  scoresByClass: Record<string, any[]>
}

const CONTACT_METHOD_LABELS: Record<string, string> = {
  call: 'a phone call',
  text: 'a text',
  email: 'email',
}

// PL-232: the billing address — collected optionally at intake, editable
// here by admin AND manager (contact info, not an owner-level corner). No
// QBO auto-sync: the bookkeeper copies it when creating the QBO customer.
type Address = { street?: string | null; city?: string | null; region?: string | null; country?: string | null }
const addressLine = (a: Address | null) =>
  a ? [a.street, a.city, a.region, a.country].filter(Boolean).join(', ') : ''

function AddressEditor({
  familyId,
  address,
  onSaved,
}: {
  familyId: string
  address: Address | null
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [street, setStreet] = useState(address?.street ?? '')
  const [city, setCity] = useState(address?.city ?? '')
  const [region, setRegion] = useState(address?.region ?? '')
  const [country, setCountry] = useState(address?.country ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  if (!editing) {
    return (
      <span className="text-xs">
        {addressLine(address) || <span className="text-gray-400 italic">none on file</span>}{' '}
        <button onClick={() => setEditing(true)} className="text-hgl-blue underline">
          edit
        </button>
      </span>
    )
  }
  return (
    <span className="block text-xs space-y-1.5 mt-1">
      <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Street address" className="w-full border border-gray-300 rounded p-1.5" />
      <span className="grid grid-cols-3 gap-1.5">
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="border border-gray-300 rounded p-1.5" />
        <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="State/region + postal" className="border border-gray-300 rounded p-1.5" />
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className="border border-gray-300 rounded p-1.5" />
      </span>
      {err && <span className="block text-red-600">{err}</span>}
      <span className="flex gap-2">
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            setErr('')
            const empty = !street.trim() && !city.trim() && !region.trim() && !country.trim()
            const { error } = await supabase
              .from('families')
              .update({
                address: empty
                  ? null
                  : {
                      street: street.trim() || null,
                      city: city.trim() || null,
                      region: region.trim() || null,
                      country: country.trim() || null,
                    },
              })
              .eq('id', familyId)
            setSaving(false)
            if (error) setErr('Error: ' + error.message)
            else {
              setEditing(false)
              onSaved()
            }
          }}
          className="text-white bg-hgl-slate rounded px-2.5 py-1 font-semibold disabled:opacity-50"
        >
          Save
        </button>
        <button onClick={() => setEditing(false)} className="text-gray-500 underline">
          cancel
        </button>
      </span>
      <span className="block text-gray-400">
        Not synced to QuickBooks — the bookkeeper copies it when creating the QBO customer.
      </span>
    </span>
  )
}

export default function FamilyProfilePage() {
  const params = useParams<{ id: string }>()
  const familyId = params?.id ?? ''
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState('household')

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const student = q.get('student')
    const section = q.get('section')
    if (student) setActive(`student-${student}`)
    else if (section) setActive(section)
  }, [])

  const load = useCallback(async () => {
    if (!familyId) return
    const { data: family, error: fErr } = await supabase
      .from('families')
      .select(
        `id, parent_first_name, parent_last_name, parent_email, parent_phone,
         guardian2_name, guardian2_email, guardian2_phone,
         billing_email, billing_cc_emails, autopay, timezone, marketing_opt_out,
         billing_notes, address, created_at`
      )
      .eq('id', familyId)
      .maybeSingle()
    if (fErr || !family) {
      setError(fErr?.message ?? 'No family with this id.')
      return
    }

    const { data: students } = await supabase
      .from('students')
      .select(
        `id, first_name, last_name, pronouns, student_email, student_phone, school,
         grade_level, graduating_year, special_needs, created_at`
      )
      .eq('family_id', familyId)
      .order('first_name')
    const studentIds = (students ?? []).map((s) => s.id)

    const [engRes, sessRes, enrRes, invRes, accRes, leadByStudentRes, leadByEmailRes] =
      await Promise.all([
        studentIds.length
          ? supabase
              .from('tutoring_engagements')
              .select(
                `id, student_id, hourly_rate, funding, recurrence, location, status, start_date,
                 end_date, addon_id, subjects ( name ), instructors ( name )`
              )
              .in('student_id', studentIds)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] } as any),
        studentIds.length
          ? supabase
              .from('tutoring_sessions')
              .select('id, student_id, starts_at, duration_minutes, status, engagement_id, reschedule_notice')
              .in('student_id', studentIds)
              .order('starts_at', { ascending: false })
              .limit(600)
          : Promise.resolve({ data: [] } as any),
        studentIds.length
          ? supabase
              .from('enrollments')
              .select(
                `id, student_id, payment_status, enrolled_at, amount_paid, class_cancelled,
                 cancellation_outcome,
                 classes ( id, class_type, start_date, end_date, schools ( nickname, name ) ),
                 enrollment_addons ( id, hours, price_paid, source, purchased_at )`
              )
              .in('student_id', studentIds)
              .order('enrolled_at', { ascending: false })
          : Promise.resolve({ data: [] } as any),
        supabase
          .from('tutoring_invoices')
          .select('id, period, status, total, due_at, paid_at')
          .eq('family_id', familyId)
          .order('period', { ascending: false })
          .limit(24),
        supabase
          .from('agreement_acceptances')
          .select(
            'id, accepted_by_name, accepted_by_email, accepted_at, pdf_snapshot_path, agreement_templates ( title, version )'
          )
          .eq('family_id', familyId)
          .order('accepted_at', { ascending: false }),
        studentIds.length
          ? supabase
              .from('leads')
              .select('id, student_name, contact_name, contact_email, status, consult_at, consult_owner_email, consult_mode, notes, intake, created_at, student_id')
              .in('student_id', studentIds)
          : Promise.resolve({ data: [] } as any),
        family.parent_email
          ? supabase
              .from('leads')
              .select('id, student_name, contact_name, contact_email, status, consult_at, consult_owner_email, consult_mode, notes, intake, created_at, student_id')
              .ilike('contact_email', family.parent_email)
          : Promise.resolve({ data: [] } as any),
      ])

    const leadRows = [...((leadByStudentRes.data as any[]) ?? [])]
    for (const l of (leadByEmailRes.data as any[]) ?? []) {
      if (!leadRows.some((x) => x.id === l.id)) leadRows.push(l)
    }
    leadRows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

    const enrollments = (((enrRes.data as any[]) ?? []).map((e) => ({ ...e, classes: one(e.classes) })))
    const classIds = enrollments.map((e) => e.classes?.id).filter(Boolean)
    const scoresByClass: Record<string, any[]> = {}
    if (classIds.length > 0 && studentIds.length > 0) {
      const { data: classScores } = await supabase
        .from('student_scores')
        .select('student_id, class_id, test_label, total, taken_at')
        .in('student_id', studentIds)
        .in('class_id', classIds)
      for (const r of classScores ?? []) {
        ;(scoresByClass[`${r.student_id}:${r.class_id}`] ??= []).push(r)
      }
    }

    setD({
      family,
      students: (students as any[]) ?? [],
      engagements: (((engRes.data as any[]) ?? []).map((e) => ({
        ...e,
        subjects: one(e.subjects),
        instructors: one(e.instructors),
      }))),
      sessions: (sessRes.data as any[]) ?? [],
      enrollments,
      invoices: (invRes.data as any[]) ?? [],
      acceptances: (((accRes.data as any[]) ?? []).map((a) => ({
        ...a,
        agreement_templates: one(a.agreement_templates),
      }))),
      leads: leadRows,
      scoresByClass,
    })
  }, [familyId])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <div className="max-w-4xl mx-auto">
          <p className="text-sm text-red-600">{error}</p>
          <a href="/admin?tab=contacts" className="text-sm text-hgl-blue underline">
            ← Back to Contacts
          </a>
        </div>
      </div>
    )
  }
  if (!d) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <p className="max-w-4xl mx-auto text-sm text-gray-500">Loading…</p>
      </div>
    )
  }

  const fam = d.family
  const parentName = `${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim() || '—'
  const familyLabel =
    (fam.parent_last_name ?? '').trim() ||
    (d.students[0]?.last_name ?? '').trim() ||
    parentName

  // The intake protocol card reads the freshest intake on file for anyone in
  // the household (contact prefs are household-level answers).
  const intake = d.leads.find((l) => l.intake)?.intake ?? null
  const protocolLine =
    intake?.absentContactWho
      ? `If the student hasn't arrived: ${intake.absentContactHow === 'text' ? 'text' : 'call'} the ${intake.absentContactWho}.`
      : null

  const latestAcceptance = d.acceptances[0] ?? null
  const activeTutoring = d.engagements.some((e) => e.status === 'active')

  const entries: SidebarEntry[] = [
    { id: 'household', label: 'Household' },
    ...d.students.map((s) => ({ id: `student-${s.id}`, label: `${s.first_name} ${s.last_name}`.trim() })),
    { id: 'billing', label: 'Billing' },
    { id: 'comms', label: 'Communications' },
    { id: 'prospect', label: 'Prospect & consults' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-hgl-slate">The {familyLabel} family</h1>
            <p className="text-sm text-gray-500 mt-1">
              {parentName}
              {d.students.length > 0 &&
                ` · ${d.students.map((s) => s.first_name).join(', ')}`}
              {fam.timezone && ` · ${fam.timezone}`}
            </p>
          </div>
          <a
            href="/admin?tab=contacts"
            className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate"
          >
            ← Contacts
          </a>
        </div>

        <SidebarLayout entries={entries} active={active} onSelect={setActive}>
          {/* ------------------------------------------------ Household */}
          <SidebarPanel id="household" active={active}>
            <div className="space-y-6">
              {/* The "who do I contact right now?" card — answerable at a
                  glance, never buried in intake answers. */}
              <div className="bg-white rounded-lg shadow-md p-5">
                <h2 className="text-lg font-bold text-hgl-slate mb-2">Who do I contact?</h2>
                <p className="text-sm text-gray-800">
                  <span className="font-semibold">{parentName}</span>
                  {intake?.preferredContactMethod && (
                    <> — prefers {CONTACT_METHOD_LABELS[intake.preferredContactMethod] ?? intake.preferredContactMethod}</>
                  )}
                </p>
                <p className="text-sm text-gray-700 mt-0.5">
                  {fam.parent_email && <Email v={fam.parent_email} />}
                  {fam.parent_email && fam.parent_phone && ' · '}
                  {fam.parent_phone && <Phone v={fam.parent_phone} />}
                  {!fam.parent_email && !fam.parent_phone && 'No contact info on file.'}
                </p>
                {protocolLine && (
                  <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
                    {protocolLine}
                  </p>
                )}
                {intake?.emergencyName && (
                  <p className="text-xs text-gray-500 mt-2">
                    Emergency contact: {intake.emergencyName}
                    {intake.emergencyRelation && ` (${intake.emergencyRelation})`}
                    {intake.emergencyPhone && <> · <Phone v={intake.emergencyPhone} /></>}
                  </p>
                )}
              </div>

              <CollapsibleSection title="Household" subtitle="Guardians, portal access, agreement, preferences" defaultOpen>
                <div className="text-sm space-y-4">
                  <div>
                    <p className="font-semibold text-hgl-slate">
                      {parentName}
                      <span className="ml-2 text-xs font-normal text-gray-500">parent</span>
                    </p>
                    <p className="text-xs text-gray-600">
                      {fam.parent_email && <Email v={fam.parent_email} />}
                      {fam.parent_email && fam.parent_phone && ' · '}
                      {fam.parent_phone && <Phone v={fam.parent_phone} />}
                    </p>
                    {fam.guardian2_name && (
                      <p className="text-xs text-gray-600 mt-1">
                        <span className="font-semibold">{fam.guardian2_name}</span>
                        <span className="ml-2 text-[10px] uppercase text-gray-400">second guardian</span>
                        <br />
                        {fam.guardian2_email && <Email v={fam.guardian2_email} />}
                        {fam.guardian2_email && fam.guardian2_phone && ' · '}
                        {fam.guardian2_phone && <Phone v={fam.guardian2_phone} />}
                      </p>
                    )}
                  </div>

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    <div>
                      <dt className="text-xs font-semibold text-gray-500">Portal access</dt>
                      <dd className="text-xs">
                        Signs in with {fam.parent_email ?? 'their email'} — no password, we email a
                        login link.
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500">Policy agreement</dt>
                      <dd className="text-xs">
                        {latestAcceptance ? (
                          <span className="text-emerald-700 font-semibold">
                            Accepted{latestAcceptance.agreement_templates?.version != null && ` v${latestAcceptance.agreement_templates.version}`}{' '}
                            by {latestAcceptance.accepted_by_name ?? latestAcceptance.accepted_by_email},{' '}
                            {formatDateShort(latestAcceptance.accepted_at)}
                          </span>
                        ) : activeTutoring ? (
                          <span className="text-red-700 font-semibold">
                            Not accepted — active tutoring without a signed agreement
                          </span>
                        ) : (
                          <span className="text-gray-500">Not accepted</span>
                        )}
                        {' · '}
                        <a href={`/admin/agreements?family=${fam.id}`} className="text-hgl-blue underline">
                          agreements panel
                        </a>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500">Autopay</dt>
                      <dd className="text-xs">{fam.autopay ? 'On — confirmed invoices charge automatically' : 'Off — invoices are paid by hand'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500">Marketing emails</dt>
                      <dd className="text-xs">
                        {fam.marketing_opt_out
                          ? 'Opted out — offers and announcements are suppressed'
                          : 'Receiving offers and announcements'}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold text-gray-500">Billing address</dt>
                      <dd>
                        <AddressEditor
                          key={addressLine(fam.address)}
                          familyId={fam.id}
                          address={fam.address ?? null}
                          onSaved={load}
                        />
                      </dd>
                    </div>
                    {fam.billing_email && (
                      <div>
                        <dt className="text-xs font-semibold text-gray-500">Billing email</dt>
                        <dd className="text-xs"><Email v={fam.billing_email} /></dd>
                      </div>
                    )}
                    {(fam.billing_cc_emails ?? []).length > 0 && (
                      <div>
                        <dt className="text-xs font-semibold text-gray-500">Billing cc</dt>
                        <dd className="text-xs space-x-1">
                          {(fam.billing_cc_emails as string[]).map((e, i) => (
                            <span key={e}>
                              {i > 0 && ' · '}
                              <Email v={e} />
                            </span>
                          ))}
                        </dd>
                      </div>
                    )}
                    {fam.billing_notes && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold text-gray-500">Billing notes</dt>
                        <dd className="text-xs">{fam.billing_notes}</dd>
                      </div>
                    )}
                  </dl>

                  {d.acceptances.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-1">Signed agreements</p>
                      <ul className="space-y-0.5">
                        {d.acceptances.map((a) => (
                          <li key={a.id} className="text-xs">
                            <span className="font-semibold">{a.agreement_templates?.title ?? 'Agreement'}</span>
                            {a.agreement_templates?.version != null && ` v${a.agreement_templates.version}`}
                            {' — accepted by '}
                            {a.accepted_by_name ?? a.accepted_by_email ?? '—'} on {fmtWhen(a.accepted_at)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            </div>
          </SidebarPanel>

          {/* ------------------------------------------------ Per student */}
          {d.students.map((st) => {
            const fullName = `${st.first_name} ${st.last_name}`.trim()
            const engagements = d.engagements.filter((e) => e.student_id === st.id)
            const sessions = d.sessions.filter((s) => s.student_id === st.id)
            const enrollments = d.enrollments.filter((e) => e.student_id === st.id)
            const consults = d.leads.filter((l) => l.student_id === st.id && l.consult_at)
            const upcoming = sessions.filter(
              (s) => s.status === 'confirmed' && new Date(s.starts_at) > new Date()
            )
            const completedHours = sessions
              .filter((s) => s.status === 'completed')
              .reduce((a, s) => a + s.duration_minutes / 60, 0)
            // PL-197: package drawdown, NEVER capped — same rule as billing.
            const usedOnAddon = (addonId: string) => {
              const engIds = new Set(engagements.filter((e) => e.addon_id === addonId).map((e) => e.id))
              return sessions
                .filter((s) => engIds.has(s.engagement_id))
                .filter((s) =>
                  ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'].includes(s.status)
                )
                .filter((s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late')
                .reduce((sum, s) => sum + s.duration_minutes / 60, 0)
            }
            return (
              <SidebarPanel key={st.id} id={`student-${st.id}`} active={active}>
                <div className="space-y-6">
                  <div className="bg-white rounded-lg shadow-md p-5">
                    <h2 className="text-lg font-bold text-hgl-slate">
                      {fullName}
                      {pronounsDisplayLabel(st.pronouns) && (
                        <span className="text-sm font-normal text-gray-500 ml-2">
                          ({pronounsDisplayLabel(st.pronouns)})
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {[st.grade_level && `Grade ${st.grade_level}`, st.graduating_year && `class of ${st.graduating_year}`, st.school]
                        .filter(Boolean)
                        .join(' · ') || 'Student'}
                    </p>
                    <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-3">
                      <div>
                        <dt className="text-xs font-semibold text-gray-500">Email</dt>
                        <dd className="text-xs">{st.student_email ? <Email v={st.student_email} /> : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-gray-500">Phone</dt>
                        <dd className="text-xs">{st.student_phone ? <Phone v={st.student_phone} /> : '—'}</dd>
                      </div>
                      {st.special_needs && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-gray-500">Learning notes</dt>
                          <dd className="text-xs">{st.special_needs}</dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  <CollapsibleSection
                    title="Schedule"
                    subtitle={`${upcoming.length} upcoming session${upcoming.length === 1 ? '' : 's'} · ${completedHours
                      .toFixed(1)
                      .replace(/\.0$/, '')}h completed`}
                    defaultOpen
                  >
                    <div className="text-sm space-y-4">
                      {consults.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600 mb-1">Consultation</p>
                          <ul className="space-y-0.5">
                            {consults.map((c) => (
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
                      {engagements.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600 mb-1">1-on-1 tutoring</p>
                          <ul className="space-y-0.5">
                            {engagements.map((e) => (
                              <li key={e.id} className="text-xs">
                                {e.subjects?.name ?? 'Tutoring'} with {e.instructors?.name ?? '—'} —{' '}
                                {engStatus(e.status)}
                                {e.start_date && ` · since ${formatDateShort(e.start_date)}`}
                                {' · '}
                                <span className="text-gray-500">{money(e.hourly_rate)}/h</span>
                                {' · '}
                                <a href={`/admin/tutoring?family=${fam.id}`} className="text-hgl-blue underline">
                                  manage
                                </a>
                              </li>
                            ))}
                          </ul>
                          {upcoming.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                              Next:{' '}
                              {fmtWhenRange(
                                upcoming[upcoming.length - 1].starts_at,
                                upcoming[upcoming.length - 1].duration_minutes
                              )}
                            </p>
                          )}
                        </div>
                      )}
                      {enrollments.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600 mb-1">Classes</p>
                          <ul className="space-y-1">
                            {enrollments.map((e) => {
                              const cls = e.classes
                              const scores = (cls && d.scoresByClass[`${st.id}:${cls.id}`]) || []
                              return (
                                <li key={e.id} className="text-xs">
                                  <a href={`/admin?class=${cls?.id ?? ''}`} className="text-hgl-blue underline">
                                    {one<any>(cls?.schools)?.nickname ?? ''} {cls?.class_type ?? 'class'}
                                  </a>
                                  {cls?.start_date &&
                                    ` · ${formatDateShort(cls.start_date)}–${cls.end_date ? formatDateShort(cls.end_date) : ''}`}
                                  {e.class_cancelled && ' · class cancelled'}
                                  {scores.length > 0 && (
                                    <span className="text-gray-600">
                                      {' — '}
                                      {scores
                                        .slice()
                                        .sort((a: any, b: any) =>
                                          String(a.test_label).localeCompare(String(b.test_label))
                                        )
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
                      {consults.length === 0 && engagements.length === 0 && enrollments.length === 0 && (
                        <p className="text-gray-500 italic">No schedule history yet.</p>
                      )}
                    </div>
                  </CollapsibleSection>

                  {(engagements.length > 0 ||
                    enrollments.some((e) => (e.enrollment_addons ?? []).length > 0)) && (
                    <CollapsibleSection
                      title="Rates & packages"
                      subtitle={`${st.first_name}'s pricing — invoices live under Billing`}
                      defaultOpen
                    >
                      <div className="text-sm space-y-4">
                        {engagements.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-600 mb-1">Tutoring rates</p>
                            <ul className="space-y-0.5">
                              {engagements.map((e) => (
                                <li key={e.id} className="text-xs">
                                  {e.subjects?.name ?? 'Tutoring'} with {e.instructors?.name ?? '—'} —{' '}
                                  <span className="font-semibold">{money(e.hourly_rate)}/h</span>
                                  {' · '}
                                  {e.funding === 'package' ? 'billed against an hours package' : 'monthly invoice'}
                                  {' · '}
                                  {engStatus(e.status)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {enrollments.some((e) => (e.enrollment_addons ?? []).length > 0) && (
                          <div>
                            <p className="text-xs font-semibold text-gray-600 mb-1">Hours packages</p>
                            <ul className="space-y-0.5">
                              {enrollments.flatMap((e) =>
                                ((e.enrollment_addons ?? []) as any[]).map((a, i) => {
                                  const used = a.id ? usedOnAddon(a.id) : 0
                                  const over = Math.max(0, used - Number(a.hours))
                                  return (
                                    <li key={`${e.id}-${i}`} className="text-xs">
                                      {Number(a.hours)}h — {money(a.price_paid)}
                                      {a.source === 'cancellation_conversion' && ' (from a class cancellation)'}
                                      {a.purchased_at && ` · ${formatDateShort(a.purchased_at)}`}
                                      {used > 0 && over <= 0 && (
                                        <span className="text-gray-500">
                                          {' '}· {used.toFixed(1)} of {Number(a.hours)}h used
                                        </span>
                                      )}
                                      {over > 0 && (
                                        <span className="text-red-600 font-semibold">
                                          {' '}· {used.toFixed(1)} of {Number(a.hours)}h used — {over.toFixed(1)}h over
                                        </span>
                                      )}
                                    </li>
                                  )
                                })
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    </CollapsibleSection>
                  )}

                  <CollapsibleSection
                    title="Test scores"
                    subtitle="Full history — every surface writes to this same store"
                    defaultOpen
                  >
                    <ScoresEntry classId={null} students={[{ id: st.id, name: fullName }]} />
                  </CollapsibleSection>
                </div>
              </SidebarPanel>
            )
          })}

          {/* ------------------------------------------------ Billing */}
          <SidebarPanel id="billing" active={active}>
            <CollapsibleSection
              title="Billing"
              subtitle="Family invoices, autopay, and class payments"
              defaultOpen
            >
              <div className="text-sm space-y-4">
                <p className="text-xs text-gray-600">
                  Autopay: <span className="font-semibold">{fam.autopay ? 'on' : 'off'}</span>
                  {fam.billing_email && (
                    <>
                      {' '}· billing email <Email v={fam.billing_email} />
                    </>
                  )}
                </p>
                {d.invoices.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1">Tutoring invoices</p>
                    <ul className="space-y-0.5">
                      {d.invoices.map((inv) => (
                        <li key={inv.id} className="text-xs">
                          <a href={`/admin/tutoring?invoice=${inv.id}`} className="text-hgl-blue underline">
                            {inv.period}
                          </a>{' '}
                          — {money(inv.total)} ·{' '}
                          {inv.paid_at ? `paid ${formatDateShort(inv.paid_at)}` : inv.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 italic">No tutoring invoices yet.</p>
                )}
                {d.enrollments.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1">Class payments</p>
                    <ul className="space-y-0.5">
                      {d.enrollments.map((e) => {
                        const st = d.students.find((s) => s.id === e.student_id)
                        return (
                          <li key={e.id} className="text-xs">
                            {st ? `${st.first_name} — ` : ''}
                            {one<any>(e.classes?.schools)?.nickname ?? ''} {e.classes?.class_type ?? 'class'} —{' '}
                            {e.amount_paid != null ? money(e.amount_paid) : e.payment_status}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          </SidebarPanel>

          {/* ------------------------------------------------ Communications */}
          <SidebarPanel id="comms" active={active}>
            <CollapsibleSection
              title="Communications"
              subtitle="Everything this family was sent, newest first"
              defaultOpen
            >
              <FamilyCommsTimeline familyId={fam.id} />
            </CollapsibleSection>
          </SidebarPanel>

          {/* ------------------------------------------------ Prospect trail */}
          <SidebarPanel id="prospect" active={active}>
            <CollapsibleSection
              title="Prospect & consults"
              subtitle="How this family found us — pipeline records and consult notes"
              defaultOpen
            >
              {d.leads.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No pipeline history on file.</p>
              ) : (
                <ul className="text-sm space-y-3">
                  {d.leads.map((l) => (
                    <li key={l.id} className="text-xs border-l-2 border-gray-200 pl-3">
                      <p>
                        <a href={`/admin/leads?lead=${l.id}`} className="text-hgl-blue underline font-semibold">
                          {l.student_name ?? l.contact_name ?? 'Pipeline record'}
                        </a>
                        {' · '}
                        {formatDateShort(l.created_at)}
                        {l.status && <span className="text-gray-500"> · {String(l.status).replace(/_/g, ' ')}</span>}
                      </p>
                      {l.consult_at && (
                        <p className="text-gray-600 mt-0.5">
                          Consult {fmtWhen(l.consult_at)}
                          {l.consult_mode === 'phone' ? ' — happened by phone' : ''}
                          {l.consult_owner_email && ` · with ${l.consult_owner_email}`}
                        </p>
                      )}
                      {l.notes && <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">{l.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CollapsibleSection>
          </SidebarPanel>
        </SidebarLayout>
      </div>
    </div>
  )
}
