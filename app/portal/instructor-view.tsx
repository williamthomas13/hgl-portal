import type { SupabaseClient } from '@supabase/supabase-js'
import SessionCalendar from '../components/SessionCalendar'
import { StatusBadge, ScoresTable, formatDate, one, type ScoreRow } from './shared'

// Instructor view (PHASE4_SPEC §5): own classes with the session calendar,
// enrollment count vs min/capacity, Synap group link, and full-intake rosters
// (accommodations / previous scores / notes / diagnostic scores, paid vs
// pending). No payment amounts. The effective location is the class's own
// value or the instructor's default_meeting_link for online classes.

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function InstructorView({
  supabase,
  email,
}: {
  supabase: SupabaseClient
  email: string
}) {
  const [{ data: instructorRows }, { data: classes }] = await Promise.all([
    supabase.from('instructors').select('default_meeting_link').ilike('email', email),
    supabase
      .from('classes')
      .select(
        `
        id, class_type, school_nickname, delivery_mode, capacity, min_enrollment,
        start_date, instructor_email, instructor_name, default_location, synap_group,
        schools ( name, nickname ),
        sessions ( session_date, start_time, end_time, location ),
        enrollments (
          id, payment_status, accommodations, previous_scores, notes,
          students (
            id, first_name, last_name, student_email, grade_level, graduating_year,
            schools ( name, nickname )
          )
        )
      `
      )
      .ilike('instructor_email', email)
      .order('start_date', { ascending: false }),
  ])

  const defaultMeetingLink = instructorRows?.[0]?.default_meeting_link ?? null

  if (!classes || classes.length === 0) {
    return (
      <p className="text-gray-500 bg-white rounded-lg border p-6">No classes assigned to you yet.</p>
    )
  }

  const studentIds = new Set<string>()
  for (const c of classes as any[]) {
    for (const e of c.enrollments ?? []) {
      const st = one<any>(e.students)
      if (st) studentIds.add(st.id)
    }
  }
  const { data: allScores } = studentIds.size
    ? await supabase
        .from('student_scores')
        .select('id, student_id, class_id, test_label, section_scores, total, taken_at')
        .in('student_id', [...studentIds])
    : { data: [] as ScoreRow[] }

  const today = new Date().toLocaleDateString('en-CA')

  return (
    <div className="space-y-6">
      {(classes as any[]).map((c) => {
        const school = one<any>(c.schools)
        const label = `${school?.nickname ?? c.school_nickname ?? 'HGL'} ${c.class_type}`
        const sessions = [...(c.sessions ?? [])].sort((a: any, b: any) =>
          a.session_date.localeCompare(b.session_date)
        )
        const lastSession = sessions[sessions.length - 1]?.session_date ?? c.start_date
        const isPast = today > lastSession
        const active = (c.enrollments ?? []).filter(
          (e: any) => e.payment_status !== 'Expired' && e.payment_status !== 'Refunded'
        )
        const paidCount = active.filter(
          (e: any) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
        ).length
        const minEnrollment = c.min_enrollment ?? (c.delivery_mode === 'online' ? 3 : 8)
        // Effective location: class override → instructor default (online only).
        const location =
          c.default_location ?? (c.delivery_mode === 'online' ? defaultMeetingLink : null)
        const synap = c.synap_group
          ? /^https?:\/\//i.test(c.synap_group)
            ? c.synap_group
            : `https://${c.synap_group}`
          : null

        return (
          <div
            key={c.id}
            className={`bg-white rounded-lg shadow-md border-t-4 p-6 ${
              isPast ? 'border-gray-300 opacity-80' : 'border-hgl-blue'
            }`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <div>
                <h3 className="font-bold text-hgl-slate text-lg">
                  {label}
                  {isPast && <span className="text-gray-400 text-sm font-normal"> · past</span>}
                </h3>
                <p className="text-sm text-gray-600">
                  Starts {formatDate(c.start_date)} ·{' '}
                  {c.delivery_mode === 'online' ? 'Online' : 'In person'}
                </p>
                <p className="text-sm text-gray-600">
                  {c.delivery_mode === 'online' ? 'Meeting link' : 'Classroom'}:{' '}
                  {location ? (
                    /^https?:\/\//i.test(location) ? (
                      <a href={location} className="text-hgl-blue underline">{location}</a>
                    ) : (
                      location
                    )
                  ) : (
                    <span className="text-amber-700">not set</span>
                  )}
                  {!c.default_location && location ? (
                    <span className="text-gray-400"> (your default link)</span>
                  ) : null}
                </p>
                {synap && (
                  <p className="text-sm text-gray-600">
                    Synap group: <a href={synap} className="text-hgl-blue underline">{synap}</a>
                  </p>
                )}
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-hgl-slate">
                  {paidCount} <span className="text-gray-400 font-normal">/ {c.capacity} paid</span>
                </div>
                <div className={`text-xs font-semibold ${paidCount >= minEnrollment ? 'text-green-700' : 'text-amber-700'}`}>
                  minimum {minEnrollment}
                </div>
              </div>
            </div>

            {sessions.length > 0 && (
              <details className="mb-3" open={!isPast}>
                <summary className="text-sm font-semibold text-hgl-blue cursor-pointer">
                  Session calendar ({sessions.length} sessions)
                </summary>
                <div className="mt-2">
                  <SessionCalendar
                    sessions={sessions}
                    defaultLocation={location}
                    calendarHref={`/classes/${c.id}/calendar`}
                  />
                </div>
              </details>
            )}

            {active.length > 0 ? (
              <table className="w-full text-sm border border-gray-200 rounded">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <th className="px-2 py-1.5">Student</th>
                    <th className="px-2 py-1.5">School / grade</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5">Intake notes</th>
                  </tr>
                </thead>
                <tbody>
                  {active
                    .sort((a: any, b: any) =>
                      (one<any>(a.students)?.last_name ?? '').localeCompare(
                        one<any>(b.students)?.last_name ?? ''
                      )
                    )
                    .map((e: any) => {
                      const st = one<any>(e.students)
                      const stSchool = one<any>(st?.schools)
                      const intake = [
                        e.accommodations ? `Accommodations: ${e.accommodations}` : null,
                        e.previous_scores ? `Previous scores: ${e.previous_scores}` : null,
                        e.notes ? `Notes: ${e.notes}` : null,
                      ].filter(Boolean)
                      return (
                        <tr key={e.id} className="border-t border-gray-100 align-top">
                          <td className="px-2 py-1.5">
                            <div className="font-semibold text-hgl-slate">
                              {st ? `${st.first_name} ${st.last_name}` : '—'}
                            </div>
                            {st?.student_email && (
                              <div className="text-xs text-gray-500">{st.student_email}</div>
                            )}
                            {st && (
                              <ScoresTable
                                scores={(allScores ?? []).filter(
                                  (s: any) =>
                                    s.student_id === st.id && (!s.class_id || s.class_id === c.id)
                                )}
                              />
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-gray-600">
                            {stSchool?.nickname ?? '—'}
                            {st?.grade_level
                              ? ` · Grade ${st.grade_level}`
                              : st?.graduating_year
                                ? ` · Class of ${st.graduating_year}`
                                : ''}
                          </td>
                          <td className="px-2 py-1.5">
                            <StatusBadge status={e.payment_status} />
                          </td>
                          <td className="px-2 py-1.5 text-gray-600 text-xs max-w-56">
                            {intake.length > 0
                              ? intake.map((line, i) => <div key={i}>{line}</div>)
                              : '—'}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-500">No registrations yet.</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
