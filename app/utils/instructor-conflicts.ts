import { supabaseAdmin as supabase } from './supabase-admin'
import { zonedToUtc } from './tutoring'
import { holdActive } from './gcal-sync'

// PL-434: THE conflict set for a class↔instructor pairing — the instructor's
// live tutoring sessions (confirmed, plus proposed holds that still hold)
// overlapping the class's FUTURE sessions. Portal truth only, deduped per
// tutoring session (the PL-433 rule: Google echoes never count — the portal
// counts its own sessions precisely). ONE source: the assign route's
// response, the resolution card's API, and the dashboard's Needs Attention
// row all read this shape, so the count can never disagree across surfaces.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

/** The class's future sessions as UTC intervals (school-tz wall clock →
 *  instants; the same math instructor-fit uses). */
export function classSessionIntervals(
  sessions: { session_date: string; start_time: string | null; end_time: string | null }[],
  tz: string,
  now: number = Date.now()
): { start: number; end: number }[] {
  return (sessions ?? [])
    .filter((s) => s.start_time && s.end_time)
    .map((s) => ({
      start: zonedToUtc(s.session_date, String(s.start_time).slice(0, 5), tz).getTime(),
      end: zonedToUtc(s.session_date, String(s.end_time).slice(0, 5), tz).getTime(),
    }))
    .filter((s) => s.end > now)
}

/** PL-434B: the dashboard's batch — conflict COUNTS for many class↔instructor
 *  pairs in ONE tutoring query (the row is recomputed from reality on every
 *  dashboard load; resolving via ANY path clears it). Same predicate as the
 *  per-class list above. */
export async function assignmentConflictCounts(
  rows: { classId: string; instructorId: string; intervals: { start: number; end: number }[] }[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const live = rows.filter((r) => r.intervals.length > 0)
  if (live.length === 0) return counts
  const spanStart = Math.min(...live.flatMap((r) => r.intervals.map((i) => i.start)))
  const spanEnd = Math.max(...live.flatMap((r) => r.intervals.map((i) => i.end)))
  const tutorIds = [...new Set(live.map((r) => r.instructorId))]
  const { data: tutoring } = await supabase
    .from('tutoring_sessions')
    .select('id, tutor_id, starts_at, ends_at, status, tutoring_engagements ( status, approval_requested_at )')
    .in('tutor_id', tutorIds)
    .in('status', ['proposed', 'confirmed'])
    .lt('starts_at', new Date(spanEnd).toISOString())
    .gt('ends_at', new Date(spanStart).toISOString())
  const byTutor = new Map<string, { start: number; end: number }[]>()
  for (const s of (tutoring as any[]) ?? []) {
    const eng = one<any>(s.tutoring_engagements)
    if (s.status === 'proposed' && !holdActive(eng?.status ?? 'active', eng?.approval_requested_at ?? null)) continue
    const iv = { start: new Date(s.starts_at).getTime(), end: new Date(s.ends_at).getTime() }
    byTutor.set(s.tutor_id, [...(byTutor.get(s.tutor_id) ?? []), iv])
  }
  for (const r of live) {
    const ivs = byTutor.get(r.instructorId) ?? []
    const n = ivs.filter((iv) => r.intervals.some((c) => c.start < iv.end && c.end > iv.start)).length
    if (n > 0) counts.set(r.classId, n)
  }
  return counts
}

/** PL-446C: the class's future session intervals as ISO pairs — the
 *  reschedule dialog's still-overlaps check runs against these. */
export async function futureClassIntervals(
  classId: string
): Promise<{ start: string; end: string }[]> {
  const { data: cls } = await supabase
    .from('classes')
    .select('id, timezone, schools ( timezone ), sessions ( session_date, start_time, end_time )')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return []
  const tz = (cls as any).timezone ?? one<any>((cls as any).schools)?.timezone ?? 'America/Denver'
  return classSessionIntervals(((cls as any).sessions as any[]) ?? [], tz).map((i) => ({
    start: new Date(i.start).toISOString(),
    end: new Date(i.end).toISOString(),
  }))
}

export type AssignmentConflict = {
  sessionId: string
  startsAt: string
  endsAt: string
  studentFirst: string
  studentLast: string
  familyId: string | null
  subjectName: string
  /** PL-446A: the class session this tutoring session collides with — the
   *  reschedule dialog names WHAT it's resolving. */
  classStart: string
  classEnd: string
}

export async function tutoringConflictsForClass(
  classId: string,
  instructorId: string
): Promise<AssignmentConflict[]> {
  const { data: cls } = await supabase
    .from('classes')
    .select('id, timezone, schools ( timezone ), sessions ( session_date, start_time, end_time )')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return []
  const tz = (cls as any).timezone ?? one<any>((cls as any).schools)?.timezone ?? 'America/Denver'
  const intervals = classSessionIntervals(((cls as any).sessions as any[]) ?? [], tz)
  if (intervals.length === 0) return []
  const spanStart = Math.min(...intervals.map((i) => i.start))
  const spanEnd = Math.max(...intervals.map((i) => i.end))

  const { data: tutoring } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, starts_at, ends_at, status,
       students ( first_name, last_name, family_id ),
       tutoring_engagements ( status, approval_requested_at, subjects ( name ) )`
    )
    .eq('tutor_id', instructorId)
    .in('status', ['proposed', 'confirmed'])
    .lt('starts_at', new Date(spanEnd).toISOString())
    .gt('ends_at', new Date(spanStart).toISOString())

  const conflicts: AssignmentConflict[] = []
  for (const s of (tutoring as any[]) ?? []) {
    const eng = one<any>(s.tutoring_engagements)
    if (s.status === 'proposed' && !holdActive(eng?.status ?? 'active', eng?.approval_requested_at ?? null)) continue
    const iv = { start: new Date(s.starts_at).getTime(), end: new Date(s.ends_at).getTime() }
    // PL-446A: keep the MATCHED class interval — the dialog shows the target.
    const hit = intervals.find((c) => c.start < iv.end && c.end > iv.start)
    if (!hit) continue
    const stu = one<any>(s.students)
    conflicts.push({
      sessionId: s.id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      studentFirst: stu?.first_name ?? 'a student',
      studentLast: stu?.last_name ?? '',
      familyId: stu?.family_id ?? null,
      subjectName: one<any>(eng?.subjects)?.name ?? 'tutoring',
      classStart: new Date(hit.start).toISOString(),
      classEnd: new Date(hit.end).toISOString(),
    })
  }
  return conflicts.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
/* eslint-enable @typescript-eslint/no-explicit-any */
