import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { auditXclDrift } from '../../../utils/gcal-sync'
import { sessionRole } from '../../../utils/staff-gate'
import { AVAILABILITY_PROPOSAL_BUSINESS_DAYS, addBusinessDays } from '../../../utils/dates'
import { computeSystemHealth } from '../../../utils/system-health'

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
/** PL-297/298: to-dos speak plain dates — "Aug 8", never "2026-08-08". */
const shortDate = (iso: string) =>
  iso
    ? new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : ''

/** PL-330/335E: full-month form — "August 14", with the year only when it
 *  isn't this year. Calendar dates anchor at UTC noon (dates.ts rule), so
 *  the rendered day IS the class-local calendar day regardless of server tz. */
const plainDate = (iso: string, todayIso: string) =>
  iso
    ? new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
        ...(iso.slice(0, 4) !== todayIso.slice(0, 4) ? { year: 'numeric' as const } : {}),
      })
    : ''

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export type AttentionRow = {
  id: string
  kind: string
  text: string
  href: string
  urgent?: boolean
  /**
   * PL-135: when the CONDITION started, from the underlying record's own
   * timestamp — never from when the dashboard first noticed it (the
   * state-driven discipline applies to the clock too). Triage self-ranks
   * without any sorting UI.
   */
  since?: string
  /** PL-135: a promised date beats an age wherever both exist (PL-127). */
  deadline?: string
  /** PL-133: a human-pinned sticky note, not a derived condition. */
  manual?: { by: string; at: string }
  /** PL-207: one-click "push to my to-dos" — adds a dashboard note with this
   *  body (the family's wait-until-after-class ask, with its due date). */
  quickNote?: { label: string; body: string }
}
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

