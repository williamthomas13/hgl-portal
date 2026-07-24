import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { AVAILABILITY_PROPOSAL_BUSINESS_DAYS, addBusinessDays } from '../../../utils/dates'

// PL-100: the dashboard's data. Needs Attention mirrors the internal alert
// family but is STATE-DRIVEN, never send-driven (Scarlett's explicit
// requirement): every row derives from whether the condition is STILL true
// right now, so resolving it anywhere — the email, the record page, a
// portal action — clears the row automatically. Each row deep-links its
// record (the PL-92 standing rule). Recent Activity is read-only.
//
// Not derivable from state (email alert remains the surface): the Stripe
// webhook mismatch (no unmatched-payment table — the alert's match link is
// the tool) and waitlist rollovers (the PL-94 sweep self-heals them).

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export type AttentionRow = {
  id: string
  kind: string
  text: string
  href: string
  urgent?: boolean
}
export type ActivityRow = { id: string; when: string; text: string; href: string }

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const now = new Date()
  const todayIso = now.toISOString().slice(0, 10)
  const attention: AttentionRow[] = []
  const activity: ActivityRow[] = []

  const [
    { data: classes },
    { data: invoices },
    { data: qboFailed },
    { data: intakeLeads },
    { data: covRaw },
    { data: awaitingCards },
    { data: reschedules },
    { data: strandedProposals },
    { data: availStudents },
    { data: refundRequests },
    { data: recentEnrollments },
    { data: recentPaidInvoices },
    { data: recentAvail },
    { data: recentTimecards },
    { data: recentLeads },
  ] = await Promise.all([
    supabase
      .from('classes')
      .select(
        `id, class_type, instructor_id, status, min_enrollment, enrollment_deadline, default_location, delivery_mode, start_date,
         schools ( nickname ), sessions ( session_date ), enrollments ( payment_status )`
      )
      .neq('status', 'cancelled'),
    supabase
      .from('tutoring_invoices')
      .select('id, family_id, status, due_at, total, families ( parent_first_name, parent_last_name )')
      .in('status', ['invoiced', 'past_due']),
    supabase.from('qbo_sync_log').select('id, kind, last_error').eq('status', 'failed').limit(20),
    supabase.from('leads').select('id, student_name, status').eq('status', 'intake_complete'),
    supabase
      .from('coverage_requests')
      .select('id, session_id, status, created_at, tutoring_sessions!inner ( starts_at, student_id, students ( first_name, last_name ) )')
      .in('status', ['offered', 'declined', 'accepted', 'cancelled'])
      .gte('tutoring_sessions.starts_at', now.toISOString())
      .order('created_at', { ascending: false }),
    supabase
      .from('timecards')
      .select('id, period_start, period_end, instructors ( name, email )')
      .eq('status', 'tutor_confirmed'),
    supabase
      .from('tutoring_sessions')
      .select('id, starts_at, student_id, reschedule_request_note, students ( first_name, last_name )')
      .not('reschedule_requested_at', 'is', null)
      .eq('status', 'confirmed')
      .gte('starts_at', now.toISOString()),
    // PL-117: proposals whose time came and went without ever being
    // approved — auto-complete now skips them, so a human closes the loop.
    supabase
      .from('tutoring_sessions')
      .select('id, starts_at, student_id, students ( first_name, last_name )')
      .eq('status', 'proposed')
      .lt('ends_at', now.toISOString()),
    supabase.from('student_availability').select('student_id, updated_at').eq('source', 'parent'),
    // PL-128: refund requested but not yet issued — clears when staff mark
    // the row Refunded after the Stripe-dashboard refund, or when the
    // family converts instead (outcome moves off 'refund_requested').
    supabase
      .from('enrollments')
      .select('id, class_id, refund_requested_at, students ( first_name, last_name ), classes ( class_type, schools ( nickname ) )')
      .eq('cancellation_outcome', 'refund_requested')
      .neq('payment_status', 'Refunded'),
    supabase
      .from('enrollments')
      .select('id, enrolled_at, class_id, payment_status, students ( first_name, last_name ), classes ( class_type, schools ( nickname ) )')
      .order('enrolled_at', { ascending: false })
      .limit(8),
    supabase
      .from('tutoring_invoices')
      .select('id, paid_at, total, families ( parent_first_name, parent_last_name )')
      .not('paid_at', 'is', null)
      .order('paid_at', { ascending: false })
      .limit(5),
    supabase
      .from('student_availability')
      .select('student_id, updated_at, students ( first_name, last_name )')
      .eq('source', 'parent')
      .order('updated_at', { ascending: false })
      .limit(8),
    supabase
      .from('timecards')
      .select('id, tutor_confirmed_at, total_hours, instructors ( name, email )')
      .not('tutor_confirmed_at', 'is', null)
      .order('tutor_confirmed_at', { ascending: false })
      .limit(5),
    supabase
      .from('leads')
      .select('id, student_name, created_at, source')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  // --- Needs Attention (state-driven) ---------------------------------------
  const liveClasses = ((classes as any[]) ?? []).filter((c) => {
    const days = (c.sessions ?? []).map((s: any) => s.session_date)
    const lastDay = days.length ? days.sort().at(-1) : c.start_date
    return lastDay >= todayIso
  })
  const label = (c: any) => `${one<any>(c.schools)?.nickname ?? ''} ${c.class_type}`.trim()

  for (const c of liveClasses.filter((c) => !c.instructor_id)) {
    attention.push({
      id: `no-instructor-${c.id}`,
      kind: 'Class needs an instructor',
      text: `${label(c)} (starts ${c.start_date}) has no instructor assigned.`,
      href: `/admin?class=${c.id}`,
    })
  }
  const in3d = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10)
  for (const c of liveClasses) {
    const paid = (c.enrollments ?? []).filter((e: any) => ['Paid', 'Completed'].includes(e.payment_status)).length
    if (
      c.min_enrollment != null &&
      paid < c.min_enrollment &&
      c.enrollment_deadline &&
      c.enrollment_deadline >= todayIso &&
      c.enrollment_deadline <= in3d
    ) {
      attention.push({
        id: `min-enroll-${c.id}`,
        kind: 'Minimum-enrollment decision',
        text: `${label(c)}: ${paid} of ${c.min_enrollment} minimum with the deadline ${c.enrollment_deadline} — run, extend, or cancel.`,
        href: `/admin?class=${c.id}`,
        urgent: true,
      })
    }
  }
  const in7d = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  for (const c of liveClasses) {
    const firstDay = (c.sessions ?? []).map((s: any) => s.session_date).sort()[0] ?? c.start_date
    if (!c.default_location && firstDay >= todayIso && firstDay <= in7d) {
      attention.push({
        id: `missing-details-${c.id}`,
        kind: 'Class details missing',
        text: `${label(c)} starts ${firstDay} and still has no ${c.delivery_mode === 'online' ? 'meeting link' : 'room/location'}.`,
        href: `/admin?class=${c.id}`,
        urgent: true,
      })
    }
  }

  for (const inv of (invoices as any[]) ?? []) {
    if (!inv.due_at) continue
    const daysLate = Math.floor((now.getTime() - new Date(inv.due_at).getTime()) / 86400000)
    if (daysLate < 10) continue
    const fam = one<any>(inv.families)
    attention.push({
      id: `overdue-${inv.id}`,
      kind: daysLate >= 30 ? 'Invoice 30+ days past due' : 'Invoice 10+ days past due',
      text: `${fam ? `${fam.parent_first_name} ${fam.parent_last_name}` : 'A family'} — $${Number(inv.total).toFixed(2)} unpaid, ${daysLate} days past due.`,
      href: `/admin/tutoring?invoice=${inv.id}`,
      urgent: daysLate >= 30,
    })
  }

  // Billed without a signed agreement (state: outstanding invoice + no acceptance).
  const famIds = [...new Set((((invoices as any[]) ?? []).map((i) => i.family_id)))]
  if (famIds.length) {
    const { data: accepted } = await supabase
      .from('agreement_acceptances')
      .select('family_id')
      .in('family_id', famIds)
    const okFams = new Set((accepted ?? []).map((a: any) => a.family_id))
    for (const inv of (invoices as any[]) ?? []) {
      if (okFams.has(inv.family_id)) continue
      const fam = one<any>(inv.families)
      attention.push({
        id: `unagreed-${inv.family_id}`,
        kind: 'Billed without signed agreement',
        text: `${fam ? `${fam.parent_first_name} ${fam.parent_last_name}` : 'A family'} has an outstanding invoice but no signed policies agreement.`,
        href: `/admin/tutoring?family=${inv.family_id}`,
      })
      okFams.add(inv.family_id) // one row per family
    }
  }

  for (const q of (qboFailed as any[]) ?? []) {
    attention.push({
      id: `qbo-${q.id}`,
      kind: 'QuickBooks sync failed',
      text: `A ${q.kind ?? 'sync'} row failed to post${q.last_error ? ` — ${String(q.last_error).slice(0, 90)}` : ''}.`,
      href: `/admin?qbo=${q.id}`,
    })
  }

  for (const l of (intakeLeads as any[]) ?? []) {
    attention.push({
      id: `intake-${l.id}`,
      kind: 'Intake complete — ready to schedule',
      text: `${l.student_name ?? 'A prospective student'}'s intake form is complete; nothing is scheduled yet.`,
      href: `/admin/leads?lead=${l.id}`,
    })
  }

  // PL-112: sessions still needing coverage — latest request per session
  // decides (offered = waiting on the candidate; declined = nobody found yet).
  const seenSessions = new Set<string>()
  for (const r of (covRaw as any[]) ?? []) {
    if (seenSessions.has(r.session_id)) continue
    seenSessions.add(r.session_id)
    if (r.status !== 'offered' && r.status !== 'declined') continue
    const ses = one<any>(r.tutoring_sessions)
    const st = one<any>(ses?.students)
    attention.push({
      id: `coverage-${r.session_id}`,
      kind: 'Session still needs coverage',
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A student'}'s session on ${String(ses?.starts_at ?? '').slice(0, 10)} — substitute request ${r.status === 'offered' ? 'waiting on an answer' : 'was declined; nobody is lined up'}.`,
      href: `/admin/tutoring?schedule=${ses?.student_id}`,
      urgent: r.status === 'declined',
    })
  }

  for (const t of (awaitingCards as any[]) ?? []) {
    const ins = one<any>(t.instructors)
    attention.push({
      id: `timecard-${t.id}`,
      kind: 'Timecard awaiting approval',
      text: `${ins?.name ?? ins?.email ?? 'A tutor'} confirmed ${t.period_start} → ${t.period_end}; it needs office approval.`,
      href: `/admin/tutoring`,
    })
  }

  for (const s of (reschedules as any[]) ?? []) {
    const st = one<any>(s.students)
    attention.push({
      id: `resched-${s.id}`,
      kind: 'Reschedule request pending',
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A family'} asked to move the ${String(s.starts_at).slice(0, 10)} session${s.reschedule_request_note ? ` — “${String(s.reschedule_request_note).slice(0, 60)}”` : ''}.`,
      href: `/admin/tutoring?schedule=${s.student_id}`,
    })
  }

  for (const s of (strandedProposals as any[]) ?? []) {
    const st = one<any>(s.students)
    attention.push({
      id: `stranded-proposal-${s.id}`,
      kind: 'Proposed session never resolved',
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A student'}'s proposed session on ${String(s.starts_at).slice(0, 10)} passed without approval — confirm it happened, reschedule it, or cancel it.`,
      href: `/admin/tutoring?schedule=${s.student_id}`,
    })
  }

  for (const e of (refundRequests as any[]) ?? []) {
    const st = one<any>(e.students)
    const cls = one<any>(e.classes)
    attention.push({
      id: `refund-${e.id}`,
      kind: 'Refund requested',
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A family'} requested a refund of the cancelled ${one<any>(cls?.schools)?.nickname ?? ''} ${cls?.class_type ?? 'class'} fee (${String(e.refund_requested_at).slice(0, 10)}) — issue it in Stripe, then mark the enrollment Refunded.`,
      href: `/admin?class=${e.class_id}&enrollment=${e.id}`,
    })
  }

  // Availability shared but nothing scheduled (state: parent-source
  // availability + an active engagement + zero upcoming sessions).
  // PL-127: the row carries the SAME promise clock the family saw — "propose
  // times by {date}" from AVAILABILITY_PROPOSAL_BUSINESS_DAYS — and reads
  // overdue once the promised date passes.
  const sharedAt = new Map<string, string>()
  for (const a of (availStudents as any[]) ?? []) {
    const day = String(a.updated_at).slice(0, 10)
    if (!sharedAt.has(a.student_id) || day > sharedAt.get(a.student_id)!) sharedAt.set(a.student_id, day)
  }
  const availIds = [...sharedAt.keys()]
  if (availIds.length) {
    const [{ data: engs }, { data: upcomingSes }, { data: studs }] = await Promise.all([
      supabase.from('tutoring_engagements').select('student_id').in('student_id', availIds).eq('status', 'active'),
      supabase
        .from('tutoring_sessions')
        .select('student_id')
        .in('student_id', availIds)
        .in('status', ['proposed', 'confirmed'])
        .gte('starts_at', now.toISOString()),
      supabase.from('students').select('id, first_name, last_name').in('id', availIds),
    ])
    const hasEng = new Set((engs ?? []).map((e: any) => e.student_id))
    const hasUpcoming = new Set((upcomingSes ?? []).map((s: any) => s.student_id))
    const nameOf = new Map((studs ?? []).map((s: any) => [s.id, `${s.first_name} ${s.last_name}`]))
    for (const id of availIds) {
      if (!hasEng.has(id) || hasUpcoming.has(id)) continue
      const shared = sharedAt.get(id)!
      const proposeBy = addBusinessDays(shared, AVAILABILITY_PROPOSAL_BUSINESS_DAYS)
      const overdue = todayIso > proposeBy
      attention.push({
        id: `avail-${id}`,
        kind: overdue ? 'Availability promise OVERDUE' : 'Availability shared, nothing scheduled',
        text: `${nameOf.get(id) ?? 'A student'}'s family shared availability ${shared} — the family was told to expect proposed times by ${proposeBy}${overdue ? ', which has passed' : ''}.`,
        href: `/admin/tutoring?schedule=${id}`,
        urgent: overdue,
      })
    }
  }

  attention.sort((a, b) => Number(b.urgent ?? false) - Number(a.urgent ?? false))

  // --- Recent Activity (read-only) ------------------------------------------
  for (const e of (recentEnrollments as any[]) ?? []) {
    const st = one<any>(e.students)
    const cls = one<any>(e.classes)
    activity.push({
      id: `en-${e.id}`,
      when: e.enrolled_at,
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A student'} registered for ${one<any>(cls?.schools)?.nickname ?? ''} ${cls?.class_type ?? 'a class'} (${e.payment_status}).`,
      href: `/admin?class=${e.class_id}`,
    })
  }
  for (const i of (recentPaidInvoices as any[]) ?? []) {
    const fam = one<any>(i.families)
    activity.push({
      id: `paid-${i.id}`,
      when: i.paid_at,
      text: `Payment received — ${fam ? `${fam.parent_first_name} ${fam.parent_last_name}` : 'a family'} paid $${Number(i.total).toFixed(2)}.`,
      href: `/admin/tutoring?invoice=${i.id}`,
    })
  }
  const seenAvail = new Set<string>()
  for (const a of (recentAvail as any[]) ?? []) {
    if (seenAvail.has(a.student_id)) continue
    seenAvail.add(a.student_id)
    const st = one<any>(a.students)
    activity.push({
      id: `av-${a.student_id}`,
      when: a.updated_at,
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A family'}'s family shared availability.`,
      href: `/admin/tutoring?schedule=${a.student_id}`,
    })
  }
  for (const t of (recentTimecards as any[]) ?? []) {
    const ins = one<any>(t.instructors)
    activity.push({
      id: `tc-${t.id}`,
      when: t.tutor_confirmed_at,
      text: `${ins?.name ?? ins?.email ?? 'A tutor'} confirmed their timecard (${Number(t.total_hours)} hours).`,
      href: `/admin/tutoring`,
    })
  }
  for (const l of (recentLeads as any[]) ?? []) {
    activity.push({
      id: `lead-${l.id}`,
      when: l.created_at,
      text: `New prospective student — ${l.student_name ?? 'name pending'}${l.source ? ` (via ${l.source})` : ''}.`,
      href: `/admin/leads?lead=${l.id}`,
    })
  }
  activity.sort((a, b) => String(b.when).localeCompare(String(a.when)))

  // --- Restrained extras ------------------------------------------------------
  const upcoming = liveClasses
    .filter((c) => c.start_date >= todayIso)
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
    .slice(0, 5)
    .map((c) => ({
      id: c.id,
      label: label(c),
      startDate: c.start_date,
      paid: (c.enrollments ?? []).filter((e: any) => ['Paid', 'Completed'].includes(e.payment_status)).length,
      min: c.min_enrollment,
      cap: null as number | null,
      href: `/admin?class=${c.id}`,
    }))
  const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString()
  const { count: weekSessions } = await supabase
    .from('tutoring_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'confirmed')
    .gte('starts_at', now.toISOString())
    .lt('starts_at', weekEnd)

  return NextResponse.json({
    attention,
    activity: activity.slice(0, 15),
    upcoming,
    weekSessions: weekSessions ?? 0,
  })
}
