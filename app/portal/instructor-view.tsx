import type { SupabaseClient } from '@supabase/supabase-js'
import SessionCalendar from '../components/SessionCalendar'
import AttendancePanel from './attendance-panel'
import ScoresEntry from '../components/ScoresEntry'
import HandoffNotes from '../components/HandoffNotes'
import { supabaseAdmin } from '../utils/supabase-admin'
import MessageClass from './message-class'
import { StatusBadge, ScoresTable, formatDate, one, type ScoreRow } from './shared'
import { bySessionStart, effectiveStartDate } from '../utils/dates'
import CommsTimeline, { type TimelineItem } from './comms-timeline'
import { TEMPLATE_LABELS } from '../utils/comms'

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
        id, status, class_type, delivery_mode, capacity, min_enrollment,
        start_date, default_location, synap_group, registration_close_date,
        schools ( name, nickname ),
        instructors!inner ( email ),
        sessions ( id, session_date, start_time, end_time, location ),
        enrollments (
          id, payment_status, accommodations, previous_scores, notes,
          enrollment_addons ( hours ),
          students (
            id, first_name, last_name, student_email, grade_level, graduating_year,
            tutoring_handoff_note,
            schools ( name, nickname )
          )
        )
      `
      )
      .ilike('instructors.email', email)
      .order('start_date', { ascending: false }),
  ])

  const defaultMeetingLink = instructorRows?.[0]?.default_meeting_link ?? null

  // PL-53d: which roster students continue to 1-on-1 tutoring — add-on hours
  // present (from the enrollment join) or a tutoring schedule already exists.
  // The schedule check needs a privileged read (instructors hold no policy on
  // other tutors' engagements); only a boolean per student leaves it.
  const rosterStudentIds = [
    ...new Set(
      ((classes as any[]) ?? [])
        .flatMap((c) => c.enrollments ?? [])
        .map((e: any) => one<any>(e.students)?.id)
        .filter(Boolean)
    ),
  ] as string[]
  const { data: engagedRows } = rosterStudentIds.length
    ? await supabaseAdmin
        .from('tutoring_engagements')
        .select('student_id')
        .in('student_id', rosterStudentIds)
        .in('status', ['pending_parent_confirmation', 'active', 'paused'])
    : { data: [] }
  const engagedStudentIds = new Set((engagedRows ?? []).map((r: any) => r.student_id))
  const continuesTo1on1 = (e: any) =>
    (e.enrollment_addons ?? []).length > 0 || engagedStudentIds.has(one<any>(e.students)?.id)

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

  // PL-77: family-comms timeline — sent from email_sends, upcoming from the
  // projector's scheduled rows (same table, status-distinguished). Grouped
  // per email step per day so a 10-family class reads as one line per email.
  const classIds = (classes as any[]).map((c) => c.id)
  const { data: commsRows } = classIds.length
    ? await supabaseAdmin
        .from('email_sends')
        .select('id, class_id, template_key, status, sent_at, scheduled_for, recipient_role, is_test')
        .in('class_id', classIds)
        .in('recipient_role', ['parent', 'student'])
        .order('scheduled_for', { ascending: true })
    : { data: [] as any[] }
  const timelineByClass = new Map<string, TimelineItem[]>()
  {
    const groups = new Map<string, { item: TimelineItem; count: number }>()
    for (const r of (commsRows as any[]) ?? []) {
      if (r.is_test) continue
      const state: TimelineItem['state'] =
        r.status === 'cancelled' ? 'cancelled' : ['scheduled', 'held'].includes(r.status) ? 'upcoming' : 'sent'
      const at = r.sent_at ?? r.scheduled_for
      const day = (at ?? '').slice(0, 10)
      const key = `${r.class_id}|${r.template_key}|${state}|${day}`
      const label = TEMPLATE_LABELS[r.template_key] ?? r.template_key
      const when = at
        ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
          (state === 'upcoming' ? ' (scheduled)' : '')
        : ''
      const existing = groups.get(key)
      if (existing) existing.count++
      else groups.set(key, { item: { previewId: r.id, label, when, sortKey: at ?? '', state, recipients: 1 }, count: 1 })
    }
    for (const [key, g] of groups) {
      const classId = key.split('|')[0]
      g.item.recipients = g.count
      const list = timelineByClass.get(classId) ?? []
      list.push(g.item)
      timelineByClass.set(classId, list)
    }
    for (const list of timelineByClass.values()) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }

  return (
    <div className="space-y-6">
      {(classes as any[]).map((c) => {
        const school = one<any>(c.schools)
        const label = `${school?.nickname ?? 'HGL'} ${c.class_type}`
        const sessions = [...(c.sessions ?? [])].sort(bySessionStart)
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
                  {c.status === 'cancelled' ? (
                    <span className="ml-2 align-middle inline-block px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded uppercase tracking-wide">
                      Cancelled
                    </span>
                  ) : (
                    isPast && <span className="text-gray-400 text-sm font-normal"> · past</span>
                  )}
                </h3>
                <p className="text-sm text-gray-600">
                  Starts {formatDate(effectiveStartDate(c.start_date, sessions))} ·{' '}
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
                {/* PL-77/PL-73: the live count in the house format */}
                <div className="text-lg font-bold text-hgl-slate">
                  {paidCount} enrolled{' '}
                  <span className="text-gray-400 font-normal">
                    / {minEnrollment} min / {c.capacity} cap
                  </span>
                </div>
                <div className={`text-xs font-semibold ${paidCount >= minEnrollment ? 'text-green-700' : 'text-amber-700'}`}>
                  {paidCount >= minEnrollment ? 'minimum met' : `below minimum (${minEnrollment})`}
                </div>
                {(() => {
                  const regClose =
                    c.registration_close_date ?? sessions[0]?.session_date ?? c.start_date
                  return today <= regClose && c.status !== 'cancelled' ? (
                    <div className="text-xs text-gray-500">registration closes {formatDate(regClose)}</div>
                  ) : null
                })()}
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

            {/* PL-77: what your families have been told (and what's coming) */}
            <details className="mb-3">
              <summary className="text-sm font-semibold text-hgl-blue cursor-pointer">
                Family emails ({(timelineByClass.get(c.id) ?? []).length}) — sent &amp; upcoming
              </summary>
              <div className="mt-2">
                <CommsTimeline items={timelineByClass.get(c.id) ?? []} />
              </div>
            </details>

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
                              {continuesTo1on1(e) && (
                                <span className="ml-2 inline-block px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold align-middle">
                                  continues to 1-on-1
                                </span>
                              )}
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

            {/* Feature B2: per-session attendance for paid students — phone-
                friendly tap roster, editable after the fact. */}
            <AttendancePanel
              sessions={sessions}
              roster={active
                .filter((e: any) => e.payment_status === 'Paid' || e.payment_status === 'Completed')
                .map((e: any) => {
                  const st = one<any>(e.students)
                  return {
                    enrollmentId: e.id,
                    studentName: st ? `${st.first_name} ${st.last_name}` : '—',
                  }
                })
                .sort((a: any, b: any) => a.studentName.localeCompare(b.studentName))}
              recordedBy={email}
            />

            {/* PL-37: milestone score entry where attendance is taken. */}
            <ScoresEntry
              classId={c.id}
              students={active
                .map((e: any) => one<any>(e.students))
                .filter(Boolean)
                .map((st: any) => ({ id: st.id, name: `${st.first_name} ${st.last_name}` }))
                .sort((a: any, b: any) => a.name.localeCompare(b.name))}
            />

            {/* PL-53d: handoff notes on the final session's attendance screen,
                and after the class ends until written. */}
            {new Date().toLocaleDateString('en-CA') >= lastSession && (
              <HandoffNotes
                students={active
                  .filter((e: any) => continuesTo1on1(e))
                  .map((e: any) => {
                    const st = one<any>(e.students)
                    return st
                      ? { id: st.id, firstName: st.first_name, note: st.tutoring_handoff_note ?? null }
                      : null
                  })
                  .filter(Boolean) as any[]}
              />
            )}

            {/* Feature B3: send-from-portal class messaging + copy-emails. */}
            {c.status !== 'cancelled' && (
              <MessageClass classId={c.id} classLabel={label} />
            )}
          </div>
        )
      })}
    </div>
  )
}
