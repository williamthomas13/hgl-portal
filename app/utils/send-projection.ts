import { supabaseAdmin as supabase } from './supabase-admin'
import {
  ADMIN_EMAIL,
  INTERNAL_EMAIL,
  REGISTRATION_NOTIFY_EMAIL,
  SEQUENCE,
  addDaysISO,
  classDetailsSendDate,
  effectiveDeadline,
  hoursSince,
  loadClassBundles,
  loadTutoringPackages,
  localDate,
  missingDetailsAlertStart,
  registrationCloseFor,
  spotsTaken,
  stepDisabledForClass,
  stepTargetDate,
  type ClassBundle,
} from './lifecycle'
import { zonedTimeToUtc } from './comms'
import { projectBundle } from './comms-projector'
import { classTutoringTier } from './tutoring-tier'
import { classQuietReason } from './class-quiet'
import { loadClassInstructor } from './instructor-comms'
import { DIGEST_INTERVAL_DAYS, contactsForClass, digestClasses, loadCounselorsBySchool } from './counselor-recipients'
import { lastClosedPeriod, periodContaining, tutorsWithPayableActivity } from './timecards'
import { collateralNudgeCandidates } from './collateral-nudge'
import { synapNudgeCandidates } from './synap-nudge'
import { intlCalendarConfig } from './intl-calendar'
import { loadGcalConnection } from './gcal'

// PL-471 D — "what will send?" answered BEFORE the sweep, for EVERY audience.
// The portal has no queue: every send is decided at sweep time from current
// state, and the Feature-A projector materializes only the FAMILY sequence.
// This module projects the rest — instructor, school contact, staff alerts,
// timecards, calendar writes — over a window, from the SAME predicates the
// sweeps run on (exported selections where they exist: tutorsWithPayable-
// Activity, collateral/synap candidates, counselor recipients, the class
// quiet rule, loadClassInstructor). Where a sweep's decision is inline in
// the cron route (hold alert, missing-details, min-enrollment, instructor
// nudge, deadline push, classroom request, digests) the projection mirrors
// the condition line for line and names the dedupe key it would claim, so a
// wrong projection is a gate failure, not a silent drift.
//
// Not projected (event-driven, fire from a request, never a sweep): payment
// milestones, waitlist offers/rollovers, cancellation blasts, instructor
// milestone pings, FO extend nudges, drift alerts, QBO/gcal queue retries.
// Those are listed in `notes` so the pre-flight reader knows the boundary.

export type ProjectedSend = {
  audience: 'family' | 'instructor' | 'school' | 'staff' | 'timecard' | 'calendar'
  /** Template key or a plain label for non-email writes. */
  template: string
  to: string
  /** ISO instant the sweep would act (the first hourly sweep at/after the
   *  condition becomes true). */
  when: string
  classId: string | null
  classLabel: string | null
  dedupeKey: string | null
  why: string
  /** 'held' when an admin hold row already exists for the key. */
  state?: 'held'
}

export type ProjectionReport = {
  from: string
  to: string
  hours: number
  rows: ProjectedSend[]
  /** Boundaries + skipped audiences, stated. */
  notes: string[]
  /** Per-class quiet verdicts (why nothing projects for a class). */
  quiet: { classId: string; classLabel: string; reason: string }[]
}

const label = (b: ClassBundle) => (b.isOpenEnrollment ? b.classType : `${b.schoolLabel} ${b.classType}`)

/** The first hourly sweep at/after `at` (sweeps run at :00). */
function nextSweepAfter(at: Date): string {
  const d = new Date(at.getTime())
  if (d.getUTCMinutes() > 0 || d.getUTCSeconds() > 0 || d.getUTCMilliseconds() > 0) {
    d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0)
  }
  return d.toISOString()
}

/** Class-local calendar days [today … the day containing `to`]. */
function localDaysIn(tz: string, from: Date, to: Date): string[] {
  const out: string[] = []
  let d = localDate(tz, from)
  const last = localDate(tz, to)
  for (let i = 0; i < 400 && d <= last; i++) {
    out.push(d)
    d = addDaysISO(d, 1)
  }
  return out
}

