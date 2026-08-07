import { supabaseAdmin as supabase } from './supabase-admin'
import { adminAllowlist } from './portal-auth'
import { escapeLike } from './like-escape'
import { summarizeAttendance, type AttendanceRecord } from './attendance'

// PL-219 v1: the per-class performance report — the hand-built "Digital SAT
// Course Report" sheet computed from live portal data (student_scores,
// attendance_records, enrollments). Never stored, never stale: a view of the
// class, exactly like collateral. Honest data throughout — a student who
// skipped a test renders blank, never zero-filled.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export type ReportScore = { sections: Record<string, number>; total: number }
export type ReportStudent = {
  id: string
  name: string
  initial: ReportScore | null
  final: ReportScore | null
  gained: number | null
  superscore: number | null
  attendancePct: number | null
}
export type ClassReport = {
  classId: string
  label: string
  classType: string
  schoolName: string
  schoolNickname: string
  instructorName: string | null
  firstSession: string | null
  lastSession: string | null
  sections: string[]
  students: ReportStudent[]
  averages: {
    initialBySection: Record<string, number>
    finalBySection: Record<string, number>
    initialTotal: number | null
    finalTotal: number | null
    avgGain: number | null
    avgAttendancePct: number | null
  }
  /** Average gain bucketed by initial score — "who benefits most". */
  buckets: { label: string; count: number; avgGain: number }[]
  /** PL-219 v1.5: survey aggregates (respondent identity never surfaces
   *  here — aggregates and comments only). */
  survey: {
    responses: number
    avgSatisfaction: number | null
    avgRecommend: number | null
    avgInstructorRating: number | null
    comments: string[]
  } | null
}

const round = (n: number) => Math.round(n * 10) / 10

/** Who may see this class's report: staff, the class's instructor, or an
 *  actively-affiliated counselor at its school (they already see rosters and
 *  scores — same trust boundary as the live counselor view). */
export async function canViewClassReport(
  email: string,
  classId: string
): Promise<'admin' | 'manager' | 'instructor' | 'counselor' | null> {
  const lower = email.trim().toLowerCase()
  const { data: cls } = await supabase
    .from('classes')
    .select('school_id, instructor_id, instructors ( email, active )')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return null
  const [profile, affiliation] = await Promise.all([
    supabase.from('profiles').select('role').ilike('email', escapeLike(lower)).limit(1),
    cls.school_id
      ? supabase
          .from('school_affiliations')
          .select('id, contacts!inner(email)')
          .eq('school_id', cls.school_id)
          .is('ended_at', null)
          .ilike('contacts.email', escapeLike(lower))
          .limit(1)
      : Promise.resolve({ data: [] }),
  ])
  const role = profile.data?.[0]?.role
  if (role === 'admin' || adminAllowlist().includes(lower)) return 'admin'
  if (role === 'manager') return 'manager'
  const instructor = one<any>(cls.instructors)
  // PL-213: instructor identity requires active.
  if (instructor?.email?.toLowerCase() === lower && instructor?.active) return 'instructor'
  if ((affiliation.data?.length ?? 0) > 0) return 'counselor'
  return null
}

