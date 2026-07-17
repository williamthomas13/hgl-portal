// Feature B1 attendance computation (docs/COMMS_ATTENDANCE_PARENT_SPEC.md).
import { bySessionStart } from './dates'
// Client-safe and pure — shared by the instructor panel, admin roster
// summaries, the counselor view, and the parent dashboard (Feature C2).
//
// Rules (decided July 10):
//   * Late/Left-early under 10 minutes is not tracked at all (student is
//     simply Present); flags therefore assert AT LEAST 10 minutes.
//   * A bare flag with no minutes counts as exactly 10 — the minimum
//     trackable amount, never more.
//   * Only PAST sessions count. Absent = 0 minutes.
//   * Report both "sessions attended 3/4" and "% of class time attended".

export const MIN_TRACKABLE_MINUTES = 10

export type AttendanceRecord = {
  session_id: string
  enrollment_id: string
  present: boolean
  arrived_late: boolean
  left_early: boolean
  minutes_late: number | null
  minutes_left_early: number | null
  note?: string | null
}

export type SessionForAttendance = {
  id: string
  session_date: string // YYYY-MM-DD
  start_time: string | null
  end_time: string | null
}

/** Session length in minutes; 120 when times are missing (the standard 2h block). */
export function sessionDurationMinutes(s: SessionForAttendance): number {
  if (!s.start_time || !s.end_time) return 120
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  return mins > 0 ? mins : 120
}

export function isPastSession(s: SessionForAttendance, todayISO?: string): boolean {
  const today = todayISO ?? new Date().toLocaleDateString('en-CA')
  return s.session_date < today
}

export function minutesAttended(record: AttendanceRecord, duration: number): number {
  if (!record.present) return 0
  const late = record.arrived_late ? (record.minutes_late ?? MIN_TRACKABLE_MINUTES) : 0
  const early = record.left_early ? (record.minutes_left_early ?? MIN_TRACKABLE_MINUTES) : 0
  return Math.max(0, duration - late - early)
}

export type SessionAttendanceLine = {
  session: SessionForAttendance
  record: AttendanceRecord | null
  /** Human status chip: Present / Absent / Arrived 45 min late / … */
  statusLabel: string
  minutesAttended: number
  duration: number
}

export type AttendanceSummary = {
  pastSessions: number
  recordedSessions: number
  sessionsAttended: number
  minutesAttended: number
  minutesPossible: number
  /** 0–100, over past sessions WITH records (untaken attendance never counts against a student). */
  percent: number | null
  lines: SessionAttendanceLine[]
}

export function recordStatusLabel(r: AttendanceRecord): string {
  if (!r.present) return 'Absent'
  const parts: string[] = []
  if (r.arrived_late) parts.push(`Arrived ${r.minutes_late ?? MIN_TRACKABLE_MINUTES} min late`)
  if (r.left_early) parts.push(`Left ${r.minutes_left_early ?? MIN_TRACKABLE_MINUTES} min early`)
  return parts.length > 0 ? parts.join(' · ') : 'Present'
}

export function summarizeAttendance(
  sessions: SessionForAttendance[],
  records: AttendanceRecord[],
  enrollmentId: string,
  todayISO?: string
): AttendanceSummary {
  const past = [...sessions]
    .filter((s) => isPastSession(s, todayISO))
    .sort(bySessionStart)
  const byId = new Map(
    records.filter((r) => r.enrollment_id === enrollmentId).map((r) => [r.session_id, r])
  )

  const lines: SessionAttendanceLine[] = past.map((session) => {
    const record = byId.get(session.id) ?? null
    const duration = sessionDurationMinutes(session)
    return {
      session,
      record,
      statusLabel: record ? recordStatusLabel(record) : 'Not recorded',
      minutesAttended: record ? minutesAttended(record, duration) : 0,
      duration,
    }
  })

  const recorded = lines.filter((l) => l.record)
  const minutesPossible = recorded.reduce((sum, l) => sum + l.duration, 0)
  const attendedMinutes = recorded.reduce((sum, l) => sum + l.minutesAttended, 0)
  return {
    pastSessions: past.length,
    recordedSessions: recorded.length,
    sessionsAttended: recorded.filter((l) => l.record!.present).length,
    minutesAttended: attendedMinutes,
    minutesPossible,
    percent: minutesPossible > 0 ? Math.round((attendedMinutes / minutesPossible) * 100) : null,
    lines,
  }
}
