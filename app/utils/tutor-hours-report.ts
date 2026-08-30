import { supabaseAdmin as supabase } from './supabase-admin'
import { CLASS_WORK_TYPE, DEFAULT_TUTORING_WORK_TYPE, sessionMinutes, TEST_PREP_WORK_TYPE, PREP_WORK_TYPE } from './work-types'

// PL-218: the tutor hours breakdown report — the hand-built Google-Calendar
// spreadsheet (per-tutor tabs, work-category rows × month columns, totals,
// in-person/online split, revenue) computed from portal data instead.
//
// Category rows come from EXISTING data, never a new taxonomy:
//   · 1-on-1 sessions by subjects.category + subject (the wizard's own split)
//   · non-default work types (the PL-103 pay-type titles) as their own rows
//   · class/workshop sessions as one row (the PL-103 timecard split)
//   · consults from the leads pipeline (30-minute entries)
// Revenue reads the SAME paid columns the QBO sync reads (paid
// tutoring_invoices → their session-linked lines; the PL-204 principle), so
// this report and QBO can't structurally disagree. NO wages anywhere — pay
// rates and dollar math live in QBO; the CSV's stable category keys are the
// join handle for that QBO-side work.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

const REPORT_TZ = 'America/Denver' // the payroll calendar, same as timecards

export type TutorHoursRow = {
  /** Stable machine key for the QBO-side join, e.g. "1on1:ACT/SAT:SAT". */
  key: string
  label: string
  hoursByMonth: Record<string, number>
  totalHours: number
  avgHoursPerMonth: number
  /** Admin-only: paid, session-linked invoice-line dollars in this category. */
  revenue?: number
  /** Admin-only: the subject's list rate where one applies. */
  listRate?: number | null
}

export type TutorHoursReport = {
  role: 'admin' | 'manager'
  tutors: { id: string; name: string }[]
  months: string[]
  rows: TutorHoursRow[]
  totalsByMonth: Record<string, number>
  grandTotalHours: number
  split: { inPersonHours: number; onlineHours: number; unknownHours: number }
  /** Honest-data note: the portal's history starts here — earlier months
   *  render empty because the data doesn't exist, not because hours were 0. */
  earliestSession: string | null
}

function monthOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: REPORT_TZ }).slice(0, 7)
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out.slice(0, 36) // hard cap — a typo'd range shouldn't build 500 columns
}

const isUrl = (s: string | null | undefined) => /^https?:\/\//i.test((s ?? '').trim())

// Plain-English category names — the enum stays in the KEY (stable for the
// QBO-side join), never in what a human reads.
const CATEGORY_LABELS: Record<string, string> = {
  test_prep: 'Test prep',
  subject_tutoring: 'Subject tutoring',
}