// PL-136: three numbers, one glance — the pre-launch health card. The
// computation lives in utils/system-health.ts (PL-331: shared with the
// manager's Settings section).

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
    { data: brokenTemplateSends },
  ] = await Promise.all([
    supabase
      .from('classes')
      .select(
        `id, class_type, instructor_id, status, min_enrollment, enrollment_deadline, default_location, delivery_mode, start_date, created_at,
         collateral_reminder_at, short_link, school_id,
         schools ( nickname ), sessions ( session_date ), enrollments ( payment_status )`
      )
      .neq('status', 'cancelled'),
    supabase
      .from('tutoring_invoices')
      .select('id, family_id, status, due_at, total, families ( parent_first_name, parent_last_name )')
      .in('status', ['invoiced', 'past_due']),
    supabase.from('qbo_sync_log').select('id, kind, last_error, created_at').eq('status', 'failed').limit(20),
    supabase.from('leads').select('id, student_name, status, created_at, updated_at').eq('status', 'intake_complete'),
    supabase
      .from('coverage_requests')
      .select('id, session_id, status, created_at, tutoring_sessions!inner ( starts_at, student_id, students ( first_name, last_name ) )')
      .in('status', ['offered', 'declined', 'accepted', 'cancelled'])
      .gte('tutoring_sessions.starts_at', now.toISOString())
      .order('created_at', { ascending: false }),
    supabase
      .from('timecards')
      .select('id, period_start, period_end, tutor_confirmed_at, instructors ( name, email )')
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
      .limit(25), // PL-134: grouping needs a day's worth to collapse
    supabase
      .from('tutoring_invoices')
      .select('id, paid_at, total, families ( parent_first_name, parent_last_name )')
      .not('paid_at', 'is', null)
      .order('paid_at', { ascending: false })
      .limit(15),
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
      .limit(15),
    // PL-155a: real sends whose body still carried {placeholders} — a broken
    // template keeps breaking every send until someone fixes it, so this is
    // a live condition, not a past event. Clears when no recent send has any.
    supabase
      .from('email_sends')
      .select('id, template_key, payload, sent_at')
      .eq('is_test', false)
      .in('status', ['sent', 'delivered'])
      .gte('sent_at', new Date(now.getTime() - 7 * 86400000).toISOString())
      .not('payload->unresolved_tokens', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(50)
  ])

  // --- Needs Attention (state-driven) ---------------------------------------
  const liveClasses = ((classes as any[]) ?? []).filter((c) => {
    const days = (c.sessions ?? []).map((s: any) => s.session_date)
    const lastDay = days.length ? days.sort().at(-1) : c.start_date
    return lastDay >= todayIso
  })
  const label = (c: any) => `${one<any>(c.schools)?.nickname ?? ''} ${c.class_type}`.trim()

  // PL-330/335E: dashboard copy renders calendar dates plain-English — the
  // "starts …" day is the class's real first day (PL-1: earliest session).
  const firstDayOf = (c: any) =>
    (c.sessions ?? []).map((s: any) => s.session_date).sort()[0] ?? c.start_date
  for (const c of liveClasses.filter((c) => !c.instructor_id)) {
    attention.push({
      id: `no-instructor-${c.id}`,
      kind: 'Class needs an instructor',
      text: `${label(c)} (starts ${plainDate(firstDayOf(c), todayIso)}) has no instructor assigned.`,
      href: `/admin?class=${c.id}`,
      since: c.created_at, // PL-135: since the class was created
    })
  }
  // PL-237: skip-for-now on the wizard's Branding & Collateral step — the
  // row is STATE-DRIVEN: it shows while the stamp is set and the class still
  // has no short link, and clears itself the moment the collateral is
  // completed (from the deep-linked panel or anywhere else).
  // PL-274: open-enrollment classes have no collateral at all — never nag.
  for (const c of liveClasses.filter((c) => c.school_id && c.collateral_reminder_at && !c.short_link)) {
    attention.push({
      id: `collateral-${c.id}`,
      kind: 'Collateral not set up',
      text: `${label(c)} was created without its flyer & letter setup — finish the collateral fields when ready.`,
      href: `/admin?collateral=${c.id}`,
      since: c.collateral_reminder_at,
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
        text: `${label(c)}: ${paid} of ${c.min_enrollment} minimum with the deadline ${plainDate(c.enrollment_deadline, todayIso)} — run, extend, or cancel.`,
        href: `/admin?class=${c.id}`,
        urgent: true,
        deadline: c.enrollment_deadline, // PL-135: a promise beats an age
      })
    }
  }
  const in7d = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  for (const c of liveClasses) {
    const firstDay = firstDayOf(c)
    if (!c.default_location && firstDay >= todayIso && firstDay <= in7d) {
      attention.push({
        id: `missing-details-${c.id}`,
        kind: 'Class details missing',
        text: `${label(c)} starts ${plainDate(firstDay, todayIso)} and still has no ${c.delivery_mode === 'online' ? 'meeting link' : 'room/location'}.`,
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
      since: inv.due_at, // PL-135: overdue since the due date
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

  // PL-298: to-do copy is plain English — no internal shorthand. Kind names
  // become what actually failed; known machine errors get a human sentence
  // (unknown ones pass through verbatim rather than hiding information).
  const QBO_KIND_PLAIN: Record<string, string> = {
    sale: 'A class payment receipt',
    refund: 'A refund receipt',
    tutoring_sale: 'A tutoring invoice',
    timecard_time: "A tutor's timecard hours",
  }
  const QBO_ERROR_PLAIN: Record<string, string> = {
    'tutoring invoice has no positive lines':
      'the invoice has no charges on it (a $0 or credit-only invoice), and QuickBooks refuses an empty receipt',
  }
  for (const q of (qboFailed as any[]) ?? []) {
    const err = q.last_error ? String(q.last_error) : ''
    attention.push({
      id: `qbo-${q.id}`,
      since: q.created_at, // PL-135
      kind: 'QuickBooks sync failed',
      text: `${QBO_KIND_PLAIN[q.kind ?? ''] ?? 'A payment record'} failed to post to QuickBooks${
        err ? ` — ${QBO_ERROR_PLAIN[err] ?? err.slice(0, 90)}` : ''
      }. Retry or dismiss it from the sync log.`,
      href: `/admin?qbo=${q.id}`,
    })
  }

  // PL-154: sessions the portal still believes in whose Google event was
  // hand-marked XCL-. Read-only and state-driven: fix it in the portal (or
  // restore the calendar event) and the row disappears on its own. A
  // calendar read failure yields nothing, so this never cries wolf.
  try {
    for (const d of await auditXclDrift()) {
      attention.push({
        id: `xcl-${d.sessionId}`,
        kind: 'Cancelled on the calendar, not in the portal',
        text: `${d.tutorName} marked ${d.studentName}'s ${new Date(d.startsAt).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })} session "${d.eventTitle}" in Google, but it's still scheduled here — it will bill and count on the timecard as-is.`,
        // PL-298 audit: ?schedule= expects a STUDENT and opens the
        // new-schedule wizard — a session id there was a dead end. The
        // session dialog is the resolution surface.
        href: `/admin/tutoring?session=${d.sessionId}`,
        urgent: new Date(d.startsAt).getTime() < now.getTime(),
      })
    }
  } catch (e) {
    console.error('[PL-154] XCL audit failed (dashboard continues):', e)
  }

  // PL-155a: one row per broken TEMPLATE (not per send) — the fix is in the
  // template, and a bad one can hit dozens of families in a single sweep.
  const brokenByTemplate = new Map<string, { tokens: Set<string>; sends: number }>()
  for (const row of (brokenTemplateSends as any[]) ?? []) {
    const key = row.template_key ?? 'unknown template'
    const entry = brokenByTemplate.get(key) ?? { tokens: new Set<string>(), sends: 0 }
    for (const t of (row.payload?.unresolved_tokens as string[]) ?? []) entry.tokens.add(t)
    entry.sends++
    brokenByTemplate.set(key, entry)
  }
  for (const [templateKey, entry] of brokenByTemplate) {
    attention.push({
      id: `unresolved-${templateKey}`,
      kind: 'Email sent with unfilled placeholders',
      text: `${templateKey} went out ${entry.sends} time${entry.sends === 1 ? '' : 's'} in the last week still showing ${[...entry.tokens].map((t) => `{${t}}`).join(', ')} — recipients see the placeholder text.`,
      href: `/admin/communications/templates`,
      urgent: true,
    })
  }

  for (const l of (intakeLeads as any[]) ?? []) {
    attention.push({
      id: `intake-${l.id}`,
      since: l.updated_at ?? l.created_at, // PL-135
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
      since: r.created_at, // PL-135: waiting since the request went out
      kind: 'Session still needs coverage',
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A student'}'s ${shortDate(String(ses?.starts_at ?? ''))} session — substitute request ${r.status === 'offered' ? 'waiting on an answer' : 'was declined; nobody is lined up'}.`,
      // PL-298 audit: land on the session itself, not a fresh-schedule wizard.
      href: `/admin/tutoring?session=${r.session_id}`,
      urgent: r.status === 'declined',
    })
  }

  for (const t of (awaitingCards as any[]) ?? []) {
    const ins = one<any>(t.instructors)
    attention.push({
      id: `timecard-${t.id}`,
      since: t.tutor_confirmed_at, // PL-135: waiting since the tutor confirmed
      kind: 'Timecard awaiting approval',
      text: `${ins?.name ?? ins?.email ?? 'A tutor'} confirmed ${shortDate(t.period_start)} → ${shortDate(t.period_end)}; it needs office approval.`,
      // PL-298 audit: land on the Timecards section, not the tutoring root.
      href: `/admin/tutoring?section=timecards`,
    })
  }

  for (const s of (reschedules as any[]) ?? []) {
    const st = one<any>(s.students)
    attention.push({
      id: `resched-${s.id}`,
      kind: 'Reschedule request pending',
      // PL-297: plain-English date, and the link lands ON THE REQUEST — the
      // session dialog with the family's note, approve-the-move (pick the
      // new time), or propose-an-alternative — not a fresh-schedule wizard.
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A family'} asked to move the ${shortDate(String(s.starts_at))} session${s.reschedule_request_note ? ` — “${String(s.reschedule_request_note).slice(0, 60)}”` : ''}.`,
      href: `/admin/tutoring?session=${s.id}&reschedule=1`,
    })
  }

  // PL-313: pending same-person prompts — visible to admin AND manager
  // (the whole dashboard is staff-gated). The link lands on the lead card's
  // side-by-side panel; nothing merges without the click there.
  {
    const { data: pendingMatches } = await supabase
      .from('record_matches')
      .select(
        `id, created_at, lead_id,
         leads ( student_name, contact_name ),
         students ( first_name, last_name )`
      )
      .eq('status', 'pending')
    for (const m of (pendingMatches as any[]) ?? []) {
      const lead = one<any>(m.leads)
      const st = one<any>(m.students)
      const leadName = lead?.student_name || lead?.contact_name || 'A pipeline lead'
      attention.push({
        id: `match-${m.id}`,
        since: m.created_at,
        kind: 'Possible duplicate person',
        text: `${leadName} (pipeline) looks like ${st ? `${st.first_name} ${st.last_name}` : 'a registered student'} — same person? Review side by side and link them or say no.`,
        href: `/admin/leads?lead=${m.lead_id}&match=${m.id}`,
      })
    }
  }

  for (const s of (strandedProposals as any[]) ?? []) {
    const st = one<any>(s.students)
    attention.push({
      id: `stranded-proposal-${s.id}`,
      kind: 'Proposed session never resolved',
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A student'}'s proposed ${shortDate(String(s.starts_at))} session passed without approval — confirm it happened, reschedule it, or cancel it.`,
      // PL-298 audit: the session dialog IS the confirm/reschedule/cancel surface.
      href: `/admin/tutoring?session=${s.id}`,
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
  // PL-207: the card's timing choices, plus paid add-on holders — the card
  // flow must surface here even before any engagement exists.
  const { data: timingAddonRows } = await supabase
    .from('enrollment_addons')
    .select(
      `tutoring_timing, hours,
       enrollments!inner ( payment_status, student_id,
         students!inner ( id, first_name, last_name, family_id ),
         classes ( sessions ( session_date ) ) )`
    )
    .not('tutoring_timing', 'is', null)
  const timingByStudent = new Map<
    string,
    { timing: string; name: string; familyId: string; lastClassDay: string | null }
  >()
  for (const a of (timingAddonRows as any[]) ?? []) {
    const enr = one<any>(a.enrollments)
    if (!enr || !['Paid', 'Completed'].includes(enr.payment_status)) continue
    const stu = one<any>(enr.students)
    if (!stu) continue
    const dates = ((one<any>(enr.classes)?.sessions ?? []) as any[])
      .map((s) => s.session_date)
      .sort()
    timingByStudent.set(stu.id, {
      timing: a.tutoring_timing,
      name: `${stu.first_name} ${stu.last_name}`,
      familyId: stu.family_id,
      lastClassDay: dates[dates.length - 1] ?? null,
    })
  }
  // Paid add-on holders (any student with purchased hours) — availability
  // shared by one of these deserves a row even with no engagement yet.
  const { data: paidAddonRows } = await supabase
    .from('enrollment_addons')
    .select('enrollments!inner ( payment_status, student_id )')
    .gt('hours', 0)
  const paidAddonStudents = new Set(
    ((paidAddonRows as any[]) ?? [])
      .map((a) => one<any>(a.enrollments))
      .filter((e) => e && ['Paid', 'Completed'].includes(e.payment_status))
      .map((e) => e.student_id)
  )

  const availIds = [...new Set([...sharedAt.keys(), ...timingByStudent.keys()])]
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
      if (hasUpcoming.has(id)) continue
      const timing = timingByStudent.get(id)
      // PL-207: an explicit "wait until the class is done" beats the
      // 3-business-day promise clock — one row, one meaning, with a
      // one-click push onto the to-do notes (due = last class day).
      if (timing?.timing === 'after_class' && !hasEng.has(id)) {
        attention.push({
          id: `tutoring-wait-${id}`,
          kind: 'Wants 1-on-1 after the class',
          text: `${timing.name}'s family bought 1-on-1 hours and chose to wait until the class is done${
            timing.lastClassDay ? ` (last class day ${timing.lastClassDay})` : ''
          }${sharedAt.has(id) ? ' — availability already shared' : ''}.`,
          href: `/admin/tutoring?family=${timing.familyId}`,
          quickNote: {
            label: 'push to my to-dos',
            body: `Start ${timing.name}'s 1-on-1 tutoring — family asked to wait until the class ends${
              timing.lastClassDay ? ` (suggested due date: ${timing.lastClassDay})` : ''
            }. /admin/tutoring?family=${timing.familyId}`,
          },
          since: sharedAt.get(id),
        })
        continue
      }
      // The promise row: an active engagement OR purchased add-on hours make
      // shared availability actionable (PL-207 widened this beyond
      // engagements — the card's families were invisible here before).
      if (!sharedAt.has(id) || !(hasEng.has(id) || paidAddonStudents.has(id))) continue
      const shared = sharedAt.get(id)!
      const proposeBy = addBusinessDays(shared, AVAILABILITY_PROPOSAL_BUSINESS_DAYS)
      const overdue = todayIso > proposeBy
      attention.push({
        id: `avail-${id}`,
        kind: overdue ? 'Availability promise OVERDUE' : 'Availability shared, nothing scheduled',
        text: `${nameOf.get(id) ?? 'A student'}'s family shared availability ${shared} — the family was told to expect proposed times by ${proposeBy}${overdue ? ', which has passed' : ''}${
          timing?.timing === 'immediate' ? ' — they chose "start right away" in the portal' : ''
        }.`,
        href: `/admin/tutoring?schedule=${id}`,
        urgent: overdue,
        // PL-135/127: this row already carries a promised date — the
        // countdown wins, the age is not shown.
        deadline: proposeBy,
      })
    }
  }

  // PL-163: package (nearly) exhausted — the renewal/wind-down conversation
  // is a real to-do, and it should not depend on someone happening to open
  // the tutoring page. State-driven: attaching a fresh package (anywhere in
  // the family) or ending the engagement clears the row on its own.
  // Threshold ≤1h (Scarlett to confirm) — the conversation is better had
  // BEFORE the last session.
  const { data: pkgEngs } = await supabase
    .from('tutoring_engagements')
    .select(
      `id, addon_id, status, student_id, hourly_rate, overdraw_ack_hours, block_confirmation,
       block_continue_hours, block_continue_staff_at,
       students ( first_name, last_name, family_id ),
       enrollment_addons ( id, hours )`
    )
    .eq('funding', 'package')
    .not('addon_id', 'is', null)
  const pkgRows = (pkgEngs as any[]) ?? []
  if (pkgRows.length > 0) {
    // Drawdown per addon across EVERY engagement drawing on it — the same
    // status set as packageHoursUsedBefore, the function that actually bills.
    const { data: consuming } = await supabase
      .from('tutoring_sessions')
      .select('engagement_id, duration_minutes, status, reschedule_notice, starts_at')
      .in('engagement_id', pkgRows.map((e) => e.id))
      .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
    const addonOf = new Map(pkgRows.map((e) => [e.id, e.addon_id]))
    const usedByAddon = new Map<string, number>()
    const lastSpendByAddon = new Map<string, string>()
    for (const s of (consuming as any[]) ?? []) {
      if (s.status === 'rescheduled' && s.reschedule_notice !== 'late') continue
      const aid = addonOf.get(s.engagement_id)
      if (!aid) continue
      usedByAddon.set(aid, (usedByAddon.get(aid) ?? 0) + s.duration_minutes / 60)
      if (s.starts_at <= now.toISOString() && s.starts_at > (lastSpendByAddon.get(aid) ?? '')) {
        lastSpendByAddon.set(aid, s.starts_at)
      }
    }
    // A family's OTHER packages with hours still on them = the renewal
    // already happened; the row would nag a solved problem.
    const pkgFamIds = [...new Set(pkgRows.map((e) => one<any>(e.students)?.family_id).filter(Boolean))]
    const { data: famAddons } = await supabase
      .from('enrollment_addons')
      .select('id, hours, enrollments!inner ( students!inner ( family_id ) )')
      .in('enrollments.students.family_id', pkgFamIds)
    const addonFamily = new Map(
      ((famAddons as any[]) ?? []).map((a) => [
        a.id,
        one<any>(one<any>(a.enrollments)?.students)?.family_id as string,
      ])
    )
    const addonRemaining = (id: string, hours: number) => Math.max(0, hours - (usedByAddon.get(id) ?? 0))
    const seenAddons = new Set<string>()
    for (const e of pkgRows.filter((e) => e.status === 'active')) {
      const addon = one<any>(e.enrollment_addons)
      const stu = one<any>(e.students)
      if (!addon || !stu || seenAddons.has(addon.id)) continue
      seenAddons.add(addon.id)
      const remaining = addonRemaining(addon.id, Number(addon.hours))
      if (remaining > 1) continue
      const renewed = ((famAddons as any[]) ?? []).some(
        (a) =>
          a.id !== addon.id &&
          addonFamily.get(a.id) === stu.family_id &&
          addonRemaining(a.id, Number(a.hours)) > 1
      )
      if (renewed) continue
      const usedRaw = usedByAddon.get(addon.id) ?? 0
      const over = Math.max(0, usedRaw - Number(addon.hours))
      // PL-299: once the family flow is in play, IT owns this surface —
      // the legacy PL-163/PL-197 rows below apply only to pre-flow (null)
      // engagements, and retire by attrition.
      if (e.block_confirmation === 'asked') {
        attention.push({
          id: `block-awaiting-${e.id}`,
          kind: 'Hours block ending — awaiting family confirmation',
          text: `${stu.first_name} ${stu.last_name} has ${remaining.toFixed(1)} of ${addon.hours}h left. The family was asked to confirm continuing on the monthly plan at $${e.hourly_rate}/hr — nothing schedules or bills past the block until they answer (portal button, or record their reply on the engagement row).`,
          href: `/admin/tutoring?family=${stu.family_id}`,
        })
        continue
      }
      if (e.block_confirmation === 'declined') {
        if (over > 0.05) {
          attention.push({
            id: `block-declined-${e.id}`,
            kind: 'Family declined — sessions past the block',
            // PL-323A: the hourly sweep auto-drops future sessions past the
            // block; anything still here is past/billed rows worth a look.
            text: `${stu.first_name} ${stu.last_name}'s family declined continuing past their ${addon.hours}h block, but ${over.toFixed(1)}h beyond it exist. Future unbilled sessions drop automatically on the next sweep; anything remaining needs a human look (they will not bill).`,
            href: `/admin/tutoring?family=${stu.family_id}`,
            urgent: true,
          })
        }
        continue
      }
      if (e.block_confirmation === 'confirmed') {
        // PL-323C: the family chose to continue but the portal couldn't
        // reserve the times — a human schedules them. Self-resolves once a
        // future session created AFTER the routing stamp exists.
        if (e.block_continue_staff_at) {
          const { count } = await supabase
            .from('tutoring_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('engagement_id', e.id)
            .in('status', ['proposed', 'confirmed'])
            .gt('created_at', e.block_continue_staff_at)
            .gt('starts_at', new Date().toISOString())
          if ((count ?? 0) === 0) {
            attention.push({
              id: `block-continue-staff-${e.id}`,
              since: e.block_continue_staff_at,
              kind: 'Continue-tutoring choice needs scheduling',
              text: `${stu.first_name} ${stu.last_name}'s family confirmed continuing${e.block_continue_hours ? ` (${Number(e.block_continue_hours)} more hours)` : ' (monthly)'}, but the portal couldn't reserve the times — a conflict or no workable slot. Schedule the continuation; the family was told you'll sort it out with them.`,
              href: `/admin/tutoring?family=${stu.family_id}`,
              urgent: true,
            })
          }
        }
        continue // otherwise agreed — Case-A billing, nothing to flag
      }
      // PL-197: past the crossing this is a DIFFERENT conversation — "it's
      // happening", not "talk soon" — so the overdraw row REPLACES the
      // PL-163 warning (never both). Clears on new package (renewed, above),
      // engagement end (active filter), or acknowledgment at this overage.
      if (over > 0.05) {
        if (Number(e.overdraw_ack_hours ?? 0) >= over - 0.05) continue
        attention.push({
          id: `pkg-overdrawn-${addon.id}`,
          kind: 'Hours past the package',
          text: `${stu.first_name} ${stu.last_name} is ${over.toFixed(1)}h past their ${addon.hours}h package — extra hours are billing at $${e.hourly_rate}/hr.`,
          href: `/admin/tutoring?family=${stu.family_id}`,
          since: lastSpendByAddon.get(addon.id),
        })
        continue
      }
      const used = Number(addon.hours) - remaining
      attention.push({
        id: `pkg-exhausted-${addon.id}`,
        kind: remaining <= 0 ? 'Package hours used up' : 'Package hours almost used up',
        text: `${stu.first_name} ${stu.last_name} — ${used.toFixed(1)} of ${addon.hours}h used, ${remaining.toFixed(1)}h left · time to talk about next steps.`,
        href: `/admin/tutoring?family=${stu.family_id}`,
        since: lastSpendByAddon.get(addon.id), // when the hours were spent
      })
    }
  }

  // PL-211: a live schedule with no location ANYWHERE — engagement location
  // empty and the tutor has no default meeting link — means every surface
  // (tutor rows, ICS, PDF schedule) is silent about where to meet.
  // State-driven: setting the engagement location, giving the tutor a
  // default, or ending/pausing the schedule clears the row on its own.
  try {
    const { data: locEngs } = await supabase
      .from('tutoring_engagements')
      .select(
        `id, location, created_at, status,
         students ( first_name, last_name, family_id ),
         instructors ( name, default_meeting_link ),
         subjects ( name )`
      )
      .in('status', ['active', 'pending_parent_confirmation'])
    for (const e of (locEngs as any[]) ?? []) {
      if ((e.location ?? '').trim()) continue
      const tut = one<any>(e.instructors)
      if ((tut?.default_meeting_link ?? '').trim()) continue
      const stu = one<any>(e.students)
      if (!stu) continue
      attention.push({
        id: `no-location-${e.id}`,
        kind: 'No session location set',
        text: `${stu.first_name} ${stu.last_name}'s ${one<any>(e.subjects)?.name ?? 'tutoring'} schedule has no location and ${
          tut?.name ?? 'the tutor'
        } has no default meeting link — the tutor and family can't see where or how to meet.`,
        href: `/admin/tutoring?family=${stu.family_id}`,
        since: e.created_at,
      })
    }
  } catch (e) {
    console.error('no-location attention rows failed (dashboard stands):', e)
  }

  // PL-202: a KNOWN family called and got nobody — exactly what the
  // dashboard exists to surface. State-driven: clears on a later outbound
  // call to the family or a manual dismiss.
  try {
    const { data: missedCalls } = await supabase
      .from('call_events')
      .select('id, family_id, phone_e164, occurred_at, families ( parent_first_name, parent_last_name )')
      .eq('event_type', 'missed')
      .not('family_id', 'is', null)
      .is('dismissed_at', null)
      .order('occurred_at', { ascending: false })
      .limit(20)
    if ((missedCalls ?? []).length > 0) {
      const famIds = [...new Set((missedCalls as any[]).map((c) => c.family_id))]
      const { data: outbound } = await supabase
        .from('call_events')
        .select('family_id, occurred_at')
        .eq('direction', 'outgoing')
        .in('family_id', famIds)
      const lastOut = new Map<string, string>()
      for (const o of (outbound as any[]) ?? []) {
        if ((lastOut.get(o.family_id) ?? '') < o.occurred_at) lastOut.set(o.family_id, o.occurred_at)
      }
      for (const c of (missedCalls as any[]) ?? []) {
        if ((lastOut.get(c.family_id) ?? '') > c.occurred_at) continue // called back
        const fam = one<any>(c.families)
        attention.push({
          id: `missed-call-${c.id}`,
          kind: 'Missed call',
          text: `${`${fam?.parent_first_name ?? ''} ${fam?.parent_last_name ?? ''}`.trim() || c.phone_e164} called and got nobody — call them back.`,
          href: `/admin/tutoring?family=${c.family_id}`,
          since: c.occurred_at,
        })
      }
    }
  } catch (e) {
    console.error('missed-call rows failed (dashboard stands):', e)
  }

  // PL-180: calendar-side session edits awaiting a human decision —
  // attributional (on the tutor's own calendar, the tutor moved it).
  const { data: calDrift } = await supabase
    .from('calendar_drift')
    .select(
      `session_id, cal_starts_at, portal_starts_at, detected_at,
       instructors ( name ),
       tutoring_sessions ( students ( first_name, family_id ) )`
    )
  for (const d of (calDrift as any[]) ?? []) {
    const tutorFirst = (one<any>(d.instructors)?.name ?? 'The tutor').split(' ')[0]
    const stu = one<any>(one<any>(d.tutoring_sessions)?.students)
    const fmtDrift = (iso: string) =>
      new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit' })
    attention.push({
      id: `cal-drift-${d.session_id}`,
      kind: 'Calendar edited outside the portal',
      text: d.cal_starts_at
        ? `${tutorFirst} moved ${stu?.first_name ?? 'a student'}'s session in their Google Calendar — ${fmtDrift(d.portal_starts_at)} → ${fmtDrift(d.cal_starts_at)}. The family hasn't been told and billing hasn't changed. Adopt or revert from the tutoring page.`
        : `${tutorFirst} deleted ${stu?.first_name ?? 'a student'}'s session event (${fmtDrift(d.portal_starts_at)}) from their Google Calendar. Revert restores it; the portal still expects the session.`,
      // PL-298 audit: the adopt/revert decision banner lives on the schedule
      // view with the session in sight — land there, not on the family card.
      href: `/admin/tutoring?session=${d.session_id}`,
      urgent: true,
      since: d.detected_at,
    })
  }

  // PL-195: families whose generation is FAILING — discovery must not
  // depend on the alert email. State-driven: the row exists exactly while a
  // generation_failures record does (cleared by any later successful run).
  const { data: genFailures } = await supabase
    .from('generation_failures')
    .select('family_id, period, error, first_failed_at, families ( parent_first_name, parent_last_name )')
  for (const g of (genFailures as any[]) ?? []) {
    const fam = one<any>(g.families)
    const monthLabel = new Date(String(g.period) + 'T12:00:00Z').toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'long',
    })
    attention.push({
      id: `gen-fail-${g.family_id}-${g.period}`,
      kind: 'Invoice generation FAILING',
      text: `${fam ? `${fam.parent_first_name} ${fam.parent_last_name ?? ''}`.trim() : 'A family'} — ${monthLabel} invoice couldn't be generated (${String(g.error).slice(0, 120)}). Retrying automatically; the family card has a retry-now.`,
      href: `/admin/tutoring?family=${g.family_id}`,
      urgent: true,
      since: g.first_failed_at,
    })
  }

  // PL-133: the sticky-note layer — human-pinned, human-cleared, and the ONE
  // exception to the state-driven rule. Tagged in the UI so nobody mistakes
  // a note for a system condition.
  const { data: manualNotes } = await supabase
    .from('dashboard_notes')
    .select('id, body, created_by, created_at')
    .is('cleared_at', null)
    .order('created_at', { ascending: false })
    .limit(50)
  for (const n of (manualNotes as any[]) ?? []) {
    attention.push({
      id: `note-${n.id}`,
      kind: 'Note',
      text: n.body,
      href: '',
      manual: { by: n.created_by, at: n.created_at },
    })
  }

  // PL-135: oldest-first WITHIN severity — triage self-ranks without any
  // sorting controls. Notes carry no age, so they sort by when they were
  // pinned. Undated rows keep their existing relative order.
  const rowClock = (r: AttentionRow) => r.deadline ?? r.since ?? r.manual?.at ?? ''
  attention.sort(
    (a, b) =>
      Number(b.urgent ?? false) - Number(a.urgent ?? false) ||
      (rowClock(a) && rowClock(b) ? rowClock(a).localeCompare(rowClock(b)) : 0)
  )

  // --- PL-136: system health (PL-331: shared computation) ---------------------
  const { health, recovery } = await computeSystemHealth(now)
  // PL-273: the sweep's own recovery note lands in the activity feed —
  // "down for N hours, recovered at X" — for a week, then ages out of the
  // 40-row window naturally.
  if (recovery && now.getTime() - new Date(recovery.at).getTime() < 7 * 86_400_000) {
    const hours = Math.round((recovery.gapMinutes / 60) * 10) / 10
    activity.push({
      id: `sweep-recovered-${recovery.at}`,
      type: 'System',
      groupKey: `System|sweep-${recovery.at}`,
      when: recovery.at,
      text: `Hourly sweep recovered after a ${hours}-hour gap — the backlog was delivered by this run.`,
      href: '/admin',
    })
  }

  // --- Recent Activity (read-only) ------------------------------------------
  for (const e of (recentEnrollments as any[]) ?? []) {
    const st = one<any>(e.students)
    const cls = one<any>(e.classes)
    activity.push({
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
  for (const i of (recentPaidInvoices as any[]) ?? []) {
    const fam = one<any>(i.families)
    activity.push({
      id: `paid-${i.id}`,
      type: 'Payments',
      groupKey: 'Payments',
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
      type: 'Availability',
      groupKey: 'Availability',
      when: a.updated_at,
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A family'}'s family shared availability.`,
      href: `/admin/tutoring?schedule=${a.student_id}`,
    })
  }
  for (const t of (recentTimecards as any[]) ?? []) {
    const ins = one<any>(t.instructors)
    activity.push({
      id: `tc-${t.id}`,
      type: 'Timecards',
      groupKey: 'Timecards',
      when: t.tutor_confirmed_at,
      text: `${ins?.name ?? ins?.email ?? 'A tutor'} confirmed their timecard (${Number(t.total_hours)} hours).`,
      href: `/admin/tutoring`,
    })
  }
  for (const l of (recentLeads as any[]) ?? []) {
    activity.push({
      id: `lead-${l.id}`,
      type: 'Prospective students',
      groupKey: 'Prospective students',
      when: l.created_at,
      text: `New prospective student — ${l.student_name ?? 'name pending'}${l.source ? ` (via ${l.source})` : ''}.`,
      href: `/admin/leads?lead=${l.id}`,
    })
  }

  // PL-191: Schedule events join the feed — proposals sent, confirmations,
  // family reschedules, cancellations. The chip derives automatically from
  // the type (PL-134); the tutoring page keeps its family-scoped subset.
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString()
  const [{ data: schedEngs }, { data: schedMoves }] = await Promise.all([
    supabase
      .from('tutoring_engagements')
      .select(
        `id, status, approval_requested_at, parent_approved_at, updated_at,
         students ( first_name, last_name, family_id ), subjects ( name )`
      )
      .or(`approval_requested_at.gte.${fourteenDaysAgo},parent_approved_at.gte.${fourteenDaysAgo}`)
      .limit(30),
    supabase
      .from('tutoring_sessions')
      .select(
        `id, status, starts_at, updated_at, parent_rescheduled_at,
         students ( first_name, last_name, family_id ),
         replacement:rescheduled_to_id ( starts_at )`
      )
      .in('status', ['rescheduled', 'cancelled'])
      .gte('updated_at', fourteenDaysAgo)
      .order('updated_at', { ascending: false })
      .limit(20),
  ])
  for (const eng of (schedEngs as any[]) ?? []) {
    const st = one<any>(eng.students)
    const who = st ? `${st.first_name} ${st.last_name}` : 'a student'
    const subj = one<any>(eng.subjects)?.name ?? 'tutoring'
    const href = `/admin/tutoring?family=${st?.family_id ?? ''}`
    if (eng.approval_requested_at && eng.approval_requested_at >= fourteenDaysAgo) {
      activity.push({
        id: `sched-prop-${eng.id}`,
        type: 'Schedule',
        groupKey: 'Schedule',
        when: eng.approval_requested_at,
        text: `Schedule proposed to ${who}'s family (${subj}) — awaiting their confirmation.`,
        href,
      })
    }
    if (eng.parent_approved_at && eng.parent_approved_at >= fourteenDaysAgo) {
      activity.push({
        id: `sched-conf-${eng.id}`,
        type: 'Schedule',
        groupKey: 'Schedule',
        when: eng.parent_approved_at,
        text: `${who}'s family confirmed the ${subj} schedule.`,
        href,
      })
    }
  }
  for (const s of (schedMoves as any[]) ?? []) {
    const st = one<any>(s.students)
    const who = st ? `${st.first_name} ${st.last_name}` : 'a student'
    const moved = one<any>(s.replacement)
    activity.push({
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

  activity.sort((a, b) => String(b.when).localeCompare(String(a.when)))

  // --- Restrained extras ------------------------------------------------------
  // PL-330: the card speaks plain English ("starts September 2"), never raw
  // ISO, and "starts" means the class's real first day (PL-1).
  const upcoming = liveClasses
    .filter((c) => firstDayOf(c) >= todayIso)
    .sort((a, b) => String(firstDayOf(a)).localeCompare(String(firstDayOf(b))))
    .slice(0, 5)
    .map((c) => ({
      id: c.id,
      label: label(c),
      startDate: plainDate(firstDayOf(c), todayIso),
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
  // PL-173: the same window's PROPOSED count — a card reading "0" while nine
  // sessions sat one auto-confirm sweep away told half the state (Jul 25).
  const { count: weekProposed } = await supabase
    .from('tutoring_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'proposed')
    .gte('starts_at', now.toISOString())
    .lt('starts_at', weekEnd)

  return NextResponse.json({
    attention,
    activity: activity.slice(0, 40), // PL-134: grouping collapses these
    upcoming,
    weekSessions: weekSessions ?? 0,
    weekProposed: weekProposed ?? 0,
    health,
    // PL-331: the panel hides the System health card for managers (it lives
    // under Settings → System health for that role instead).
    role: caller.role,
  })
}
