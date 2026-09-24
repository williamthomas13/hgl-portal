import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { loadClassReport } from '../../../utils/class-report'
import { classGroup, classDays, classTerm } from '../../../utils/class-groups'

// PL-503 (Scarlett, Sep 24): "one place to look up what happened at school X"
// — every class ever run at a school, newest first, and per class the roster
// / scores / attendance the PL-219 class report already computes (its loader
// is reused, not re-queried), plus the links to the report and the class
// detail. Read-only, staff.
//
//   GET /api/admin/school-classes?school=<id>  → { rows: ClassHistoryRow[] }
//   GET /api/admin/school-classes?class=<id>   → { detail: ClassHistoryDetail }

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export type ClassHistoryRow = {
  id: string
  slug: string | null
  term: string | null
  classType: string
  status: string
  group: string
  firstSession: string | null
  lastSession: string | null
  instructorName: string | null
  enrolled: number
  paid: number
}

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(req.url)
  const schoolId = url.searchParams.get('school')
  const classId = url.searchParams.get('class')
  const today = new Date().toLocaleDateString('en-CA')

  if (schoolId) {
    const { data, error } = await supabase
      .from('classes')
      .select('id, slug, class_type, status, start_date, registration_close_date, delivery_mode, course_key, fo_short_name, instructors ( name ), sessions ( session_date ), enrollments ( payment_status )')
      .eq('school_id', schoolId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows: ClassHistoryRow[] = ((data as any[]) ?? [])
      .map((c) => {
        const { first, last } = classDays(c)
        const ens = (c.enrollments ?? []) as { payment_status: string }[]
        return {
          id: c.id,
          slug: c.slug,
          term: classTerm(c),
          classType: c.class_type,
          status: c.status,
          group: classGroup(c, today),
          firstSession: first,
          lastSession: last,
          instructorName: one<any>(c.instructors)?.name ?? null,
          enrolled: ens.filter((e) => ['Paid', 'Completed', 'Pending'].includes(e.payment_status)).length,
          paid: ens.filter((e) => ['Paid', 'Completed'].includes(e.payment_status)).length,
        }
      })
      // newest first by first session (start date when session-less)
      .sort((a, b) => String(b.firstSession ?? '').localeCompare(String(a.firstSession ?? '')))
    return NextResponse.json({ rows })
  }

  if (classId) {
    const { data: cls } = await supabase
      .from('classes')
      .select('id, slug, class_type, status, start_date, school_id, enrollments ( id, payment_status, comms_muted, cancellation_outcome, class_cancelled, enrolled_at, students ( first_name, last_name, families ( parent_email ) ) )')
      .eq('id', classId)
      .maybeSingle()
    if (!cls) return NextResponse.json({ error: 'No such class.' }, { status: 404 })
    const roster = ((cls.enrollments ?? []) as any[])
      .map((e) => {
        const st = one<any>(e.students)
        return {
          enrollmentId: e.id,
          name: st ? `${st.first_name} ${st.last_name}` : '—',
          parentEmail: one<any>(st?.families)?.parent_email ?? null,
          paymentStatus: e.payment_status,
          commsState: e.comms_muted ? 'muted' : 'normal',
          cancellationOutcome: e.cancellation_outcome ?? null,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    if (cls.status === 'cancelled') {
      // A cancelled class shows its cancellation facts, never a score table —
      // the class never ran. (No free-text note is stored at cancellation; the
      // note is composed from what the cancel route recorded per enrollment.)
      const outcomes: Record<string, number> = {}
      for (const r of roster) {
        const k = r.cancellationOutcome ?? (r.paymentStatus === 'Refunded' ? 'refunded' : 'no outcome recorded')
        outcomes[k] = (outcomes[k] ?? 0) + 1
      }
      const note = roster.length
        ? `Cancelled with ${roster.length} on the roster — ${Object.entries(outcomes).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ')}.`
        : 'Cancelled before anyone registered.'
      return NextResponse.json({
        detail: { classId: cls.id, status: 'cancelled', cancellation: { note, outcomes }, roster, report: null, links: { detail: `/admin?class=${cls.id}`, report: null } },
      })
    }
    const report = await loadClassReport(classId)
    const withScores = report ? report.students.filter((s) => s.initial || s.final) : []
    const improvements = withScores.map((s) => s.gained).filter((g): g is number => g != null)
    const scores = report
      ? {
          sections: report.sections,
          students: report.students.map((s) => ({ id: s.id, name: s.name, initial: s.initial, final: s.final, gained: s.gained, attendancePct: s.attendancePct })),
          classAverage: { initial: report.averages.initialTotal, final: report.averages.finalTotal },
          averageImprovement: improvements.length ? Math.round((improvements.reduce((a, b) => a + b, 0) / improvements.length) * 10) / 10 : null,
          scored: withScores.length,
        }
      : null
    const attendance = report && report.averages.avgAttendancePct != null
      ? { averagePct: report.averages.avgAttendancePct, students: report.students.filter((s) => s.attendancePct != null).length }
      : null
    return NextResponse.json({
      detail: {
        classId: cls.id,
        status: cls.status,
        cancellation: null,
        roster,
        report: scores,
        attendance,
        links: { detail: `/admin?class=${cls.id}`, report: `/class-report/${cls.id}` },
      },
    })
  }
  return NextResponse.json({ error: 'Pass ?school= or ?class=.' }, { status: 400 })
}