/** The sweep instant for "day D at/after hour H class-local": the first
 *  hourly sweep at/after that wall-clock moment, never before `from`. */
function dueAt(tz: string, day: string, hour: number, from: Date): string {
  const wall = zonedTimeToUtc(day, hour, tz)
  return nextSweepAfter(wall.getTime() < from.getTime() ? from : wall)
}

export async function projectSends(opts: { hours: number; now?: Date; classId?: string }): Promise<ProjectionReport> {
  const now = opts.now ?? new Date()
  const to = new Date(now.getTime() + opts.hours * 3_600_000)
  const inWindow = (iso: string) => iso >= now.toISOString() && iso <= to.toISOString()
  const report: ProjectionReport = { from: now.toISOString(), to: to.toISOString(), hours: opts.hours, rows: [], notes: [], quiet: [] }
  const rows = report.rows

  const bundles = (await loadClassBundles(opts.classId)).filter((b) => b.status !== 'draft')
  const packages = await loadTutoringPackages()
  const counselorsBySchool = await loadCounselorsBySchool()

  // One read for every dedupe key we might claim — a key with a row that is
  // not 'scheduled' is spoken for (sent, cancelled pre-claim, held, failed).
  const candidateKeys = new Set<string>()
  const pending: (() => void)[] = []
  const claimState = new Map<string, string>()
  const consider = (row: Omit<ProjectedSend, 'state'>) => {
    if (!inWindow(row.when)) return
    if (row.dedupeKey) candidateKeys.add(row.dedupeKey)
    pending.push(() => {
      const st = row.dedupeKey ? claimState.get(row.dedupeKey) : undefined
      if (st === undefined || st === 'scheduled') rows.push(row)
      else if (st === 'held') rows.push({ ...row, state: 'held' })
      // sent / delivered / cancelled / failed / bounced → already spoken for
    })
  }

  const gcal = await loadGcalConnection().catch(() => null)
  const gcalReady = Boolean(gcal?.key && gcal.status === 'connected')

  for (const b of bundles) {
    const tz = b.timezone
    const today = localDate(tz, now)
    const days = localDaysIn(tz, now, to)
    // Cancelled / 30-day-dead: the sweep `continue`s past the class entirely.
    if (b.status === 'cancelled') { report.quiet.push({ classId: b.id, classLabel: label(b), reason: 'class cancelled' }); continue }
    if (today > addDaysISO(b.lastSession, 30)) { report.quiet.push({ classId: b.id, classLabel: label(b), reason: 'class ended more than 30 days ago (the sweep skips it entirely)' }); continue }

    // ---- family: the Feature-A projector, same rows the Upcoming tab lists
    const tier = classTutoringTier({ school_id: b.schoolId, delivery_mode: b.deliveryMode })
    const familyRows = projectBundle(b, packages.pre.filter((p) => p.tier === tier))
    const familyInWindow = familyRows.filter((p) => inWindow(p.scheduled_for))
    for (const p of familyInWindow) {
      consider({ audience: 'family', template: p.email_type, to: p.recipient_email, when: p.scheduled_for, classId: b.id, classLabel: label(b), dedupeKey: p.dedupe_key, why: 'sequence step due (Feature-A projector)' })
    }

    const quiet = classQuietReason(b, today)
    if (quiet) {
      report.quiet.push({ classId: b.id, classLabel: label(b), reason: quiet })
      continue // PL-463/471: nothing class-keyed for a quiet class
    }

    // ---- instructor ------------------------------------------------------
    const instructor = await loadClassInstructor(b)
    if (instructor) {
      const regClose = registrationCloseFor(b)
      consider({ audience: 'instructor', template: 'IN_WELCOME', to: instructor.email, when: nextSweepAfter(now), classId: b.id, classLabel: label(b), dedupeKey: `in_welcome:${b.id}:${instructor.id}`, why: 'instructor assigned, digests on — welcome backfills on the next sweep' })
      for (const d of days) {
        const isMonday = new Date(d + 'T12:00:00Z').getUTCDay() === 1
        if (isMonday && d <= regClose && d < b.firstSession) {
          consider({ audience: 'instructor', template: 'IN_DIGEST', to: instructor.email, when: dueAt(tz, d, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `in_digest:${b.id}:${d}`, why: 'Monday weekly digest while registration is open' })
        }
      }
      const deadline = effectiveDeadline(b)
      for (const d of days) {
        if (d >= deadline && d <= regClose) {
          consider({ audience: 'instructor', template: 'IN_DIGEST', to: instructor.email, when: dueAt(tz, d, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `in_digest_brief:${b.id}:${deadline}`, why: 'deadline briefing (the morning the registration deadline arrives)' })
          break
        }
      }
      if (instructor.fyiCopies) {
        const fyiOf: Record<string, string> = { class_details: 'E4_CLASS_DETAILS', location_reminder: 'E5_LOCATION' }
        for (const p of familyInWindow) {
          const key = fyiOf[p.email_type]
          if (!key || !p.dedupe_key.startsWith(`${p.email_type}_p:`)) continue
          const day = localDate(tz, new Date(p.scheduled_for))
          consider({ audience: 'instructor', template: 'IN_FYI', to: instructor.email, when: p.scheduled_for, classId: b.id, classLabel: label(b), dedupeKey: `in_fyi:${b.id}:${key}:${day}`, why: `FYI copy rides the family ${key} send` })
        }
      }
    }

    // ---- staff alerts (the cron route's class-keyed checkpoints) ---------
    const staffTo = `${ADMIN_EMAIL} (+ alert subscribers)`
    const unmutedPaid = b.enrollments.filter((e) => (e.payment_status === 'Paid' || e.payment_status === 'Completed') && !e.commsMuted)
    const blank = !b.instructorName || !b.defaultLocation
    for (const step of SEQUENCE) {
      if (!step.holdOnBlankDetails || !blank || unmutedPaid.length === 0) continue
      if (stepDisabledForClass(step.type, b)) continue
      const target = stepTargetDate(step, b)
      for (const d of days) {
        if (d < target) continue
        consider({ audience: 'staff', template: 'AL_CLASS_DETAILS_HOLD', to: staffTo, when: dueAt(tz, d, d === target ? step.hour : 0, now), classId: b.id, classLabel: label(b), dedupeKey: `hold_alert:${b.id}:${d}`, why: `class-details email due (${target}) with ${!b.instructorName ? 'instructor' : ''}${!b.instructorName && !b.defaultLocation ? ' + ' : ''}${!b.defaultLocation ? 'location' : ''} blank — held, families waiting` })
      }
    }
    if (blank) {
      const start = missingDetailsAlertStart(b)
      for (const d of days) {
        if (d >= start && d <= b.firstSession) {
          consider({ audience: 'staff', template: 'AL_MISSING_DETAILS', to: staffTo, when: dueAt(tz, d, 0, now), classId: b.id, classLabel: label(b), dedupeKey: `blank_details:${b.id}:${d}`, why: `daily missing-details warning (class-details email goes out ${classDetailsSendDate(b)})` })
        }
      }
    }
    const paidOnly = b.enrollments.filter((e) => e.payment_status === 'Paid').length
    if (paidOnly < b.minEnrollment && !b.minEnrollmentDecision) {
      const deadline = effectiveDeadline(b)
      for (const d of days) {
        if (d > b.firstSession) break
        if (d >= addDaysISO(deadline, -3) && d <= deadline) {
          consider({ audience: 'staff', template: 'AL_MIN_ENROLLMENT', to: staffTo, when: dueAt(tz, d, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `min_enrollment:${b.id}:${deadline}`, why: `${paidOnly} paid / ${b.minEnrollment} minimum — decision brief at deadline −3d` })
          break
        }
        if (d > deadline) {
          consider({ audience: 'staff', template: 'AL_MIN_ENROLLMENT', to: staffTo, when: dueAt(tz, d, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `min_enrollment_followup:${b.id}:${deadline}`, why: `deadline passed still under minimum — the one follow-up` })
          break
        }
      }
    }
    if (!b.instructorId && !b.instructorName && paidOnly >= b.minEnrollment && today <= b.firstSession) {
      consider({ audience: 'staff', template: 'ADMIN_INSTRUCTOR_NUDGE', to: INTERNAL_EMAIL, when: dueAt(tz, today, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `instructor_nudge:${b.id}`, why: 'minimum met, no instructor assigned' })
      for (const [n, offset] of [[2, 8], [1, 11]] as const) {
        for (const d of days) {
          if (d >= addDaysISO(b.firstSession, -offset) && d <= b.firstSession) {
            consider({ audience: 'staff', template: 'ADMIN_INSTRUCTOR_NUDGE', to: INTERNAL_EMAIL, when: dueAt(tz, d, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `instructor_nudge:${b.id}:r${n}`, why: `re-nudge ${n} (${offset} days before the first session; 3-day spacing applies)` })
            break
          }
        }
      }
    }

    // ---- school contacts --------------------------------------------------
    const contacts = contactsForClass(b, counselorsBySchool)
    if (contacts.length > 0) {
      const regClose = registrationCloseFor(b)
      const deadline = effectiveDeadline(b)
      const paid = b.enrollments.filter((e) => e.payment_status === 'Paid' || e.payment_status === 'Completed').length
      const full = paid >= b.capacity
      const spotsLeft = b.capacity - spotsTaken(b)
      for (const d of days) {
        if (d > regClose) break
        if (d < addDaysISO(deadline, -3) || d > addDaysISO(deadline, -1)) continue
        if (!full && spotsLeft <= 0) continue
        for (const c of contacts) {
          if (full) consider({ audience: 'school', template: 'FP_ALT_CLASS_FULL', to: c.email, when: dueAt(tz, d, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `class_full_notice:${b.id}:${c.id}`, why: 'class full inside the final-days window' })
          else consider({ audience: 'school', template: 'FP_DEADLINE_PUSH', to: c.email, when: dueAt(tz, d, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `deadline_push:${b.id}:${c.id}:${d}`, why: `final-days push (deadline ${deadline})` })
        }
      }
      if (b.deliveryMode === 'in_person' && !b.defaultLocation && today <= b.firstSession) {
        const minReached = paid >= b.minEnrollment || b.minEnrollmentDecision === 'run_anyway'
        if (minReached) {
          const { data: existing } = await supabase.from('classroom_requests').select('id, status, nudge_count, created_at').eq('class_id', b.id).maybeSingle()
          if (!existing) {
            for (const c of contacts) consider({ audience: 'school', template: 'CR_CLASSROOM_REQUEST', to: c.email, when: dueAt(tz, today, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `classroom_request:${b.id}:${c.id}:0`, why: 'in-person, minimum reached, no room yet — the ask (PL-468 timing)' })
          } else if (existing.status === 'pending') {
            const askedIso = String(existing.created_at ?? now.toISOString()).slice(0, 10)
            const runway = Math.round((Date.parse(b.firstSession) - Date.parse(askedIso)) / 86_400_000)
            const gap = Math.min(3, Math.max(1, Math.floor(runway / 3)))
            for (const [i, offset] of [11, 8].entries()) {
              const n = i + 1
              if (existing.nudge_count >= n) continue
              const normalDue = addDaysISO(b.firstSession, -offset)
              const scaledDue = addDaysISO(askedIso, gap * n)
              const due = normalDue > scaledDue ? normalDue : scaledDue
              const d = days.find((x) => x >= due)
              if (d) for (const c of contacts) consider({ audience: 'school', template: n === 1 ? 'CR_CLASSROOM_NUDGE_2' : 'CR_CLASSROOM_NUDGE_3', to: c.email, when: dueAt(tz, d, 8, now), classId: b.id, classLabel: label(b), dedupeKey: `classroom_request:${b.id}:${c.id}:${n}`, why: `classroom nudge ${n + 1} due ${due}` })
              break
            }
          }
        }
      }
    }

    // ---- collateral / synap nudges: the exported selections, per day ------
    for (const d of days) {
      for (const c of await collateralNudgeCandidates(d)) {
        if (c.id !== b.id) continue
        consider({ audience: 'staff', template: 'AL_COLLATERAL_NUDGE', to: `${c.createdBy ?? ADMIN_EMAIL} (creator)`, when: dueAt(tz, d, 0, now), classId: b.id, classLabel: label(b), dedupeKey: `collateral_nudge:${b.id}`, why: 'collateral skipped and the counselor welcome is otherwise sendable' })
      }
      for (const c of await synapNudgeCandidates(d)) {
        if (c.id !== b.id) continue
        consider({ audience: 'staff', template: 'AL_SYNAP_NUDGE', to: `${c.createdBy ?? ADMIN_EMAIL} (creator)`, when: dueAt(tz, d, 0, now), classId: b.id, classLabel: label(b), dedupeKey: `synap_nudge:${b.id}`, why: 'Synap group skipped and the first diagnostic email is 3 days out' })
      }
    }

    // ---- calendar writes ---------------------------------------------------
    if (instructor && gcalReady) {
      const { data: sessions } = await supabase.from('sessions').select('id, session_date, instructor_gcal_event_id, instructor_gcal_email').eq('class_id', b.id).gte('session_date', today)
      const missing = (sessions ?? []).filter((s) => !s.instructor_gcal_event_id)
      const moved = (sessions ?? []).filter((s) => s.instructor_gcal_event_id && s.instructor_gcal_email !== instructor.email)
      if (missing.length > 0) consider({ audience: 'calendar', template: `create ${missing.length} class-session event${missing.length === 1 ? '' : 's'}`, to: instructor.email, when: nextSweepAfter(now), classId: b.id, classLabel: label(b), dedupeKey: null, why: 'sessions on/after today with no instructor calendar event' })
      if (moved.length > 0) consider({ audience: 'calendar', template: `move ${moved.length} event${moved.length === 1 ? '' : 's'} to the new instructor`, to: instructor.email, when: nextSweepAfter(now), classId: b.id, classLabel: label(b), dedupeKey: null, why: 'instructor changed — old events deleted, new ones created' })
    }
  }

  // ---- counselor digests (school-wide, Mondays) -------------------------------
  for (const [schoolId, counselors] of counselorsBySchool) {
    const classes = digestClasses(bundles, schoolId)
    if (classes.length === 0) continue
    const tz = classes[0].timezone
    for (const d of localDaysIn(tz, now, to)) {
      if (new Date(d + 'T12:00:00Z').getUTCDay() !== 1) continue
      for (const c of counselors) {
        if (c.digest_frequency === 'paused') continue
        const interval = DIGEST_INTERVAL_DAYS[c.digest_frequency] ?? 6
        const at = zonedTimeToUtc(d, 8, tz).getTime()
        if (c.digest_last_sent_at && (at - new Date(c.digest_last_sent_at).getTime()) / 3_600_000 < interval * 24) continue
        consider({ audience: 'school', template: 'CD_COUNSELOR_DIGEST', to: c.email, when: dueAt(tz, d, 8, now), classId: classes[0].id, classLabel: `${classes[0].schoolLabel} (${classes.length} class${classes.length === 1 ? '' : 'es'})`, dedupeKey: `counselor_digest:${c.id}:${d}`, why: `${c.digest_frequency} digest, Monday` })
      }
    }
  }

  // ---- timecards: every period that is "last closed" somewhere in the window
  const periods = new Map<string, { start: string; end: string }>()
  for (const at of [now, to]) {
    const p = lastClosedPeriod(at)
    periods.set(p.start, p)
  }
  for (const p of periods.values()) {
    // The sweep acts on the first run after the period closes (Denver midnight
    // after p.end) — or the next sweep if it is already closed.
    const closeAt = zonedTimeToUtc(addDaysISO(p.end, 1), 0, 'America/Denver')
    const when = nextSweepAfter(closeAt.getTime() < now.getTime() ? now : closeAt)
    for (const tutorId of await tutorsWithPayableActivity(p)) {
      const { data: tutor } = await supabase.from('instructors').select('email, name').eq('id', tutorId).maybeSingle()
      const { data: card } = await supabase.from('timecards').select('id').eq('tutor_id', tutorId).eq('period_start', p.start).maybeSingle()
      if (!card) consider({ audience: 'timecard', template: 'timecard created', to: tutor?.name ?? tutorId, when, classId: null, classLabel: null, dedupeKey: null, why: `payable activity in ${p.start} → ${p.end}` })
      if (tutor?.email) consider({ audience: 'timecard', template: 'T5_TIMECARD_READY', to: tutor.email, when, classId: null, classLabel: null, dedupeKey: `t5_timecard:${tutorId}:${p.start}`, why: `card for ${p.start} → ${p.end}` })
    }
  }
  void periodContaining
  void hoursSince
  void REGISTRATION_NOTIFY_EMAIL

  // ---- international classes calendar ----------------------------------------
  const intl = await intlCalendarConfig()
  if (!intl) report.notes.push('International Classes calendar: not configured (intl_classes_calendar_id unset) — the sync is a no-op for every class.')
  else if (!intl.enabled) report.notes.push('International Classes calendar: configured but sync DISABLED (intl_classes_sync_enabled ≠ true) — read-only; no writes.')
  else {
    const { data: cls } = await supabase.from('classes').select('id, intl_gcal_event_id, sessions ( intl_gcal_event_id )').neq('status', 'draft')
    let spans = 0, sess = 0
    for (const c of (cls ?? []) as { intl_gcal_event_id: string | null; sessions: { intl_gcal_event_id: string | null }[] }[]) {
      if (!c.intl_gcal_event_id) spans++
      sess += (c.sessions ?? []).filter((s) => !s.intl_gcal_event_id).length
    }
    if (spans + sess > 0) consider({ audience: 'calendar', template: `International Classes calendar: create ${spans} span + ${sess} session events`, to: intl.owner, when: nextSweepAfter(now), classId: null, classLabel: null, dedupeKey: null, why: 'sync enabled; events missing (records-only classes included — an ops calendar, not a send)' })
  }

  // Resolve the dedupe-claim state in one read.
  const keys = [...candidateKeys]
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await supabase.from('email_sends').select('dedupe_key, status').in('dedupe_key', keys.slice(i, i + 200))
    for (const r of data ?? []) claimState.set(r.dedupe_key, r.status)
  }
  for (const fn of pending) fn()
  rows.sort((a, b) => a.when.localeCompare(b.when))

  if (!gcalReady) report.notes.push('Google connection not connected — instructor calendar writes cannot happen.')
  report.notes.push(
    'Not projected (event-driven, never sweep-timed): registration/payment sends, waitlist offers + rollover alerts, cancellation blasts, instructor milestone pings and roster +1 notes, min-decision notes, FO extend nudges, tutoring billing/coverage/notes reminders, drift alerts, QBO + calendar queue retries.',
    'Family rows are the Feature-A projector (the Upcoming tab); the PL-457 mute and PL-464 same-address gates inside sendOnce still apply at send time.'
  )
  return report
}

/** Plain-text table for the CLI pre-flight. */
export function renderProjection(r: ProjectionReport): string {
  const lines: string[] = []
  lines.push(`Send projection — next ${r.hours}h (${r.from} → ${r.to})`)
  lines.push(`${r.rows.length} projected action${r.rows.length === 1 ? '' : 's'}`)
  if (r.rows.length > 0) {
    lines.push('when (UTC)           | audience   | template                       | to                                   | class                     | why')
    for (const x of r.rows) {
      lines.push(`${x.when.slice(0, 16).replace('T', ' ')} | ${x.audience.padEnd(10)} | ${x.template.slice(0, 30).padEnd(30)} | ${x.to.slice(0, 36).padEnd(36)} | ${(x.classLabel ?? '—').slice(0, 25).padEnd(25)} | ${x.why}${x.state === 'held' ? ' [HELD]' : ''}`)
    }
  }
  if (r.quiet.length > 0) {
    lines.push('')
    lines.push('Quiet classes (nothing class-keyed projects):')
    for (const q of r.quiet) lines.push(`  ${q.classLabel}: ${q.reason}`)
  }
  lines.push('')
  for (const n of r.notes) lines.push(`note: ${n}`)
  return lines.join('\n')
}
