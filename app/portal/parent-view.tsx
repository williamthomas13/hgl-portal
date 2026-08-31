import type { SupabaseClient } from '@supabase/supabase-js'
import SessionCalendar, { type CalendarSession } from '../components/SessionCalendar'
import { supabaseAdmin } from '../utils/supabase-admin'
import {
  addonPageUrlFor,
  availabilityUrlFor,
  loadTutoringPackages,
  packageSavings,
  resumePaymentUrlFor,
} from '../utils/lifecycle'
import { DISCOUNT_URL } from '../utils/email'
import TutoringAddonCard, { type TutoringCardState } from './tutoring-addon-card'
import { StatusBadge, ScoresTable, formatDate, formatDateShort, one, type ScoreRow } from './shared'
import { FamilyMaterialsSection, StudentMaterialsRecord } from './materials-panel'
import { summarizeAttendance, type AttendanceRecord } from '../utils/attendance'
import { bySessionStart, effectiveStartDate, publicTimeCityLabel } from '../utils/dates'
import TutoringSection from './tutoring-section'
import PortalNav, { type PortalNavItem } from './portal-nav'
import { escapeLike } from '../utils/like-escape'

// Parent view (PHASE4_SPEC §3): one card per student, their enrollments with
// status/instructor/location, the session calendar, receipts, and diagnostic
// scores (dark until ingestion exists). Every query runs as the signed-in
// parent under RLS — the only privileged read is the waitlist position, which
// needs other families' rows to count and so goes through the service client.

/* eslint-disable @typescript-eslint/no-explicit-any */

async function waitlistPosition(enrollmentId: string, classId: string, enrolledAt: string) {
  const { count } = await supabaseAdmin
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('payment_status', 'Waitlisted')
    .lte('enrolled_at', enrolledAt)
  return count ?? 1
}