export async function loadTutorHoursReport(opts: {
  tutorId: string | 'all'
  fromMonth: string // YYYY-MM inclusive
  toMonth: string // YYYY-MM inclusive
}): Promise<TutorHoursReport> {
  const months = monthsBetween(opts.fromMonth, opts.toMonth)
  const fromIso = `${opts.fromMonth}-01T00:00:00Z`
  // generous UTC pad; exact month attribution happens in Denver below
  const toIso = `${opts.toMonth}-28T23:59:59Z`
  const toPadIso = new Date(new Date(toIso).getTime() + 5 * 86400_000).toISOString()
  const nowIso = new Date().toISOString()
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: REPORT_TZ })

  const [tutorsRes, sesRes, clsRes, leadsRes, earliestRes] = await Promise.all([
    supabase.from('instructors').select('id, name, email').eq('active', true).order('name'),
    supabase
      .from('tutoring_sessions')
      .select(
        `id, tutor_id, starts_at, duration_minutes, status, reschedule_notice, work_type, prep_minutes,
         tutoring_engagements ( location, hourly_rate,
           subjects ( name, category, hourly_rate ),
           instructors ( default_meeting_link ) )`
      )
      .gte('starts_at', fromIso)
      .lte('starts_at', toPadIso)
      .lte('starts_at', nowIso)
      .in('status', ['completed', 'no_show', 'forfeited', 'rescheduled']),
    supabase
      .from('sessions')
      .select(
        `id, session_date, start_time, end_time,
         classes!inner ( class_type, status, instructor_id, delivery_mode, schools ( nickname ) )`
      )
      .gte('session_date', `${opts.fromMonth}-01`)
      .lte('session_date', `${opts.toMonth}-31`)
      .neq('classes.status', 'cancelled'),
    supabase
      .from('leads')
      .select('id, consult_at, consult_owner_email, consult_mode')
      .not('consult_at', 'is', null)
      .gte('consult_at', fromIso)
      .lte('consult_at', toPadIso)
      .lte('consult_at', nowIso),
    supabase
      .from('tutoring_sessions')
      .select('starts_at')
      .order('starts_at', { ascending: true })
      .limit(1),
  ])

  const tutors = ((tutorsRes.data as any[]) ?? []).map((t) => ({
    id: t.id,
    name: t.name ?? t.email,
  }))
  const tutorEmailById = new Map(((tutorsRes.data as any[]) ?? []).map((t) => [t.id, (t.email ?? '').toLowerCase()]))
  const wantTutor = (tutorId: string) => opts.tutorId === 'all' || tutorId === opts.tutorId

  const rowsByKey = new Map<string, TutorHoursRow>()
  const row = (key: string, label: string, listRate: number | null) => {
    let r = rowsByKey.get(key)
    if (!r) {
      r = { key, label, hoursByMonth: {}, totalHours: 0, avgHoursPerMonth: 0, revenue: 0, listRate }
      rowsByKey.set(key, r)
    }
    return r
  }
  const add = (r: TutorHoursRow, month: string, hours: number) => {
    if (!months.includes(month)) return
    r.hoursByMonth[month] = Number(((r.hoursByMonth[month] ?? 0) + hours).toFixed(2))
    r.totalHours = Number((r.totalHours + hours).toFixed(2))
  }

  const split = { inPersonHours: 0, onlineHours: 0, unknownHours: 0 }
  const addSplit = (kind: 'in' | 'on' | 'un', hours: number) => {
    if (kind === 'in') split.inPersonHours = Number((split.inPersonHours + hours).toFixed(2))
    else if (kind === 'on') split.onlineHours = Number((split.onlineHours + hours).toFixed(2))
    else split.unknownHours = Number((split.unknownHours + hours).toFixed(2))
  }

  // --- 1-on-1 sessions (the timecards' payable rule) -----------------------
  const categoryBySession = new Map<string, string>()
  for (const s of (sesRes.data as any[]) ?? []) {
    if (!wantTutor(s.tutor_id)) continue
    const payable =
      ['completed', 'no_show', 'forfeited'].includes(s.status) ||
      (s.status === 'rescheduled' && s.reschedule_notice === 'late')
    if (!payable) continue
    const month = monthOf(s.starts_at)
    if (!months.includes(month)) continue
    const hours = s.duration_minutes / 60
    const eng = one<any>(s.tutoring_engagements)
    const subject = one<any>(eng?.subjects)
    const workType = s.work_type ?? DEFAULT_TUTORING_WORK_TYPE
    let r: TutorHoursRow
    // PL-412A: 'Test Prep' is the subject-derived DEFAULT for exam sessions
    // — those are ordinary 1-on-1 sessions payroll-wise, so they keep the
    // subject split (and its rate/revenue attribution) instead of collapsing
    // into a single worktype row the moment the default lands.
    if (workType !== DEFAULT_TUTORING_WORK_TYPE && workType !== TEST_PREP_WORK_TYPE && workType !== CLASS_WORK_TYPE) {
      // A pay-type title (PL-103) is its own payroll category — QBO treats it
      // separately, so the report does too.
      r = row(`worktype:${workType}`, workType, null)
    } else {
      const cat = subject?.category ?? 'Tutoring'
      const name = subject?.name ?? '1-on-1'
      r = row(
        `1on1:${cat}:${name}`,
        `${name} (${CATEGORY_LABELS[cat] ?? cat})`,
        subject?.hourly_rate != null ? Number(subject.hourly_rate) : null
      )
    }
    add(r, month, hours)
    categoryBySession.set(s.id, r.key)
    // PL-412B: prep minutes are their own payroll category, like any
    // pay-type title.
    if ((s.prep_minutes ?? 0) > 0) {
      add(row(`worktype:${PREP_WORK_TYPE}`, PREP_WORK_TYPE, null), month, Number(s.prep_minutes) / 60)
    }
    const loc = (eng?.location ?? '').trim() || (one<any>(eng?.instructors)?.default_meeting_link ?? '').trim()
    addSplit(loc ? (isUrl(loc) ? 'on' : 'in') : 'un', hours)
  }

  // --- class / workshop sessions (taught, past, not cancelled) -------------
  for (const s of (clsRes.data as any[]) ?? []) {
    const cls = one<any>(s.classes)
    if (!cls || !wantTutor(cls.instructor_id)) continue
    if (s.session_date > todayLocal) continue
    const month = s.session_date.slice(0, 7)
    if (!months.includes(month)) continue
    const hours = sessionMinutes(s.start_time, s.end_time) / 60
    if (hours <= 0) continue
    const r = row(`class:${CLASS_WORK_TYPE}`, `${CLASS_WORK_TYPE} (classes)`, null)
    add(r, month, hours)
    addSplit(cls.delivery_mode === 'online' ? 'on' : 'in', hours)
  }

  // --- consults (leads pipeline, 30-minute entries) ------------------------
  for (const l of (leadsRes.data as any[]) ?? []) {
    const owner = (l.consult_owner_email ?? '').toLowerCase()
    if (!owner) continue
    const tutorId = [...tutorEmailById.entries()].find(([, em]) => em === owner)?.[0]
    if (!tutorId || !wantTutor(tutorId)) continue
    const month = monthOf(l.consult_at)
    if (!months.includes(month)) continue
    const r = row('consult:30min', 'Consults (30 min)', null)
    add(r, month, 0.5)
    addSplit(l.consult_mode === 'in_person' ? 'in' : 'on', 0.5)
  }

  // --- revenue: paid invoices → their session-linked lines -----------------
  const sessionIds = [...categoryBySession.keys()]
  if (sessionIds.length > 0) {
    // Chunk the IN list — a long range can hold thousands of sessions.
    for (let i = 0; i < sessionIds.length; i += 400) {
      const chunk = sessionIds.slice(i, i + 400)
      const { data: lines } = await supabase
        .from('tutoring_invoice_lines')
        .select('session_id, amount, tutoring_invoices!inner ( status )')
        .in('session_id', chunk)
        .eq('tutoring_invoices.status', 'paid')
      for (const ln of (lines as any[]) ?? []) {
        const key = categoryBySession.get(ln.session_id)
        if (!key) continue
        const r = rowsByKey.get(key)
        if (r) r.revenue = Number(((r.revenue ?? 0) + Number(ln.amount)).toFixed(2))
      }
    }
  }

  const rows = [...rowsByKey.values()]
    .map((r) => ({
      ...r,
      avgHoursPerMonth: Number((r.totalHours / Math.max(1, months.length)).toFixed(2)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const totalsByMonth: Record<string, number> = {}
  for (const m of months) {
    totalsByMonth[m] = Number(
      rows.reduce((sum, r) => sum + (r.hoursByMonth[m] ?? 0), 0).toFixed(2)
    )
  }

  return {
    role: 'admin',
    tutors,
    months,
    rows,
    totalsByMonth,
    grandTotalHours: Number(rows.reduce((s, r) => s + r.totalHours, 0).toFixed(2)),
    split,
    earliestSession: (earliestRes.data as any[])?.[0]?.starts_at?.slice(0, 10) ?? null,
  }
}

/** PL-204 amendment applied here too: aggregate revenue is ADMIN-ONLY. The
 *  manager variant is hours-only — dollar fields are REMOVED server-side,
 *  never hidden client-side. */
export function stripTutorHoursRevenue(report: TutorHoursReport): TutorHoursReport {
  return {
    ...report,
    role: 'manager',
    rows: report.rows.map((r) => {
      const rest = { ...r }
      delete rest.revenue
      delete rest.listRate
      return rest
    }),
  }
}
