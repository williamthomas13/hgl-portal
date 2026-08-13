import { supabaseAdmin as supabase } from './supabase-admin'

// PL-344: the Recent Activity feed's ONE builder — the dashboard's first
// page and the "Show earlier activity" pages both come from here, so the
// same-day grouping keys, copy, and deep links can never drift between page
// one and history. Derived and read-only (PL-100): nothing is stored,
// nothing is deleted — paging is a display window over live records.
//
// Each source pages on its own clock column with a shared `before` cursor;
// rows merge newest-first and slice to `limit`. A `type` filter skips the
// sources that can't produce that type, so filtered paging walks the WHOLE
// history rather than sieving already-loaded pages.

export type ActivityRow = {
  id: string
  when: string
  text: string
  href: string
  /** PL-134: the filter chips derive from this set — a new type appears
   *  automatically rather than needing the chip list edited. */
  type?: string
  /** PL-134: day + type + target; rows sharing one collapse into a group. */
  groupKey?: string
  /** PL-134: the class/school label a grouped row names. */
  groupLabel?: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export type ActivityPage = { rows: ActivityRow[]; hasMore: boolean }

export async function loadActivity(opts: {
  /** Only rows strictly OLDER than this instant (ISO); null = newest page. */
  before?: string | null
  limit: number
  /** PL-134 chip filter, applied across the whole history. */
  type?: string | null
}): Promise<ActivityPage> {
  const { before = null, limit, type = null } = opts
  const fetchN = limit + 1 // one extra per source = an honest hasMore
  const wants = (t: string) => !type || type === t
  const none = Promise.resolve({ data: [] as any[] })

  const enrollmentsQ = () => {
    let q = supabase
      .from('enrollments')
      .select('id, enrolled_at, class_id, payment_status, students ( first_name, last_name ), classes ( class_type, schools ( nickname ) )')
      .not('enrolled_at', 'is', null)
    if (before) q = q.lt('enrolled_at', before)
    return q.order('enrolled_at', { ascending: false }).limit(fetchN)
  }
  const paidQ = () => {
    let q = supabase
      .from('tutoring_invoices')
      .select('id, paid_at, total, families ( parent_first_name, parent_last_name )')
      .not('paid_at', 'is', null)
    if (before) q = q.lt('paid_at', before)
    return q.order('paid_at', { ascending: false }).limit(fetchN)
  }
  const availQ = () => {
    let q = supabase
      .from('student_availability')
      .select('student_id, updated_at, students ( first_name, last_name )')
      .eq('source', 'parent')
    if (before) q = q.lt('updated_at', before)
    return q.order('updated_at', { ascending: false }).limit(fetchN)
  }
  const timecardsQ = () => {
    let q = supabase
      .from('timecards')
      .select('id, tutor_confirmed_at, total_hours, instructors ( name, email )')
      .not('tutor_confirmed_at', 'is', null)
    if (before) q = q.lt('tutor_confirmed_at', before)
    return q.order('tutor_confirmed_at', { ascending: false }).limit(fetchN)
  }
  const newLeadsQ = () => {
    let q = supabase.from('leads').select('id, student_name, created_at, source')
    if (before) q = q.lt('created_at', before)
    return q.order('created_at', { ascending: false }).limit(fetchN)
  }
  // PL-336: pipeline wins join the feed.
  const convertedQ = () => {
    let q = supabase
      .from('leads')
      .select('id, student_name, contact_name, converted_at, converted_label')
      .not('converted_at', 'is', null)
    if (before) q = q.lt('converted_at', before)
    return q.order('converted_at', { ascending: false }).limit(fetchN)
  }
  // PL-191: schedule events — an engagement row carries TWO clocks, so the
  // cursor is re-applied per produced row below; the query just over-fetches.
  const schedEngsQ = () => {
    let q = supabase
      .from('tutoring_engagements')
      .select(
        `id, status, approval_requested_at, parent_approved_at, updated_at,
         students ( first_name, last_name, family_id ), subjects ( name )`
      )
      .or('approval_requested_at.not.is.null,parent_approved_at.not.is.null')
    if (before) q = q.or(`approval_requested_at.lt.${before},parent_approved_at.lt.${before}`)
    return q.order('updated_at', { ascending: false }).limit(fetchN)
  }
  const schedMovesQ = () => {
    let q = supabase
      .from('tutoring_sessions')
      .select(
        `id, status, starts_at, updated_at, parent_rescheduled_at,
         students ( first_name, last_name, family_id ),
         replacement:rescheduled_to_id ( starts_at )`
      )
      .in('status', ['rescheduled', 'cancelled'])
    if (before) q = q.lt('updated_at', before)
    return q.order('updated_at', { ascending: false }).limit(fetchN)
  }

  const [enrollments, paidInvoices, avail, timecards, newLeads, convertedLeads, schedEngs, schedMoves] =
    await Promise.all([
      wants('Registrations') ? enrollmentsQ() : none,
      wants('Payments') ? paidQ() : none,
      wants('Availability') ? availQ() : none,
      wants('Timecards') ? timecardsQ() : none,
      wants('Prospective students') ? newLeadsQ() : none,
      wants('Prospective students') ? convertedQ() : none,
      wants('Schedule') ? schedEngsQ() : none,
      wants('Schedule') ? schedMovesQ() : none,
    ])

  const rows: ActivityRow[] = []
  for (const e of ((enrollments as any).data as any[]) ?? []) {
    const st = one<any>(e.students)
    const cls = one<any>(e.classes)
    rows.push({
      id: `en-${e.id}`,
      type: 'Registrations',
      // PL-134: same day + same type + same class collapses to one row.
      groupKey: `Registrations|${e.class_id}`,
      when: e.enrolled_at,
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A student'} registered for ${one<any>(cls?.schools)?.nickname ?? ''} ${cls?.class_type ?? 'a class'} (${e.payment_status}).`,
      groupLabel: `${one<any>(cls?.schools)?.nickname ?? ''} ${cls?.class_type ?? 'a class'}`.trim(),
      href: `/admin?class=${e.class_id}`,
    })
  }
  for (const i of ((paidInvoices as any).data as any[]) ?? []) {
    const fam = one<any>(i.families)
    rows.push({
      id: `paid-${i.id}`,
      type: 'Payments',
      groupKey: 'Payments',
      when: i.paid_at,
      text: `Payment received — ${fam ? `${fam.parent_first_name} ${fam.parent_last_name}` : 'a family'} paid $${Number(i.total).toFixed(2)}.`,
      href: `/admin/tutoring?invoice=${i.id}`,
    })
  }
  const seenAvail = new Set<string>()
  for (const a of ((avail as any).data as any[]) ?? []) {
    if (seenAvail.has(a.student_id)) continue
    seenAvail.add(a.student_id)
    const st = one<any>(a.students)
    rows.push({
      id: `av-${a.student_id}-${a.updated_at}`,
      type: 'Availability',
      groupKey: 'Availability',
      when: a.updated_at,
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A family'}'s family shared availability.`,
      href: `/admin/tutoring?schedule=${a.student_id}`,
    })
  }
  for (const t of ((timecards as any).data as any[]) ?? []) {
    const ins = one<any>(t.instructors)
    rows.push({
      id: `tc-${t.id}`,
      type: 'Timecards',
      groupKey: 'Timecards',
      when: t.tutor_confirmed_at,
      text: `${ins?.name ?? ins?.email ?? 'A tutor'} confirmed their timecard (${Number(t.total_hours)} hours).`,
      href: `/admin/tutoring`,
    })
  }
  for (const l of ((newLeads as any).data as any[]) ?? []) {
    rows.push({
      id: `lead-${l.id}`,
      type: 'Prospective students',
      groupKey: 'Prospective students',
      when: l.created_at,
      text: `New prospective student — ${l.student_name ?? 'name pending'}${l.source ? ` (via ${l.source})` : ''}.`,
      href: `/admin/leads?lead=${l.id}`,
    })
  }
  for (const l of ((convertedLeads as any).data as any[]) ?? []) {
    rows.push({
      id: `lead-converted-${l.id}`,
      type: 'Prospective students',
      groupKey: 'Prospective students',
      when: l.converted_at,
      text: `${l.student_name ?? l.contact_name ?? 'A prospective student'} enrolled${
        l.converted_label ? ` — ${l.converted_label}` : ''
      } — their pipeline row is marked Enrolled.`,
      href: `/admin/leads?lead=${l.id}`,
    })
  }
  for (const eng of ((schedEngs as any).data as any[]) ?? []) {
    const st = one<any>(eng.students)
    const who = st ? `${st.first_name} ${st.last_name}` : 'a student'
    const subj = one<any>(eng.subjects)?.name ?? 'tutoring'
    const href = `/admin/tutoring?family=${st?.family_id ?? ''}`
    if (eng.approval_requested_at) {
      rows.push({
        id: `sched-prop-${eng.id}`,
        type: 'Schedule',
        groupKey: 'Schedule',
        when: eng.approval_requested_at,
        text: `Schedule proposed to ${who}'s family (${subj}) — awaiting their confirmation.`,
        href,
      })
    }
    if (eng.parent_approved_at) {
      rows.push({
        id: `sched-conf-${eng.id}`,
        type: 'Schedule',
        groupKey: 'Schedule',
        when: eng.parent_approved_at,
        text: `${who}'s family confirmed the ${subj} schedule.`,
        href,
      })
    }
  }
  for (const s of ((schedMoves as any).data as any[]) ?? []) {
    const st = one<any>(s.students)
    const who = st ? `${st.first_name} ${st.last_name}` : 'a student'
    const moved = one<any>(s.replacement)
    rows.push({
      id: `sched-${s.status}-${s.id}`,
      type: 'Schedule',
      groupKey: 'Schedule',
      when: s.updated_at,
      text:
        s.status === 'rescheduled'
          ? `${who}'s session moved${moved ? ` to ${new Date(moved.starts_at).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })}` : ''}${s.parent_rescheduled_at ? ' (family self-serve)' : ''}.`
          : `${who}'s session was cancelled.`,
      href: `/admin/tutoring?family=${st?.family_id ?? ''}`,
    })
  }

  // The cursor is authoritative per ROW (a source row can carry two clocks).
  const paged = rows.filter((r) => r.when && (!before || r.when < before))
  paged.sort((a, b) => String(b.when).localeCompare(String(a.when)))
  return { rows: paged.slice(0, limit), hasMore: paged.length > limit }
}
