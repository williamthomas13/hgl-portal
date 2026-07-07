import type { SupabaseClient } from '@supabase/supabase-js'
import SessionCalendar, { type CalendarSession } from '../components/SessionCalendar'
import { supabaseAdmin } from '../utils/supabase-admin'
import { resumePaymentUrlFor } from '../utils/lifecycle'
import { StatusBadge, ScoresTable, formatDate, formatDateShort, one, type ScoreRow } from './shared'

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
    .ilike('parent_email', email)
  const familyIds = (familyRows ?? []).map((f) => f.id)

  const { data: students } = await supabase
    .from('students')
    .select(
      `
      id, first_name, last_name, student_email, grade_level, graduating_year,
      schools ( name, nickname ),
      student_scores ( id, test_label, section_scores, total, taken_at, class_id ),
      enrollments (
        id, payment_status, enrolled_at, paid_at, amount_paid, stripe_payment_intent_id,
        enrollment_addons ( hours, price_paid, tutoring_packages ( name ) ),
        classes (
          id, status, class_type, school_nickname, instructor_name, default_location, delivery_mode,
          price, start_date,
          schools ( name, nickname ),
          sessions ( session_date, start_time, end_time, location )
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

  // Waitlist positions need a privileged count; collect them up front.
  const positions = new Map<string, number>()
  for (const st of students as any[]) {
    for (const e of st.enrollments ?? []) {
      const cls = one<any>(e.classes)
      if (e.payment_status === 'Waitlisted' && cls) {
        positions.set(e.id, await waitlistPosition(e.id, cls.id, e.enrolled_at))
      }
    }
  }

  return (
    <div className="space-y-6">
      {(students as any[]).map((st) => {
        const school = one<any>(st.schools)
        const scores: ScoreRow[] = st.student_scores ?? []
        const enrollments = [...(st.enrollments ?? [])].sort((a: any, b: any) =>
          (b.enrolled_at ?? '').localeCompare(a.enrolled_at ?? '')
        )
        return (
          <div key={st.id} className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-6">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-hgl-slate">
                {st.first_name} {st.last_name}
              </h2>
              <p className="text-sm text-gray-500">
                {school?.name ?? '—'}
                {st.grade_level ? ` · Grade ${st.grade_level}` : ''}
                {st.graduating_year ? ` · Class of ${st.graduating_year}` : ''}
              </p>
            </div>

            {enrollments.length === 0 && (
              <p className="text-sm text-gray-500">No class registrations yet.</p>
            )}

            <div className="space-y-4">
              {enrollments.map((e: any) => {
                const cls = one<any>(e.classes)
                if (!cls) return null
                const clsSchool = one<any>(cls.schools)
                const label = `${clsSchool?.nickname ?? cls.school_nickname ?? 'HGL'} ${cls.class_type}`
                const sessions: CalendarSession[] = cls.sessions ?? []
                const highlighted = e.id === highlightEnrollment
                const addons = (e.enrollment_addons ?? []).map((a: any) => ({
                  name: one<any>(a.tutoring_packages)?.name ?? 'Tutoring package',
                  hours: Number(a.hours),
                  pricePaid: Number(a.price_paid),
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
                          Starts {formatDate(cls.start_date)}
                          {cls.instructor_name
                            ? ` · Instructor: ${cls.instructor_name}`
                            : showPlaceholders
                              ? ' · Instructor: details coming soon'
                              : ''}
                        </p>
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
                        <SessionCalendar
                          sessions={sessions}
                          defaultLocation={cls.default_location}
                          calendarHref={`/classes/${cls.id}/calendar`}
                        />
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
                                <span className="text-gray-400"> · ref {e.stripe_payment_intent_id}</span>
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

                    <ScoresTable scores={classScores} />
                  </div>
                )
              })}
            </div>

            {/* Scores not tied to a class (e.g. standalone diagnostics) */}
            <ScoresTable scores={scores.filter((s) => !s.class_id)} />
          </div>
        )
      })}
    </div>
  )
}