export async function loadClassReport(classId: string): Promise<ClassReport | null> {
  const { data: cls } = await supabase
    .from('classes')
    .select(
      `id, class_type, start_date, status,
       schools ( name, nickname ),
       instructors ( name ),
       sessions ( id, session_date, start_time, end_time ),
       enrollments ( id, payment_status, student_id,
         students ( id, first_name, last_name ),
         attendance_records ( session_id, enrollment_id, present, arrived_late, left_early, minutes_late, minutes_left_early ) )`
    )
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return null

  const school = one<any>(cls.schools)
  const sessions = ((cls.sessions ?? []) as any[]).sort((a, b) =>
    String(a.session_date).localeCompare(String(b.session_date))
  )
  const enrollments = ((cls.enrollments ?? []) as any[]).filter((e) =>
    ['Paid', 'Completed'].includes(e.payment_status)
  )
  const studentIds = enrollments.map((e) => e.student_id)

  // Scores FOR THIS CLASS only (standalone diagnostics stay out of a class
  // report). Initial = the earliest test, final = the latest DIFFERENT test.
  const { data: scoreRows } = studentIds.length
    ? await supabase
        .from('student_scores')
        .select('student_id, test_label, section_scores, total, taken_at')
        .eq('class_id', classId)
        .in('student_id', studentIds)
        .order('taken_at', { ascending: true })
    : { data: [] }

  const sections = [
    ...new Set(
      ((scoreRows as any[]) ?? []).flatMap((r) => Object.keys(r.section_scores ?? {}))
    ),
  ]

  const scoresByStudent = new Map<string, any[]>()
  for (const r of (scoreRows as any[]) ?? []) {
    const list = scoresByStudent.get(r.student_id) ?? []
    list.push(r)
    scoresByStudent.set(r.student_id, list)
  }

  const toScore = (r: any): ReportScore => ({
    sections: Object.fromEntries(
      Object.entries(r.section_scores ?? {}).map(([k, v]) => [k, Number(v)])
    ),
    total: Number(r.total),
  })

  const students: ReportStudent[] = enrollments
    .map((e) => {
      const stu = one<any>(e.students)
      const tests = scoresByStudent.get(e.student_id) ?? []
      const initial = tests.length > 0 ? toScore(tests[0]) : null
      const final = tests.length > 1 ? toScore(tests[tests.length - 1]) : null
      // Superscore: best section results across every test — summed for
      // SAT/PSAT. For the ACT (PL-286 fix) it's the ROUNDED AVERAGE of the
      // best English/Math/Reading — the composite sections; Science (optional
      // now) never counts toward a composite. The old unconditional sum put a
      // ~144-scale number next to 1–36 composites on an ACT report. Only
      // meaningful once two tests exist.
      let superscore: number | null = null
      if (tests.length > 1 && sections.length > 0) {
        const isACT = String(cls.class_type ?? '').toUpperCase().includes('ACT')
        const superSections = isACT ? sections.filter((sec) => sec !== 'Science') : sections
        const bests = superSections
          .map((sec) =>
            Math.max(...tests.map((t) => Number(t.section_scores?.[sec] ?? Number.NEGATIVE_INFINITY)))
          )
          .filter((n) => Number.isFinite(n))
        if (bests.length > 0) {
          const sum = bests.reduce((s, n) => s + n, 0)
          superscore = isACT ? Math.round(sum / bests.length) : sum
        }
        if (superscore === 0) superscore = null
      }
      const att = summarizeAttendance(
        sessions,
        (e.attendance_records ?? []) as AttendanceRecord[],
        e.id
      )
      return {
        id: e.student_id,
        name: stu ? `${stu.first_name} ${stu.last_name}` : '—',
        initial,
        final,
        gained: initial && final ? final.total - initial.total : null,
        superscore,
        attendancePct: att.percent,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const avgOf = (ns: number[]) => (ns.length ? round(ns.reduce((s, n) => s + n, 0) / ns.length) : null)
  const initialBySection: Record<string, number> = {}
  const finalBySection: Record<string, number> = {}
  for (const sec of sections) {
    const ini = students.map((s) => s.initial?.sections[sec]).filter((n): n is number => n != null)
    const fin = students.map((s) => s.final?.sections[sec]).filter((n): n is number => n != null)
    if (ini.length) initialBySection[sec] = avgOf(ini)!
    if (fin.length) finalBySection[sec] = avgOf(fin)!
  }

  // Buckets by initial total — up to four equal-width bands over the
  // observed range (works for SAT 400–1600 and ACT 1–36 alike).
  const withBoth = students.filter((s) => s.initial && s.gained != null)
  const buckets: ClassReport['buckets'] = []
  if (withBoth.length >= 2) {
    const totals = withBoth.map((s) => s.initial!.total)
    const min = Math.min(...totals)
    const max = Math.max(...totals)
    const bands = Math.min(4, new Set(totals).size)
    const width = Math.max(1, Math.ceil((max - min + 1) / bands))
    for (let b = 0; b < bands; b++) {
      const lo = min + b * width
      const hi = Math.min(max, lo + width - 1)
      const inBand = withBoth.filter((s) => s.initial!.total >= lo && s.initial!.total <= hi)
      if (inBand.length === 0) continue
      buckets.push({
        label: lo === hi ? String(lo) : `${lo}–${hi}`,
        count: inBand.length,
        avgGain: avgOf(inBand.map((s) => s.gained!))!,
      })
    }
  }

  // Survey aggregates — the v1.5 block. Identity never leaves this function:
  // only counts, averages, and the free-text comments.
  const { data: surveyRows } = await supabase
    .from('class_survey_responses')
    .select('satisfaction, recommend, instructor_rating, most_useful')
    .eq('class_id', classId)
  const sv = (surveyRows as any[]) ?? []
  const avgRating = (k: string) => {
    const ns = sv.map((r) => r[k]).filter((n): n is number => n != null)
    return ns.length ? round(ns.reduce((s, n) => s + n, 0) / ns.length) : null
  }

  return {
    classId: cls.id,
    label: `${school?.nickname ?? school?.name ?? 'HGL'} ${cls.class_type}`,
    classType: cls.class_type,
    schoolName: school?.name ?? '',
    schoolNickname: school?.nickname ?? school?.name ?? '',
    instructorName: one<any>(cls.instructors)?.name ?? null,
    firstSession: sessions[0]?.session_date ?? cls.start_date ?? null,
    lastSession: sessions[sessions.length - 1]?.session_date ?? cls.start_date ?? null,
    sections,
    students,
    averages: {
      initialBySection,
      finalBySection,
      initialTotal: avgOf(students.map((s) => s.initial?.total).filter((n): n is number => n != null)),
      finalTotal: avgOf(students.map((s) => s.final?.total).filter((n): n is number => n != null)),
      avgGain: avgOf(students.map((s) => s.gained).filter((n): n is number => n != null)),
      avgAttendancePct: avgOf(
        students.map((s) => s.attendancePct).filter((n): n is number => n != null)
      ),
    },
    buckets,
    survey:
      sv.length > 0
        ? {
            responses: sv.length,
            avgSatisfaction: avgRating('satisfaction'),
            avgRecommend: avgRating('recommend'),
            avgInstructorRating: avgRating('instructor_rating'),
            comments: sv.map((r) => (r.most_useful ?? '').trim()).filter(Boolean),
          }
        : null,
  }
}

/** The anonymized flavor: averages/distributions only, no student names —
 *  safe for prospecting. Names stripped server-side, never hidden in a UI. */
export function anonymizeClassReport(report: ClassReport): ClassReport {
  return {
    ...report,
    students: report.students.map((s, i) => ({ ...s, id: `anon-${i}`, name: `Student ${i + 1}` })),
  }
}
