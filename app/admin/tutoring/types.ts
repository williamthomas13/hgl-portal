// Shared row shapes for the /admin/tutoring surface (Phase 7a).

export type Subject = {
  id: string
  name: string
  category: 'test_prep' | 'subject_tutoring'
  hourly_rate: number
  active: boolean
}

/** Weekly window the portal may offer parents for self-serve reschedules
 *  (spec v1.4 §8) — tutor's local wall clock, weekday 1=Mon…7=Sun. */
export type OfferWindowUI = {
  weekday: number
  start_time: string // 'HH:MM'
  end_time: string // 'HH:MM'
}

export type Tutor = {
  id: string
  email: string
  name: string | null
  tutoring_active: boolean
  subjects: string[]
  timezone: string
  google_calendar_id: string | null
  default_location: string | null
  offer_windows: OfferWindowUI[]
}

export type FamilyRef = {
  id: string
  parent_first_name: string
  parent_last_name: string | null
  parent_email: string
}

export type StudentOption = {
  id: string
  first_name: string
  last_name: string
  families: FamilyRef | null
}

export type RecurrenceSlotUI = {
  weekday: number // 1=Mon … 7=Sun
  start_time: string // 'HH:MM'
  duration_minutes: number
}

export type Engagement = {
  id: string
  student_id: string
  tutor_id: string
  subject_id: string
  hourly_rate: number
  funding: 'monthly_billed' | 'package'
  addon_id: string | null
  recurrence: RecurrenceSlotUI[]
  location: string | null
  status: 'active' | 'paused' | 'ended'
  start_date: string | null
  end_date: string | null
  notes: string | null
  students: (StudentOption & { families: FamilyRef | null }) | null
  subjects: { name: string; category: string } | null
  instructors: { name: string | null; email: string; timezone: string } | null
}

export type SessionRow = {
  id: string
  engagement_id: string
  student_id: string
  tutor_id: string
  starts_at: string
  ends_at: string
  duration_minutes: number
  status: 'proposed' | 'confirmed' | 'completed' | 'rescheduled' | 'forfeited' | 'no_show'
  reschedule_notice: 'ok' | 'late' | null
  gcal_event_id: string | null
  cancel_note: string | null
  reschedule_requested_at: string | null
  reschedule_request_note: string | null
  students: { first_name: string; last_name: string } | null
  tutoring_engagements: { subjects: { name: string } | null; location: string | null } | null
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] // index+1 = ISO weekday

export function familyLabel(f: FamilyRef | null): string {
  if (!f) return 'Unknown family'
  return `${f.parent_first_name} ${f.parent_last_name ?? ''}`.trim() || f.parent_email
}

/** Hour+minute of an instant on the wall clock of `tz` (for grid placement). */
export function wallClock(iso: string, tz: string): { hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value])
  )
  return { hour: Number(parts.hour) % 24, minute: Number(parts.minute) }
}

export function fmtTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function fmtDay(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
