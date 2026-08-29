import type { SupabaseClient } from '@supabase/supabase-js'
import TimecardPanel, {
  type TimecardData,
  type TimecardSession,
  type TimecardClassSession,
} from './timecard-panel'
import { one } from './shared'
import { zonedToUtc } from '../utils/tutoring'
import { workTypeOptions } from '../utils/work-types'
import SessionNotesPanel, { type NoteSession } from './session-notes-panel'
import EmailPrefsPanel from './email-prefs-panel'
import MyStudentsPanel from './my-students-panel'
import { ShareMaterialsPanel } from './materials-panel'
import UpcomingSessions, { type UpcomingRow } from './upcoming-sessions'
import CoveragePanel, {
  type CoverageRow,
  type CoverableSession,
  type HandoffView,
} from './coverage-panel'
import { supabaseAdmin } from '../utils/supabase-admin'
import { loadContactInfo } from '../utils/tutoring-emails'
import { escapeLike } from '../utils/like-escape'
import { staffTimeCityLabel } from '../utils/dates'

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
    .select('id, timezone, pay_type_titles, pay_type')
    .ilike('email', escapeLike(email))
  const tutor = instructorRows?.[0]
  if (!tutor) {
    return <p className="text-gray-500 bg-white rounded-lg border p-6">No tutoring profile found.</p>
  }
  const tz = tutor.timezone ?? 'America/Denver'

  const [{ data: upcoming }, { data: timecards }, { data: upcomingClasses }] = await Promise.all([
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
    // PL-132: the class/workshop sessions this instructor teaches. They were
    // missing from the schedule list entirely even though the timecard has
    // always counted them (PL-103) — different prep, different pay type.
    supabase
      .from('sessions')
      .select(
        `id, session_date, start_time, end_time,
         classes!inner ( class_type, default_location, instructor_id, status, schools ( nickname ) )`
      )
      .eq('classes.instructor_id', tutor.id)
      .neq('classes.status', 'cancelled')
      .gte('session_date', new Date().toISOString().slice(0, 10))
      .order('session_date')
      .limit(10),
  ])

  // PL-395: handoff attributions render the instructor's NAME (the email
  // stays the honest fallback for an address no instructor row knows).
  const handoffEmails = [
    ...new Set(
      ((upcoming as any[]) ?? [])
        .map((s) => one<any>(s.students)?.tutoring_handoff_by)
        .filter(Boolean) as string[]
    ),
  ]
  let handoffNames: Record<string, string> = {}
  if (handoffEmails.length > 0) {
    const { data: handoffInstructors } = await supabase
      .from('instructors')
      .select('email, name')
      .in('email', handoffEmails)
    handoffNames = Object.fromEntries(
      ((handoffInstructors as any[]) ?? [])
        .filter((i) => i.email && i.name)
        .map((i) => [i.email.toLowerCase(), i.name])
    )
  }

  // Sessions on the most recent actionable (not yet approved) timecard.
  const actionable = (timecards ?? []).find((t: any) => t.status === 'open' || t.status === 'tutor_confirmed')
  let cardSessions: TimecardSession[] = []
  let cardClassSessions: TimecardClassSession[] = []
  let cardNotedIds: string[] = []
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
    // PL-257a: note coverage for THIS card's completed sessions — the tutor
    // sees the same missing-notes list the approval gates enforce.
    const completedIds = cardSessions.filter((s) => s.status === 'completed').map((s) => s.id)
    if (completedIds.length) {
      const { data: noted } = await supabase
        .from('session_notes')
        .select('session_id')
        .in('session_id', completedIds)
      cardNotedIds = ((noted as any[]) ?? []).map((n) => n.session_id)
    }
  }

  // PL-111: recent completed sessions and their note state — the write
  // surface for the required short session notes (last 14 days).
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString()
  const { data: recentDone } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, starts_at, students ( first_name, last_name ), tutoring_engagements ( subjects ( name ) )`
    )
    .eq('tutor_id', tutor.id)
    .eq('status', 'completed')
    .gte('starts_at', twoWeeksAgo)
    .order('starts_at', { ascending: false })
    .limit(30)
  const recentIds = ((recentDone as any[]) ?? []).map((s) => s.id)
  const { data: recentNotes } = recentIds.length
    ? await supabase.from('session_notes').select('session_id, note, next_time').in('session_id', recentIds)
    : { data: [] }
  const noteBySession = new Map(((recentNotes as any[]) ?? []).map((n) => [n.session_id, n]))
  const noteSessions: NoteSession[] = ((recentDone as any[]) ?? []).map((s) => {
    const student = one<any>(s.students)
    const rec = noteBySession.get(s.id)
    return {
      id: s.id,
      starts_at: s.starts_at,
      studentName: student ? `${student.first_name} ${student.last_name}` : '—',
      subjectName: one<any>(one<any>(s.tutoring_engagements)?.subjects)?.name ?? '',
      note: rec?.note ?? null,
      next_time: rec?.next_time ?? null,
    }
  })

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString('en-US', { timeZone: tz, ...opts })
  const fmtFull = (iso: string) =>
    fmt(iso, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  // PL-112: coverage requests I'm on either side of (service role scoped to
  // this tutor — same pattern as the parent tutoring surface). Candidate
  // lists come from the API on demand; nothing here carries matching notes.
  const { data: covRaw } = await supabaseAdmin
    .from('coverage_requests')
    .select(
      `id, status, note, handoff_note, created_at, requesting_tutor_id, candidate_tutor_id,
       requester:instructors!coverage_requests_requesting_tutor_id_fkey ( name, email ),
       candidate:instructors!coverage_requests_candidate_tutor_id_fkey ( name, email ),
       tutoring_sessions ( id, starts_at, student_id,
         students ( first_name, last_name ),
         tutoring_engagements ( location, subjects ( name ) ) )`
    )
    .or(`requesting_tutor_id.eq.${tutor.id},candidate_tutor_id.eq.${tutor.id}`)
    .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20)
  const coverageRows: CoverageRow[] = ((covRaw as any[]) ?? []).map((r) => {
    const ses = one<any>(r.tutoring_sessions)
    const student = one<any>(ses?.students)
    const subject = one<any>(one<any>(ses?.tutoring_engagements)?.subjects)?.name ?? ''
    const isRequester = r.requesting_tutor_id === tutor.id
    const other = one<any>(isRequester ? r.candidate : r.requester)
    return {
      id: r.id,
      status: r.status,
      role: isRequester ? ('requester' as const) : ('candidate' as const),
      otherName: other?.name ?? other?.email ?? '—',
      sessionLabel: ses
        ? `${fmtFull(ses.starts_at)} — ${student?.first_name ?? ''} · ${subject}`
        : '(session no longer exists)',
      note: r.note,
    }
  })

  // The handoff: accepted coverage where I'm the substitute and the session
  // is still ahead — session details + the student's note history (PL-111).
  const handoffs: HandoffView[] = []
  for (const r of ((covRaw as any[]) ?? []).filter(
    (r) => r.status === 'accepted' && r.candidate_tutor_id === tutor.id
  )) {
    const ses = one<any>(r.tutoring_sessions)
    if (!ses || new Date(ses.starts_at) <= new Date()) continue
    const student = one<any>(ses.students)
    const eng = one<any>(ses.tutoring_engagements)
    const { data: history } = await supabaseAdmin
      .from('session_notes')
      .select('note, next_time, tutoring_sessions!inner ( starts_at )')
      .eq('student_id', ses.student_id)
      .order('created_at', { ascending: false })
      .limit(8)
    // PL-156: the requesting tutor's hand-over note travels WITH the handoff.
    let handoffNote: { from: string; note: string } | null = null
    if (r.handoff_note) {
      const { data: from } = await supabaseAdmin
        .from('instructors')
        .select('name')
        .eq('id', r.requesting_tutor_id)
        .maybeSingle()
      handoffNote = { from: from?.name?.split(' ')[0] ?? 'your colleague', note: r.handoff_note }
    }
    handoffs.push({
      sessionLabel: `${fmtFull(ses.starts_at)} — ${student?.first_name ?? ''} ${student?.last_name ?? ''} · ${one<any>(eng?.subjects)?.name ?? ''}`,
      location: eng?.location ?? null,
      handoffNote,
      notes: ((history as any[]) ?? []).map((n) => ({
        when: fmt(one<any>(n.tutoring_sessions)?.starts_at ?? '', { month: 'short', day: 'numeric' }),
        note: n.note,
        next_time: n.next_time,
      })),
    })
  }

  // PL-179: covered sessions ANNOUNCE themselves on the regular list —
  // someone else's student is exactly where autopilot fails. State-driven
  // from coverage_requests (accepted + candidate = me): a withdrawn or
  // onward-reassigned coverage drops the marker on its own.
  const { data: coveringRaw } = await supabaseAdmin
    .from('coverage_requests')
    .select(
      `session_id, handoff_note,
       requester:instructors!coverage_requests_requesting_tutor_id_fkey ( name )`
    )
    .eq('status', 'accepted')
    .eq('candidate_tutor_id', tutor.id)
  const coveringBySession = new Map<string, { from: string; note: string | null }>()
  for (const r of (coveringRaw as any[]) ?? []) {
    coveringBySession.set(r.session_id, {
      from: one<any>(r.requester)?.name?.split(' ')[0] ?? 'a colleague',
      note: r.handoff_note ?? null,
    })
  }

  // PL-132: one schedule list, both kinds of work, sorted together — the
  // tutor's day doesn't separate them, so the list shouldn't either.
  const upcomingRows: UpcomingRow[] = [
    ...((upcoming as any[]) ?? []).map((s) => {
      const eng = one<any>(s.tutoring_engagements)
      const student = one<any>(s.students)
      return {
        id: s.id as string,
        kind: 'one_on_one' as const,
        startsAt: s.starts_at as string,
        endsAt: s.ends_at as string,
        who: student ? `${student.first_name} ${student.last_name}` : '',
        subject: one<any>(eng?.subjects)?.name ?? '',
        location: eng?.location ?? null,
        studentId: student?.id ?? null,
        covering: coveringBySession.get(s.id) ?? null,
      }
    }),
    ...((upcomingClasses as any[]) ?? []).map((s) => {
      const cls = one<any>(s.classes)
      const label = [one<any>(cls?.schools)?.nickname, cls?.class_type].filter(Boolean).join(' ') || 'Class'
      // `sessions` stores a date + wall-clock times; build instants on the
      // tutor's own clock so the row reads like every other row.
      const toIso = (t: string | null) =>
        zonedToUtc(String(s.session_date).slice(0, 10), (t ?? '00:00').slice(0, 5), tz).toISOString()
      return {
        id: s.id as string,
        kind: 'class' as const,
        startsAt: toIso(s.start_time),
        endsAt: toIso(s.end_time),
        who: label,
        subject: '',
        location: cls?.default_location ?? null,
        studentId: null,
        covering: null,
      }
    }),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  const coverable: CoverableSession[] = ((upcoming as any[]) ?? []).map((s) => {
    const student = one<any>(s.students)
    const subject = one<any>(one<any>(s.tutoring_engagements)?.subjects)?.name ?? ''
    return { id: s.id, label: `${fmtFull(s.starts_at)} — ${student?.first_name ?? ''} · ${subject}` }
  })
  const contact = await loadContactInfo()
  const managerLine = `Prefer a hand? Your manager can help find a suitable replacement — write to ${contact.email}${contact.phone ? ` or call ${contact.phone}` : ''}.`
  // PL-209: name the Ops Director in the header copy. contact_name is the
  // role record (PL-123); the office-fallback string isn't a person, so it
  // keeps the old "the office" phrasing rather than splitting into "the".
  const opsFirstName = /^the /i.test(contact.name) ? 'the office' : contact.name.split(' ')[0]

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-6">
        <h2 className="text-lg font-bold text-hgl-slate mb-1">Upcoming sessions</h2>
        <p className="text-xs text-gray-500 mb-4">
          Times in {staffTimeCityLabel(tz)} time. These also live on your Google Calendar — reschedules and cancellations go
          through {opsFirstName}, and your portal and Google Calendar both update automatically.
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
                    Handoff for {st.first_name} (from{' '}
                    {st.tutoring_handoff_by
                      ? (handoffNames[st.tutoring_handoff_by.toLowerCase()] ?? st.tutoring_handoff_by)
                      : 'their class instructor'}
                    ):
                  </span>{' '}
                  {st.tutoring_handoff_note}
                </p>
              ))}
            </div>
          )
        })()}
        <UpcomingSessions rows={upcomingRows} timezone={tz} />
      </div>

      <CoveragePanel
        requests={coverageRows}
        handoffs={handoffs}
        upcoming={coverable}
        managerLine={managerLine}
      />

      {/* PL-258: the tutor's own student roster — contacts, schedules,
          subjects, recent notes. No finances anywhere. */}
      <MyStudentsPanel tutorId={tutor.id} timezone={tz} />

      <SessionNotesPanel sessions={noteSessions} timezone={tz} />

      {/* PL-203: share materials with the families of students I tutor. */}
      <ShareMaterialsPanel
        students={(() => {
          const seen = new Map<string, string>()
          for (const s of (upcoming ?? []) as any[]) {
            const st = Array.isArray(s.students) ? s.students[0] : s.students
            if (st?.id && !seen.has(st.id)) seen.set(st.id, `${st.first_name} ${st.last_name}`)
          }
          return [...seen.entries()].map(([id, name]) => ({ id, name }))
        })()}
      />

      <TimecardPanel
        timecards={(timecards ?? []) as TimecardData[]}
        actionableId={actionable?.id ?? null}
        sessions={cardSessions}
        classSessions={cardClassSessions}
        notedSessionIds={cardNotedIds}
        workTypes={workTypeOptions(tutor.pay_type_titles)}
        timezone={tz}
        salaried={tutor.pay_type === 'salaried'}
      />
      {/* PL-327: informational-email preferences — self-serve. */}
      <EmailPrefsPanel />
    </div>
  )
}
