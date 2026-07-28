import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { statusFor, type CalendarStatus } from '../../../utils/calendar-colors'
import { holdActive } from '../../../utils/gcal-sync'
import { zonedToUtc } from '../../../utils/tutoring'

// PL-160: the combined calendar feed — 1-on-1 tutoring sessions, class
// sessions, and PL-159 proposed holds in one list, colored by Kelsie's
// established language (statusFor). Read-only; every block deep-links its
// record per the standing rule. The PL-161 suggester overlays this view.

export type CalendarBlock = {
  id: string
  kind: 'tutoring' | 'class'
  title: string
  startsAt: string // ISO instant
  endsAt: string
  status: CalendarStatus
  /** Raw portal status for the tooltip ("proposed", "cancelled", …). */
  portalStatus: string
  tutorId: string | null
  tutorName: string | null
  classId: string | null
  schoolId: string | null
  schoolName: string | null
  href: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const url = new URL(req.url)
  const from = url.searchParams.get('from') // ISO instant
  const to = url.searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'Pass from and to.' }, { status: 400 })
  const spanMs = new Date(to).getTime() - new Date(from).getTime()
  if (!(spanMs > 0) || spanMs > 62 * 86_400_000) {
    return NextResponse.json({ error: 'Range must be positive and at most ~2 months.' }, { status: 400 })
  }

  const [{ data: tutoring }, { data: classSessions }] = await Promise.all([
    supabase
      .from('tutoring_sessions')
      .select(
        `id, starts_at, ends_at, status, tutor_id,
         students ( first_name, last_name, family_id ),
         instructors ( name, email ),
         tutoring_engagements ( location, status, approval_requested_at, subjects ( name ) )`
      )
      .lt('starts_at', to)
      .gt('ends_at', from)
      .in('status', ['proposed', 'confirmed', 'completed', 'cancelled', 'no_show', 'forfeited']),
    supabase
      .from('sessions')
      .select(
        `id, class_id, session_date, start_time, end_time, location,
         classes ( class_type, status, delivery_mode, default_location, instructor_id, school_id,
           schools ( name, nickname, timezone ), instructors ( name ) )`
      )
      .gte('session_date', from.slice(0, 10))
      .lte('session_date', to.slice(0, 10)),
  ])

  const blocks: CalendarBlock[] = []

  // PL-179: covered sessions carry the marker on the calendar too — same
  // state source as the tutor portal (accepted coverage_requests).
  const tutoringIds = ((tutoring as any[]) ?? []).map((s) => s.id)
  const coveredBySession = new Map<string, string>()
  if (tutoringIds.length > 0) {
    const { data: covered } = await supabase
      .from('coverage_requests')
      .select(`session_id, requester:instructors!coverage_requests_requesting_tutor_id_fkey ( name )`)
      .eq('status', 'accepted')
      .in('session_id', tutoringIds)
    for (const r of (covered as any[]) ?? []) {
      coveredBySession.set(r.session_id, one<any>(r.requester)?.name?.split(' ')[0] ?? 'a colleague')
    }
  }

  for (const s of (tutoring as any[]) ?? []) {
    const stu = one<any>(s.students)
    const eng = one<any>(s.tutoring_engagements)
    const tut = one<any>(s.instructors)
    // PL-159: an expired hold no longer blocks — but it still RENDERS as
    // proposed (seeing an unanswered proposal is information, not noise).
    const portalStatus =
      s.status === 'proposed' && !holdActive(eng?.status ?? 'active', eng?.approval_requested_at ?? null)
        ? 'proposed (hold released)'
        : s.status
    const coveredFrom = coveredBySession.get(s.id)
    blocks.push({
      id: `t-${s.id}`,
      kind: 'tutoring',
      title: `${coveredFrom ? '↷ ' : ''}${stu?.first_name ?? '?'} ${stu?.last_name ?? ''} — ${one<any>(eng?.subjects)?.name ?? 'Tutoring'}`,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      status: statusFor({
        status: ['no_show', 'forfeited'].includes(s.status) ? 'confirmed' : s.status,
        location: eng?.location ?? null,
      }),
      portalStatus: coveredFrom ? `${portalStatus} · covered (substitute for ${coveredFrom})` : portalStatus,
      tutorId: s.tutor_id,
      tutorName: tut?.name ?? tut?.email ?? null,
      classId: null,
      schoolId: null,
      schoolName: null,
      href: `/admin/tutoring?family=${stu?.family_id ?? ''}`,
    })
  }

  for (const s of (classSessions as any[]) ?? []) {
    const cls = one<any>(s.classes)
    if (!cls) continue
    const school = one<any>(cls.schools)
    const tz = school?.timezone ?? 'America/Denver'
    // Class sessions store wall-clock date+time in the school's timezone.
    const startsAt = zonedToUtc(s.session_date, String(s.start_time).slice(0, 5), tz).toISOString()
    const endsAt = zonedToUtc(s.session_date, String(s.end_time).slice(0, 5), tz).toISOString()
    blocks.push({
      id: `c-${s.id}`,
      kind: 'class',
      title: `${school?.nickname ?? school?.name ?? ''} ${cls.class_type}`.trim(),
      startsAt,
      endsAt,
      status: statusFor({
        status: cls.status === 'cancelled' ? 'cancelled' : 'confirmed',
        deliveryMode: cls.delivery_mode,
      }),
      portalStatus: cls.status,
      tutorId: cls.instructor_id ?? null,
      tutorName: one<any>(cls.instructors)?.name ?? null,
      classId: s.class_id,
      schoolId: cls.school_id ?? null,
      schoolName: school?.nickname ?? school?.name ?? null,
      href: `/admin?class=${s.class_id}`,
    })
  }

  blocks.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return NextResponse.json({ blocks })
}
