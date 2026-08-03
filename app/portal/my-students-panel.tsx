import { supabaseAdmin } from '../utils/supabase-admin'

const WEEKDAY_PLURALS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

// PL-258: the tutor's real "My Students" — one card per student they tutor:
// who they are, how to reach the parents, the weekly schedule, subjects, and
// recent session notes. NO finances anywhere: no rates, no invoices, no
// payment status — tutors must never see what families pay. Reads run on the
// service role scoped HARD to this tutor's id (the house rule from the
// coverage panel: families carry no tutor RLS policy, and widening RLS for
// contact info would out-scope what this panel needs).

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

const fmtSlotTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = ((h + 11) % 12) + 1
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${ampm}`
}

export default async function MyStudentsPanel({
  tutorId,
  timezone,
}: {
  tutorId: string
  timezone: string
}) {
  const [{ data: engs }, { data: futureSessions }, { data: recentDone }] = await Promise.all([
    supabaseAdmin
      .from('tutoring_engagements')
      // Deliberately NOT selected: hourly_rate, funding, addon_id — no
      // finances on this surface, ever.
      .select(
        `id, status, recurrence, location, start_date, end_date,
         students ( id, first_name, last_name,
           families ( parent_first_name, parent_last_name, parent_email ) ),
         subjects ( name )`
      )
      .eq('tutor_id', tutorId)
      .eq('status', 'active')
      .order('start_date', { ascending: true }),
    supabaseAdmin
      .from('tutoring_sessions')
      .select('id, starts_at, student_id')
      .eq('tutor_id', tutorId)
      .eq('status', 'confirmed')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(100),
    supabaseAdmin
      .from('tutoring_sessions')
      .select('id, starts_at, student_id, session_notes ( note, next_time )')
      .eq('tutor_id', tutorId)
      .eq('status', 'completed')
      .order('starts_at', { ascending: false })
      .limit(60),
  ])

  if (!engs || engs.length === 0) return null

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString('en-US', { timeZone: timezone, ...opts })

  const nextByStudent = new Map<string, string>()
  for (const s of (futureSessions as any[]) ?? []) {
    if (!nextByStudent.has(s.student_id)) nextByStudent.set(s.student_id, s.starts_at)
  }
  const notesByStudent = new Map<string, { starts_at: string; note: string; next_time: string | null }[]>()
  for (const s of (recentDone as any[]) ?? []) {
    const n = one<any>(s.session_notes)
    if (!n?.note) continue
    const list = notesByStudent.get(s.student_id) ?? []
    if (list.length < 3) list.push({ starts_at: s.starts_at, note: n.note, next_time: n.next_time })
    notesByStudent.set(s.student_id, list)
  }

  // One card per student — a student with two subjects gets one card listing
  // both engagements' schedules.
  const byStudent = new Map<string, { student: any; family: any; engs: any[] }>()
  for (const e of (engs as any[]) ?? []) {
    const student = one<any>(e.students)
    if (!student) continue
    const entry = byStudent.get(student.id) ?? { student, family: one<any>(student.families), engs: [] }
    entry.engs.push(e)
    byStudent.set(student.id, entry)
  }

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-6">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">My students</h2>
      <p className="text-xs text-gray-500 mb-4">
        Everyone on your regular schedule — contacts, weekly times, and your recent session notes.
      </p>
      <div className="space-y-4">
        {[...byStudent.values()].map(({ student, family, engs: studentEngs }) => {
          const next = nextByStudent.get(student.id)
          const notes = notesByStudent.get(student.id) ?? []
          return (
            <div key={student.id} className="border border-gray-200 rounded-lg p-4 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-bold text-hgl-slate">
                  {student.first_name} {student.last_name}
                </span>
                <span className="text-gray-600">
                  {studentEngs.map((e) => one<any>(e.subjects)?.name).filter(Boolean).join(' · ')}
                </span>
                {next && (
                  <span className="text-xs text-green-700">
                    Next: {fmt(next, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {family && (
                <p className="text-xs text-gray-600 mt-1">
                  Parent: {family.parent_first_name} {family.parent_last_name} ·{' '}
                  <a href={`mailto:${family.parent_email}`} className="text-hgl-blue underline">
                    {family.parent_email}
                  </a>
                </p>
              )}
              {studentEngs.map((e) => (
                <p key={e.id} className="text-xs text-gray-500 mt-1">
                  {one<any>(e.subjects)?.name ? `${one<any>(e.subjects).name}: ` : ''}
                  {Array.isArray(e.recurrence) && e.recurrence.length > 0
                    ? e.recurrence
                        .map(
                          (r: any) =>
                            `${WEEKDAY_PLURALS[r.weekday - 1]} ${fmtSlotTime(String(r.start_time).slice(0, 5))} (${r.duration_minutes} min)`
                        )
                        .join(' · ')
                    : 'no weekly slots on file'}
                  {e.location ? ` · ${e.location}` : ''}
                </p>
              ))}
              {notes.length > 0 && (
                <div className="mt-2 border-t border-gray-100 pt-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
                    Recent session notes
                  </p>
                  <ul className="mt-1 space-y-1">
                    {notes.map((n, i) => (
                      <li key={i} className="text-xs text-gray-600">
                        <span className="text-gray-400">
                          {fmt(n.starts_at, { month: 'short', day: 'numeric' })}:
                        </span>{' '}
                        {n.note}
                        {n.next_time ? (
                          <span className="text-gray-500 italic"> — next time: {n.next_time}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
