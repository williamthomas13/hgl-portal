import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { auditXclDrift } from '../../../utils/gcal-sync'
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

/**
 * PL-136: three numbers, one glance — the pre-launch card. The motivating
 * incident is the July 23 quota exhaustion: sends failed silently until an
 * external email happened to arrive. Read-only, no graphs, no history.
 */
export type SystemHealth = {
  sends: { today: number; campaignToday: number; cap: number; state: 'ok' | 'warn' | 'full' }
  qbo: { pending: number; failed: number }
  sweep: { lastFinishedAt: string | null; stale: boolean; hanging: boolean }
}

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

  for (const c of liveClasses.filter((c) => !c.instructor_id)) {
    attention.push({
      id: `no-instructor-${c.id}`,
      kind: 'Class needs an instructor',
      text: `${label(c)} (starts ${c.start_date}) has no instructor assigned.`,
      href: `/admin?class=${c.id}`,
      since: c.created_at, // PL-135: since the class was created
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
        deadline: c.enrollment_deadline, // PL-135: a promise beats an age
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

  for (const q of (qboFailed as any[]) ?? []) {
    attention.push({
      id: `qbo-${q.id}`,
      since: q.created_at, // PL-135
      kind: 'QuickBooks sync failed',
      text: `A ${q.kind ?? 'sync'} row failed to post${q.last_error ? ` — ${String(q.last_error).slice(0, 90)}` : ''}.`,
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
        href: `/admin/tutoring?schedule=${d.sessionId}`,
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
      text: `${st ? `${st.first_name} ${st.last_name}` : 'A student'}'s session on ${String(ses?.starts_at ?? '').slice(0, 10)} — substitute request ${r.status === 'offered' ? 'waiting on an answer' : 'was declined; nobody is lined up'}.`,
      href: `/admin/tutoring?schedule=${ses?.student_id}`,
      urgent: r.status === 'declined',
    })
  }

  for (const t of (awaitingCards as any[]) ?? []) {
    const ins = one<any>(t.instructors)
    attention.push({
      id: `timecard-${t.id}`,
      since: t.tutor_confirmed_at, // PL-135: waiting since the tutor confirmed
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
      `id, addon_id, status, student_id, hourly_rate, overdraw_ack_hours,
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
      // PL-197: past the crossing this is a DIFFERENT conversation — "it's
      // happening", not "talk soon" — so the overdraw row REPLACES the
      // PL-163 warning (never both). Clears on new package (renewed, above),
      // engagement end (active filter), or acknowledgment at this overage.
      const over = Math.max(0, usedRaw - Number(addon.hours))
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
      href: `/admin/tutoring?family=${stu?.family_id ?? ''}`,
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

  // --- PL-136: system health ------------------------------------------------
  const dayStartDenver = new Date(
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) + 'T00:00:00-06:00'
  ).toISOString()
  const [{ data: capRow }, { count: sendsToday }, { count: campaignToday }, { count: qboPendingCount }, { count: qboFailedCount }, { data: sweepRows }] =
    await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'resend_daily_cap').maybeSingle(),
      // Real sends AND test sends both consume the plan's quota.
      supabase
        .from('email_sends')
        .select('id', { count: 'exact', head: true })
        .in('status', ['sent', 'delivered', 'bounced', 'complained'])
        .gte('sent_at', dayStartDenver),
      // PL-201: campaign volume shown distinctly on the health card
      // (campaign sends are the dedupe keys the engine mints).
      supabase
        .from('email_sends')
        .select('id', { count: 'exact', head: true })
        .like('dedupe_key', 'campaign:%')
        .in('status', ['sent', 'delivered', 'bounced', 'complained'])
        .gte('sent_at', dayStartDenver),
      supabase.from('qbo_sync_log').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('qbo_sync_log').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['cron_sweep_started_at', 'cron_sweep_finished_at']),
    ])
  const sweepMap = Object.fromEntries(((sweepRows as any[]) ?? []).map((r) => [r.key, r.value]))
  const finishedAt = sweepMap.cron_sweep_finished_at ?? null
  const startedAt = sweepMap.cron_sweep_started_at ?? null
  const cap = Number(capRow?.value ?? 100)
  const used = sendsToday ?? 0
  const health: SystemHealth = {
    sends: {
      today: used,
      campaignToday: campaignToday ?? 0,
      cap,
      state: used >= cap ? 'full' : used >= cap * 0.8 ? 'warn' : 'ok',
    },
    qbo: { pending: qboPendingCount ?? 0, failed: qboFailedCount ?? 0 },
    sweep: {
      lastFinishedAt: finishedAt,
      // Hourly cron: more than two hours without finishing is a stall, and a
      // stalled sweep stops the whole email lifecycle silently.
      stale: !finishedAt || now.getTime() - new Date(finishedAt).getTime() > 2 * 3600_000,
      // Started much later than it finished = the current run is hanging.
      hanging: Boolean(
        startedAt &&
          (!finishedAt || startedAt > finishedAt) &&
          now.getTime() - new Date(startedAt).getTime() > 20 * 60_000
      ),
    },
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
  })
}