export default async function ParentView({
  supabase,
  email,
  highlightEnrollment,
}: {
  supabase: SupabaseClient
  email: string
  highlightEnrollment?: string
}) {
  // Scope to the families billed to this email — staff can read every row
  // under RLS, and a staff member who is also a parent should only see their
  // own kids here.
  const { data: familyRows } = await supabase
    .from('families')
    .select('id')
    .ilike('parent_email', escapeLike(email))
  const familyIds = (familyRows ?? []).map((f) => f.id)

  const { data: students } = await supabase
    .from('students')
    .select(
      `
      id, first_name, last_name, student_email, grade_level, graduating_year, school_id, family_id,
      schools ( name, nickname, timezone ),
      student_scores ( id, test_label, section_scores, total, taken_at, class_id ),
      enrollments (
        id, payment_status, enrolled_at, paid_at, amount_paid, stripe_payment_intent_id,
        enrollment_addons ( id, hours, price_paid, tutoring_timing, tutoring_packages ( name ) ),
        product_orders ( id, status, quantity, tracking_url, shipped_at, products ( name ) ),
        attendance_records ( session_id, enrollment_id, present, arrived_late, left_early, minutes_late, minutes_left_early ),
        classes (
          id, slug, status, class_type, default_location, delivery_mode,
          price, start_date, synap_group, timezone, display_cities,
          schools ( name, nickname, timezone, city ),
          instructors ( name, email ),
          sessions ( id, session_date, start_time, end_time, location )
        )
      )
    `
    )
    .in('family_id', familyIds)
    .order('first_name')

  if (!students || students.length === 0) {
    return (
      <p className="text-gray-500 bg-white rounded-lg border p-6">
        No students found for your account yet. If you recently registered, this can take a
        moment — or just reply to any of our emails and we&apos;ll sort it out.
      </p>
    )
  }

  // PL-11: which students already have an active tutoring schedule — the
  // add-on hours card points at the tutoring section instead of implying
  // nothing is set up.
  const { data: activeEngagements } = await supabase
    .from('tutoring_engagements')
    .select('student_id')
    .in('student_id', (students as any[]).map((s) => s.id))
    .eq('status', 'active')
  const scheduledStudentIds = new Set((activeEngagements ?? []).map((e) => e.student_id))

  // PL-207: the card's remaining inputs — shared-availability presence per
  // student (service client: availability rows have no parent RLS read) and
  // the live package pricing both card and emails draw from.
  const [{ data: availRows }, tutoringPackages] = await Promise.all([
    supabaseAdmin
      .from('student_availability')
      .select('student_id')
      .in('student_id', (students as any[]).map((s) => s.id)),
    loadTutoringPackages(),
  ])
  const availStudentIds = new Set((availRows ?? []).map((r: any) => r.student_id))

  // Duplicate student rows (same kid registered twice before the family-match
  // fix in utils/registration.ts, or seeded test data) render as ONE card
  // with all their enrollments — mirror the registration matcher: same
  // student email, else same name. Data stays untouched; the warn surfaces
  // rows worth merging in the DB.
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const studentList: any[] = []
  for (const st of students as any[]) {
    const dup = studentList.find(
      (s) =>
        (st.student_email && norm(s.student_email) === norm(st.student_email)) ||
        (norm(s.first_name) === norm(st.first_name) && norm(s.last_name) === norm(st.last_name))
    )
    if (!dup) {
      studentList.push({ ...st })
      continue
    }
    console.warn(
      `parent-view: duplicate student rows merged for display — ${st.first_name} ${st.last_name} (${dup.id}, ${st.id})`
    )
    dup.enrollments = [...(dup.enrollments ?? []), ...(st.enrollments ?? [])]
    dup.student_scores = [...(dup.student_scores ?? []), ...(st.student_scores ?? [])]
    // Keep the more complete profile fields from whichever row has them.
    dup.student_email ??= st.student_email
    dup.school_id ??= st.school_id
    dup.schools ??= st.schools
    dup.grade_level ??= st.grade_level
    dup.graduating_year ??= st.graduating_year
  }

  // Waitlist positions need a privileged count; collect them up front.
  const positions = new Map<string, number>()
  for (const st of studentList) {
    for (const e of st.enrollments ?? []) {
      const cls = one<any>(e.classes)
      if (e.payment_status === 'Waitlisted' && cls) {
        positions.set(e.id, await waitlistPosition(e.id, cls.id, e.enrolled_at))
      }
    }
  }

  const today = new Date().toLocaleDateString('en-CA')

  const fmtTime = (t: string | null) => {
    if (!t) return null
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 === 0 ? 12 : h % 12
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
  }

  // C3 "you might be interested in": per student, the follow-up pointer from
  // any of their classes, else an open class at their school they're not in.
  // Parents can't read other classes under RLS, so this is a privileged read
  // (like the waitlist position) — sanitized to one name+link card.
  const suggestions = new Map<string, { label: string; startDate: string; href: string }>()
  for (const st of studentList) {
    const enrolledClassIds = new Set(
      (st.enrollments ?? []).map((e: any) => one<any>(e.classes)?.id).filter(Boolean)
    )
    const followOnIds = (st.enrollments ?? [])
      .filter((e: any) => ['Paid', 'Completed'].includes(e.payment_status))
      .map((e: any) => one<any>(e.classes)?.follow_on_class_id)
      .filter(Boolean)
    let candidates: any[] = []
    if (followOnIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('classes')
        .select('id, slug, class_type, status, start_date, registration_close_date, schools ( nickname )')
        .in('id', followOnIds)
      candidates = data ?? []
    }
    if (candidates.length === 0 && st.school_id) {
      const { data } = await supabaseAdmin
        .from('classes')
        .select('id, slug, class_type, status, start_date, registration_close_date, schools ( nickname )')
        .eq('school_id', st.school_id)
        .eq('status', 'open')
        .gte('start_date', today)
      candidates = data ?? []
    }
    const pick = candidates.find(
      (c: any) =>
        c.status === 'open' &&
        !enrolledClassIds.has(c.id) &&
        today <= (c.registration_close_date ?? c.start_date)
    )
    if (pick) {
      suggestions.set(st.id, {
        label: `${one<any>(pick.schools)?.nickname ?? 'HGL'} ${pick.class_type}`,
        startDate: pick.start_date,
        href: `/register/${pick.slug ?? pick.id}`,
      })
    }
  }

  // C1: one prominent callout per ACTIVE enrollment — next session once the
  // class is running; the "upcoming class" info card (mirrors email #2)
  // before session 1.
  const callouts: React.ReactNode[] = []
  for (const st of studentList) {
    for (const e of st.enrollments ?? []) {
      if (e.payment_status !== 'Paid') continue
      const cls = one<any>(e.classes)
      if (!cls || cls.status === 'cancelled') continue
      const sessions = [...(cls.sessions ?? [])].sort(bySessionStart)
      const next = sessions.find((s: any) => s.session_date >= today)
      if (!next) continue
      const clsSchool = one<any>(cls.schools)
      const label = `${clsSchool?.nickname ?? 'HGL'} ${cls.class_type}`
      const firstSession = sessions[0]?.session_date ?? cls.start_date
      const preStart = today < firstSession
      const time = fmtTime(next.start_time)
      const endTime = fmtTime(next.end_time)
      const location = next.location ?? cls.default_location
      const synap = cls.synap_group
        ? /^https?:\/\//i.test(cls.synap_group)
          ? cls.synap_group
          : `https://${cls.synap_group}`
        : null
      const diagnosticDue = new Date(`${firstSession}T12:00:00Z`)
      diagnosticDue.setUTCDate(diagnosticDue.getUTCDate() - 1)
      callouts.push(
        <div
          key={e.id}
          className="bg-hgl-slate text-white rounded-lg shadow-md p-5 flex items-start justify-between gap-4 flex-wrap"
        >
          <div>
            {preStart ? (
              <>
                <p className="text-xs uppercase tracking-wide opacity-75">
                  Upcoming class · {st.first_name}
                </p>
                <p className="text-lg font-bold">
                  {label} starts {formatDate(firstSession)}
                  {time ? `, ${time}${endTime ? `–${endTime}` : ''}` : ''}
                </p>
                <p className="text-sm opacity-90 mt-1">
                  {clsSchool?.name ?? ''} — first up: the diagnostic test, due{' '}
                  <strong>{formatDate(diagnosticDue.toISOString().slice(0, 10))}</strong>{' '}(the day
                  before class).
                </p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wide opacity-75">
                  Next class · {st.first_name} · {label}
                </p>
                <p className="text-lg font-bold">
                  {formatDate(next.session_date)}
                  {time ? `, ${time}${endTime ? `–${endTime}` : ''}` : ''}
                  {location ? (
                    /^https?:\/\//i.test(location) ? (
                      <>
                        {' · '}
                        <a href={location} className="underline">
                          meeting link
                        </a>
                      </>
                    ) : (
                      ` · ${location}`
                    )
                  ) : (
                    ''
                  )}
                </p>
              </>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 text-sm">
            <a
              href={`/classes/${cls.id}/calendar`}
              className="bg-white/15 hover:bg-white/25 rounded px-3 py-1.5 font-semibold"
            >
              Add to calendar
            </a>
            {preStart && synap && (
              <a
                href={synap}
                className="bg-hgl-blue hover:opacity-90 rounded px-3 py-1.5 font-bold"
              >
                Take the diagnostic test
              </a>
            )}
          </div>
        </div>
      )
    }
  }

  // PL-404: the left menu appears ONLY when the account's content warrants
  // it — per-student jump links when there's more than one student, plus a
  // tutoring link when the family actually has tutoring. One student, one
  // enrollment, no tutoring → fewer than two items → PortalNav renders
  // nothing and the page stays today's simple single column. The tutoring
  // probe mirrors TutoringSection's own gate (active/paused engagements or
  // any invoice) via the privileged client, same as the waitlist read.
  let hasTutoring = false
  if (familyIds.length > 0) {
    const [{ count: engCount }, { count: invCount }] = await Promise.all([
      supabaseAdmin
        .from('tutoring_engagements')
        .select('id, students!inner ( family_id )', { count: 'exact', head: true })
        .in('students.family_id', familyIds)
        .in('status', ['active', 'paused']),
      supabaseAdmin
        .from('tutoring_invoices')
        .select('id', { count: 'exact', head: true })
        .in('family_id', familyIds),
    ])
    hasTutoring = (engCount ?? 0) > 0 || (invCount ?? 0) > 0
  }
  const navItems: PortalNavItem[] = [
    ...(studentList.length > 1
      ? (studentList as any[]).map((st: any) => ({ href: `#student-${st.id}`, label: st.first_name as string }))
      : []),
    ...(hasTutoring ? [{ href: '#portal-tutoring', label: '1-on-1 tutoring' }] : []),
  ]

  return (
    <div className="md:flex md:gap-6 md:items-start">
      <PortalNav items={navItems} />
      <div className="flex-1 min-w-0 space-y-6">
      {callouts}
      {/* PL-203: materials tutors shared — renders only when something was
          shared; RLS + the API keep it to THIS family's students. */}
      <FamilyMaterialsSection
        studentNames={Object.fromEntries(
          (studentList as any[]).map((st: any) => [st.id, `${st.first_name}`])
        )}
      />
      {studentList.map((st) => {
        const school = one<any>(st.schools)
        const scores: ScoreRow[] = st.student_scores ?? []
        const enrollments = [...(st.enrollments ?? [])].sort((a: any, b: any) =>
          (b.enrolled_at ?? '').localeCompare(a.enrolled_at ?? '')
        )
        // Subtitle only when we have something to say — never a bare "—".
        const subtitle = [
          school?.name,
          st.grade_level ? `Grade ${st.grade_level}` : null,
          st.graduating_year ? `Class of ${st.graduating_year}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <div key={st.id} id={`student-${st.id}`} style={{ scrollMarginTop: 16 }} className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-6">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-hgl-slate">
                {st.first_name} {st.last_name}
              </h2>
              {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
            </div>

            {enrollments.length === 0 && (
              <p className="text-sm text-gray-500">No class registrations yet.</p>
            )}

            <div className="space-y-4">
              {enrollments.map((e: any) => {
                const cls = one<any>(e.classes)
                if (!cls) return null
                const clsSchool = one<any>(cls.schools)
                const label = `${clsSchool?.nickname ?? 'HGL'} ${cls.class_type}`
                const sessions: CalendarSession[] = cls.sessions ?? []
                const highlighted = e.id === highlightEnrollment
                const addons = (e.enrollment_addons ?? []).map((a: any) => ({
                  name: one<any>(a.tutoring_packages)?.name ?? 'Tutoring package',
                  hours: Number(a.hours),
                  pricePaid: Number(a.price_paid),
                }))
                // PL-364: notebook fulfillment, plainly — never a silent order.
                const productOrders = (e.product_orders ?? [])
                  .filter((po: any) => !['pending_payment', 'cancelled', 'refunded'].includes(po.status))
                  .map((po: any) => ({
                    id: po.id,
                    name: one<any>(po.products)?.name ?? 'Notebook',
                    quantity: Number(po.quantity),
                    status: po.status,
                    trackingUrl: po.tracking_url ?? null,
                    shippedAt: po.shipped_at ?? null,
                  }))
                const classScores = scores.filter((s) => s.class_id === cls.id)
                // "details coming soon" mirrors the #4 hold rule — it's a
                // promise, so only make it for enrollments where details are
                // actually coming: active status, class still ahead, not
                // cancelled. Expired/past cards just omit the blank fields.
                const sessionDates = sessions.map((s) => s.session_date).sort()
                const lastSession = sessionDates[sessionDates.length - 1] ?? cls.start_date
                const today = new Date().toLocaleDateString('en-CA')
                const showPlaceholders =
                  ['Pending', 'Paid', 'Waitlisted'].includes(e.payment_status) &&
                  cls.status !== 'cancelled' &&
                  today <= lastSession
                return (
                  <div
                    key={e.id}
                    id={`enrollment-${e.id}`}
                    className={`border rounded-lg p-4 ${
                      highlighted ? 'border-hgl-blue ring-2 ring-hgl-blue/30' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="font-bold text-hgl-slate">{label}</h3>
                        <p className="text-sm text-gray-600">
                          Starts {formatDate(effectiveStartDate(cls.start_date, sessions))}
                          {/* family-facing never says "TBD" (addendum §7.3) */}
                          {` · Instructor: ${one<any>(cls.instructors)?.name ?? one<any>(cls.instructors)?.email ?? 'to be announced'}`}
                        </p>
                        {productOrders.map((po: any) => (
                          <p key={po.id} className="text-sm text-gray-600">
                            {po.name}
                            {po.quantity > 1 ? ` × ${po.quantity}` : ''}:{' '}
                            {po.status === 'shipped' ? (
                              <>
                                shipped{po.shippedAt ? ` ${formatDate(String(po.shippedAt).slice(0, 10))}` : ''}
                                {po.trackingUrl && (
                                  <>
                                    {' — '}
                                    <a href={po.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-hgl-blue underline">
                                      track the package
                                    </a>
                                  </>
                                )}
                              </>
                            ) : (
                              'being prepared — tracking will appear here when it ships'
                            )}
                          </p>
                        ))}
                        {(cls.default_location || showPlaceholders) && (
                          <p className="text-sm text-gray-600">
                            {cls.delivery_mode === 'online' ? 'Meeting link' : 'Classroom'}:{' '}
                            {cls.default_location ? (
                              /^https?:\/\//i.test(cls.default_location) ? (
                                <a href={cls.default_location} className="text-hgl-blue underline">
                                  {cls.default_location}
                                </a>
                              ) : (
                                cls.default_location
                              )
                            ) : (
                              'details coming soon'
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge
                          status={e.payment_status}
                          detail={
                            e.payment_status === 'Waitlisted'
                              ? `position #${positions.get(e.id) ?? '—'}`
                              : undefined
                          }
                        />
                        {cls.status === 'cancelled' && (
                          <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold bg-red-100 text-red-700">
                            Class cancelled — see our email
                          </span>
                        )}
                      </div>
                    </div>

                    {e.payment_status === 'Pending' && (
                      <a
                        href={resumePaymentUrlFor(e.id)}
                        className="inline-block mt-3 bg-hgl-blue text-white text-sm font-bold py-2 px-4 rounded-md hover:bg-hgl-blue-hover transition"
                      >
                        Complete payment
                      </a>
                    )}

                    {sessions.length > 0 && (
                      <div className="mt-3">
                        {(() => {
                          // PL-418: the ONE public label resolver, fed the
                          // class's full facts — a "Room 204" HGL class says
                          // "Salt Lake City", never the zone city "Denver".
                          const clsSchool = one<any>(cls.schools)
                          const tz = cls.timezone ?? clsSchool?.timezone ?? null
                          return (
                            <SessionCalendar
                              sessions={sessions}
                              defaultLocation={cls.default_location}
                              calendarHref={`/classes/${cls.id}/calendar`}
                              localTimes
                              timezone={tz}
                              cityLabel={
                                tz
                                  ? publicTimeCityLabel({
                                      schoolCity: clsSchool?.city,
                                      displayCities: cls.display_cities,
                                      location: cls.default_location,
                                      timezone: tz,
                                      hglInPerson: !clsSchool && cls.delivery_mode !== 'online',
                                    })
                                  : null
                              }
                            />
                          )
                        })()}
                      </div>
                    )}

                    {(e.payment_status === 'Paid' ||
                      e.payment_status === 'Completed' ||
                      e.payment_status === 'Refunded') &&
                      e.amount_paid != null && (
                        <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-3 text-sm">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <span className="font-semibold text-hgl-slate">Receipt:</span>{' '}
                              ${Number(e.amount_paid).toLocaleString()}
                              {e.paid_at ? ` · ${formatDateShort(e.paid_at.slice(0, 10))}` : ''}
                              {e.stripe_payment_intent_id ? (
                                <span className="text-gray-500"> · ref {e.stripe_payment_intent_id}</span>
                              ) : null}
                              {addons.map((a: { name: string; pricePaid: number }, i: number) => (
                                <div key={i} className="text-gray-600">
                                  + {a.name} (1-on-1 tutoring) — ${a.pricePaid.toLocaleString()}
                                </div>
                              ))}
                            </div>
                            <a
                              href={`/api/receipts/${e.id}`}
                              className="text-xs border border-hgl-blue text-hgl-blue rounded px-2 py-1 font-semibold hover:bg-hgl-blue hover:text-white transition"
                            >
                              Download receipt (PDF)
                            </a>
                          </div>
                        </div>
                      )}

                    {/* C2: attendance — headline stats + per-session chips.
                        Instructor notes are internal and never selected here. */}
                    {(e.payment_status === 'Paid' || e.payment_status === 'Completed') &&
                      (() => {
                        const summary = summarizeAttendance(
                          (cls.sessions ?? []) as any,
                          (e.attendance_records ?? []) as AttendanceRecord[],
                          e.id,
                          today
                        )
                        if (summary.pastSessions === 0) return null
                        if (summary.recordedSessions === 0)
                          return (
                            <p className="mt-3 text-sm text-gray-500 italic">
                              Attendance will appear here after the first session.
                            </p>
                          )
                        return (
                          <div className="mt-3 border border-gray-200 rounded p-3">
                            <div className="flex items-baseline gap-4 flex-wrap">
                              <span className="text-sm font-semibold text-hgl-slate">Attendance</span>
                              <span className="text-sm">
                                Sessions attended:{' '}
                                <strong>
                                  {summary.sessionsAttended}/{summary.recordedSessions}
                                </strong>
                              </span>
                              {summary.percent != null && (
                                <span className="text-sm">
                                  Class time attended:{' '}
                                  <strong
                                    className={summary.percent >= 80 ? 'text-green-700' : 'text-amber-700'}
                                  >
                                    {summary.percent}%
                                  </strong>
                                </span>
                              )}
                            </div>
                            <ul className="mt-2 space-y-1 text-xs text-gray-600">
                              {summary.lines
                                .filter((l) => l.record)
                                .map((l) => (
                                  <li key={l.session.id} className="flex items-center gap-2">
                                    <span className="w-28">{formatDateShort(l.session.session_date)}</span>
                                    <span
                                      className={`inline-block px-2 py-0.5 rounded font-semibold ${
                                        l.statusLabel === 'Present'
                                          ? 'bg-green-100 text-green-700'
                                          : l.statusLabel === 'Absent'
                                            ? 'bg-red-100 text-red-600'
                                            : 'bg-amber-100 text-amber-800'
                                      }`}
                                    >
                                      {l.statusLabel}
                                    </span>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        )
                      })()}

                    <ScoresTable scores={classScores} />
                  </div>
                )
              })}
            </div>

            {/* C3: gentle upsell — at most ONE card, follow-up pointer first,
                open-class-at-their-school fallback. */}
            {suggestions.has(st.id) && (
              <div className="mt-4 border border-hgl-blue/30 bg-blue-50/50 rounded-lg p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
                <span>
                  <span className="font-semibold text-hgl-slate">You might be interested in:</span>{' '}
                  {suggestions.get(st.id)!.label} — starts {formatDate(suggestions.get(st.id)!.startDate)}
                </span>
                <a
                  href={suggestions.get(st.id)!.href}
                  className="bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-hgl-blue-hover"
                >
                  See details & register
                </a>
              </div>
            )}

            {/* PL-207: the 1-on-1 tutoring card is a state machine over
                (add-on purchased?) × (class not-started / running / finished)
                — every state does work instead of the old static line. */}
            {(() => {
              const todayIso = new Date().toLocaleDateString('en-CA')
              const paidEnrs = (st.enrollments ?? []).filter(
                (e: any) =>
                  ['Paid', 'Completed'].includes(e.payment_status) &&
                  one<any>(e.classes) &&
                  one<any>(e.classes).status !== 'cancelled'
              )
              const phaseOf = (cls: any): 'prestart' | 'running' | 'finished' => {
                const dates = (cls.sessions ?? []).map((s: any) => s.session_date).sort()
                const first = dates[0] ?? cls.start_date
                const last = dates[dates.length - 1] ?? cls.start_date
                return todayIso < first ? 'prestart' : todayIso > last ? 'finished' : 'running'
              }
              const addons = (st.enrollments ?? [])
                .filter((e: any) => ['Paid', 'Completed'].includes(e.payment_status))
                .flatMap((e: any) => e.enrollment_addons ?? [])
              const totalHours = addons.reduce((sum: number, a: any) => sum + Number(a.hours), 0)

              let cardState: TutoringCardState | null = null
              if (totalHours > 0) {
                // A (purchased): work the redemption; pointer once scheduled.
                cardState = {
                  kind: 'purchased',
                  totalHours,
                  hasSchedule: scheduledStudentIds.has(st.id),
                  hasAvailability: availStudentIds.has(st.id),
                  classRunning: paidEnrs.some((e: any) => phaseOf(one<any>(e.classes)) !== 'finished'),
                  availabilityUrl: `${availabilityUrlFor(st.family_id)}?src=card`,
                  timing: (addons.find((a: any) => a.tutoring_timing)?.tutoring_timing ?? null) as
                    | 'immediate'
                    | 'after_class'
                    | null,
                }
              } else if (paidEnrs.length > 0) {
                // B/C/D (no add-on): keyed to the most action-relevant class —
                // one still ahead beats one running beats the latest finished.
                const pick =
                  paidEnrs.find((e: any) => phaseOf(one<any>(e.classes)) === 'prestart') ??
                  paidEnrs.find((e: any) => phaseOf(one<any>(e.classes)) === 'running') ??
                  paidEnrs[paidEnrs.length - 1]
                const pickCls = one<any>(pick.classes)
                const phase = phaseOf(pickCls)
                // PL-322: the card quotes the price sheet for THIS class's
                // flavor (no school relation = open enrollment).
                const clsTier =
                  !one<any>(pickCls.schools) && pickCls.delivery_mode === 'in_person'
                    ? 'domestic'
                    : 'international'
                const prePkgs = tutoringPackages.pre.filter((p) => p.tier === clsTier)
                const postPkgs = tutoringPackages.post.filter((p) => p.tier === clsTier)
                if (phase === 'prestart' && prePkgs.length > 0) {
                  const dates = (pickCls.sessions ?? []).map((s: any) => s.session_date).sort()
                  cardState = {
                    kind: 'no_addon_prestart',
                    packages: prePkgs.map((p) => ({ hours: p.hours, savings: packageSavings(p) })),
                    addonUrl: addonPageUrlFor(pick.id),
                    firstSessionDate: formatDate(dates[0] ?? pickCls.start_date),
                  }
                } else if (phase === 'running') {
                  cardState = {
                    kind: 'no_addon_insession',
                    schoolNickname: one<any>(pickCls.schools)?.nickname ?? 'the',
                    classType: pickCls.class_type,
                  }
                } else if (phase === 'finished') {
                  cardState = {
                    kind: 'no_addon_finished',
                    packages: postPkgs.map((p) => ({ hours: p.hours, savings: packageSavings(p) })),
                    discountUrl: DISCOUNT_URL,
                  }
                }
              }
              if (!cardState) return null
              return (
                <TutoringAddonCard studentId={st.id} studentFirst={st.first_name} state={cardState} />
              )
            })()}

            {/* Scores not tied to a class (e.g. standalone diagnostics) */}
            <ScoresTable scores={scores.filter((s) => !s.class_id)} />

            {/* PL-411C: the settled Materials record — everything ever
                shared, grouped by month; renders nothing when empty. */}
            <StudentMaterialsRecord
              studentId={st.id}
              classIds={enrollments.map((e: any) => e.class_id).filter(Boolean)}
            />
          </div>
        )
      })}

      {/* Phase 7d: 1-on-1 tutoring — schedule, reschedule requests, billing */}
      <div id="portal-tutoring" style={{ scrollMarginTop: 16 }}>
        <TutoringSection email={email} />
      </div>
      </div>
    </div>
  )
}
