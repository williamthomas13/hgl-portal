import type { SupabaseClient } from '@supabase/supabase-js'
import TimecardPanel, {
  type TimecardData,
  type TimecardSession,
  type TimecardClassSession,
} from './timecard-panel'
import { one } from './shared'
import { workTypeOptions } from '../utils/work-types'

// Tutor view (Phase 7b §7): upcoming 1-on-1 sessions plus timecards. The
// twice-monthly "reconstruct my calendar into a timecard" ritual becomes a
// 60-second review — the card derives from the same session rows as the
// family's invoice, so they can't disagree. All reads run under the tutor's
// own RLS scope (own sessions/timecards policies).

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function TutorView({
  supabase,
  email,
}: {
  supabase: SupabaseClient
  email: string
}) {
  const { data: instructorRows } = await supabase
    .from('instructors')
    .select('id, timezone, pay_type_titles')
    .ilike('email', email)
  const tutor = instructorRows?.[0]
  if (!tutor) {
    return <p className="text-gray-500 bg-white rounded-lg border p-6">No tutoring profile found.</p>
  }
  const tz = tutor.timezone ?? 'America/Denver'

  const [{ data: upcoming }, { data: timecards }] = await Promise.all([
    supabase
      .from('tutoring_sessions')
      .select(
        `id, starts_at, ends_at, duration_minutes, status,
         students ( id, first_name, last_name, tutoring_handoff_note, tutoring_handoff_by ),
         tutoring_engagements ( location, subjects ( name ) )`
      )
      .eq('tutor_id', tutor.id)
      .eq('status', 'confirmed')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(10),
    supabase
      .from('timecards')
      .select('id, period_start, period_end, status, total_hours, tutor_confirmed_at')
      .eq('tutor_id', tutor.id)
      .order('period_start', { ascending: false })
      .limit(6),
  ])

  // Sessions on the most recent actionable (not yet approved) timecard.
  const actionable = (timecards ?? []).find((t: any) => t.status === 'open' || t.status === 'tutor_confirmed')
  let cardSessions: TimecardSession[] = []
  let cardClassSessions: TimecardClassSession[] = []
  if (actionable) {
    const [{ data }, { data: classData }] = await Promise.all([
      supabase
        .from('tutoring_sessions')
        .select(
          `id, starts_at, ends_at, duration_minutes, status, reschedule_notice, cancel_note, work_type,
           students ( first_name, last_name ),
           tutoring_engagements ( subjects ( name ) )`
        )
        .eq('timecard_id', actionable.id)
        .order('starts_at'),
      // PL-103: group-class sessions taught this period (stamped by the
      // sweep) — always attributed as Class/Workshop.
      supabase
        .from('sessions')
        .select('id, session_date, start_time, end_time, classes ( class_type, schools ( nickname ) )')
        .eq('timecard_id', actionable.id)
        .order('session_date'),
    ])
    cardSessions = ((data as any[]) ?? []).map((s) => {
      const eng = one<any>(s.tutoring_engagements)
      const student = one<any>(s.students)
      return {
        id: s.id,
        starts_at: s.starts_at,
        duration_minutes: s.duration_minutes,
        status: s.status,
        reschedule_notice: s.reschedule_notice,
        cancel_note: s.cancel_note,
        work_type: s.work_type,
        studentName: student ? `${student.first_name} ${student.last_name}` : '—',
        subjectName: one<any>(eng?.subjects)?.name ?? '',
      }
    })
    cardClassSessions = ((classData as any[]) ?? []).map((s) => {
      const cls = one<any>(s.classes)
      return {
        id: s.id,
        session_date: s.session_date,
        start_time: s.start_time,
        end_time: s.end_time,
        className: [one<any>(cls?.schools)?.nickname, cls?.class_type].filter(Boolean).join(' ') || 'Class',
      }
    })
  }

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString('en-US', { timeZone: tz, ...opts })

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-6">
        <h2 className="text-lg font-bold text-hgl-slate mb-1">Upcoming sessions</h2>
        <p className="text-xs text-gray-400 mb-4">
          Times in {tz}. These also live on your Google Calendar — reschedules and cancellations go
          through the office, and both places update automatically.
        </p>
        {/* PL-53d: the class instructor's handoff, shown once per student
            ahead of the first session — the 1-on-1 starts where class ended. */}
        {(() => {
          const seen = new Set<string>()
          const handoffs = ((upcoming as any[]) ?? [])
            .map((s) => one<any>(s.students))
            .filter((st: any) => {
              if (!st?.tutoring_handoff_note || seen.has(st.id)) return false
              seen.add(st.id)
              return true
            })
          if (handoffs.length === 0) return null
          return (
            <div className="mb-4 space-y-2">
              {handoffs.map((st: any) => (
                <p key={st.id} className="text-xs text-gray-700 bg-purple-50 border border-purple-200 rounded p-2">
                  <span className="font-semibold">
                    Handoff for {st.first_name} (from {st.tutoring_handoff_by ?? 'their class instructor'}):
                  </span>{' '}
                  {st.tutoring_handoff_note}
                </p>
              ))}
            </div>
          )
        })()}
        {upcoming && upcoming.length > 0 ? (
          <ul className="divide-y divide-gray-100 text-sm">
            {(upcoming as any[]).map((s) => {
              const eng = one<any>(s.tutoring_engagements)
              const student = one<any>(s.students)
              return (
                <li key={s.id} className="py-2 flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
                  <span className="font-semibold text-hgl-slate">
                    {fmt(s.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                  <span>
                    {fmt(s.starts_at, { hour: 'numeric', minute: '2-digit' })}–
                    {fmt(s.ends_at, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="text-gray-600">
                    {student ? `${student.first_name} ${student.last_name}` : ''} ·{' '}
                    {one<any>(eng?.subjects)?.name ?? ''}
                  </span>
                  {eng?.location && <span className="text-gray-400 text-xs truncate max-w-56">{eng.location}</span>}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500 italic">No upcoming sessions on the books.</p>
        )}
      </div>

      <TimecardPanel
        timecards={(timecards ?? []) as TimecardData[]}
        actionableId={actionable?.id ?? null}
        sessions={cardSessions}
        classSessions={cardClassSessions}
        workTypes={workTypeOptions(tutor.pay_type_titles)}
        timezone={tz}
      />
    </div>
  )
}
