import { emailBaseUrl } from './base-url'
import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, sendAdminAlert } from './email'
import { ADMIN_EMAIL } from './lifecycle'
import { enqueueGcalSync, processGcalQueue } from './gcal-sync'
import { blockHoldActive } from './block-confirm'
import { generateOccurrences, zonedToUtc, type RecurrenceSlot } from './tutoring'
import {
  contactBlockHtml,
  loadContactInfo,
  money,
  scheduleHtml,
  t1ProposalEmail,
  t1bNudgeEmail,
  type StudentScheduleBlock,
} from './tutoring-emails'
import { renderRegistered } from './comms-registered'
import { signingSecret } from './signing'

// Phase 7c monthly cycle engine (spec §6): generate → propose → confirm →
// (payment leg in tutoring-stripe.ts). Replaces the Ops Director's calendar
// screenshots + manual QBO invoices. Everything here is idempotent and
// re-runnable: generation rebuilds draft lines but never touches manual
// adjustment/credit lines or invoices past 'proposed'; email sends dedupe
// through sendOnce.

const ORG_TZ = 'America/Denver'
// PL-321: the signed-policy default; the Settings → Price list panel can
// change it via app_settings (engagement rate never changes it either way).
const LATE_RESCHEDULE_FEE_DEFAULT = 40
async function lateRescheduleFeePerHour(): Promise<number> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'late_reschedule_fee_per_hour')
    .maybeSingle()
  const n = Number(data?.value)
  return Number.isFinite(n) && n >= 0 ? n : LATE_RESCHEDULE_FEE_DEFAULT
}

// ---------------------------------------------------------------------------
// Settings (app_settings; §10.4 cycle dates are configuration, not code)
// ---------------------------------------------------------------------------

export type CycleSettings = { generateDay: number; nudgeDays: number; autoconfirmDays: number }

export async function loadCycleSettings(): Promise<CycleSettings> {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['tutoring_generate_day', 'tutoring_nudge_days', 'tutoring_autoconfirm_days'])
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  return {
    generateDay: Number(map.tutoring_generate_day ?? 20),
    nudgeDays: Number(map.tutoring_nudge_days ?? 2),
    autoconfirmDays: Number(map.tutoring_autoconfirm_days ?? 5),
  }
}

// ---------------------------------------------------------------------------
// Month helpers (billing months are Denver calendar months)
// ---------------------------------------------------------------------------

export type BillingMonth = {
  period: string // 'YYYY-MM-01' — tutoring_invoices.period
  firstDay: string // 'YYYY-MM-01'
  lastDay: string // 'YYYY-MM-30/31'
  label: string // 'September 2026'
}

export function billingMonth(yyyyMm: string): BillingMonth {
  const y = Number(yyyyMm.slice(0, 4))
  const m = Number(yyyyMm.slice(5, 7))
  const last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate()
  const firstDay = `${yyyyMm}-01`
  return {
    period: firstDay,
    firstDay,
    lastDay: `${yyyyMm}-${String(last).padStart(2, '0')}`,
    label: new Date(firstDay + 'T12:00:00Z').toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  }
}

/** The month after the one containing `now` (Denver). */
export function nextBillingMonth(now: Date = new Date()): BillingMonth {
  const today = now.toLocaleDateString('en-CA', { timeZone: ORG_TZ })
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return billingMonth(next)
}

/** Last day of the month containing `now` (Denver) — the §10.4 due date. */
export function currentMonthEnd(now: Date = new Date()): string {
  const today = now.toLocaleDateString('en-CA', { timeZone: ORG_TZ })
  return billingMonth(today.slice(0, 7)).lastDay
}

// ---------------------------------------------------------------------------
// Signed links (house HMAC pattern; distinct prefixes per purpose)
// ---------------------------------------------------------------------------

function sig(prefix: string, id: string): string {
  return createHmac('sha256', signingSecret())
    .update(`${prefix}:${id}`)
    .digest('hex')
    .slice(0, 32)
}

export function proposalToken(invoiceId: string): string {
  return `${invoiceId}.${sig('tutoring-proposal', invoiceId)}`
}

export function verifyProposalToken(token: string): string | null {
  const [id, given] = token.split('.')
  if (!id || !given) return null
  const expected = Buffer.from(sig('tutoring-proposal', id))
  const got = Buffer.from(given)
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null
}

export function autopayToken(familyId: string): string {
  return `${familyId}.${sig('tutoring-autopay', familyId)}`
}

/** Phase 7d: per-family tutoring calendar feed (extends the §11 ICS pattern). */
export function tutoringIcsToken(familyId: string): string {
  return `${familyId}.${sig('tutoring-ics', familyId)}`
}

export function verifyTutoringIcsToken(token: string): string | null {
  const [id, given] = token.split('.')
  if (!id || !given) return null
  const expected = Buffer.from(sig('tutoring-ics', id))
  const got = Buffer.from(given)
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null
}

export function verifyAutopayToken(token: string): string | null {
  const [id, given] = token.split('.')
  if (!id || !given) return null
  const expected = Buffer.from(sig('tutoring-autopay', id))
  const got = Buffer.from(given)
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null
}

const appUrl = () => emailBaseUrl()

// ---------------------------------------------------------------------------
// Generation (spec §6.1) — materialize next month's sessions as `proposed`
// and build one draft invoice per family
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

type EngagementFull = {
  id: string
  student_id: string
  tutor_id: string
  hourly_rate: number
  funding: 'monthly_billed' | 'package'
  /** PL-299: hours-block consent state — 'asked'/'declined' hold overflow
   *  billing; null (pre-flow) and 'confirmed' bill per PL-197 Case A. */
  block_confirmation: string | null
  addon_id: string | null
  recurrence: RecurrenceSlot[]
  status: string
  start_date: string | null
  student: { id: string; first_name: string; last_name: string } | null
  family: {
    id: string
    parent_first_name: string
    parent_last_name: string | null
    parent_email: string
    billing_email: string | null
    billing_cc_emails: string[]
    autopay: boolean
    timezone: string | null
  } | null
  subject: { name: string; category: string } | null
  tutor: { name: string | null; email: string; timezone: string } | null
}

async function loadActiveEngagements(): Promise<EngagementFull[]> {
  const { data, error } = await supabase
    .from('tutoring_engagements')
    .select(
      `id, student_id, tutor_id, hourly_rate, funding, addon_id, recurrence, status, start_date,
       block_confirmation,
       students ( id, first_name, last_name,
         families ( id, parent_first_name, parent_last_name, parent_email,
                    billing_email, billing_cc_emails, autopay, timezone ) ),
       subjects ( name, category ),
       instructors ( name, email, timezone )`
    )
    .eq('status', 'active')
  if (error) throw new Error(`engagement load failed: ${error.message}`)
  return ((data as any[]) ?? []).map((e) => {
    const student = one<any>(e.students)
    return {
      ...e,
      student: student ? { id: student.id, first_name: student.first_name, last_name: student.last_name } : null,
      family: one<any>(student?.families),
      subject: one<any>(e.subjects),
      tutor: one<any>(e.instructors),
    }
  })
}

/** Period bounds as instants, on the tutor's wall clock. */
function engagementPeriodBounds(month: BillingMonth, tutorTz: string) {
  const from = zonedToUtc(month.firstDay, '00:00', tutorTz)
  const y = Number(month.period.slice(0, 4))
  const m = Number(month.period.slice(5, 7))
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  const to = zonedToUtc(nextFirst, '00:00', tutorTz)
  return { fromIso: from.toISOString(), toIso: to.toISOString() }
}

/** Hours already drawn from a package addon by sessions BEFORE the period. */
/** PL-130: EXPORTED — the family portal's hours-remaining figure must come
 *  from this exact function (the same decrement machinery that bills),
 *  never a parallel count. */
export async function packageHoursUsedBefore(engagementId: string, beforeIso: string): Promise<number> {
  const { data } = await supabase
    .from('tutoring_sessions')
    .select('duration_minutes, status, reschedule_notice')
    .eq('engagement_id', engagementId)
    .lt('starts_at', beforeIso)
    .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
  return (data ?? [])
    .filter((s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late')
    .reduce((sum, s) => sum + s.duration_minutes / 60, 0)
}

export type GenerateResult = {
  month: string
  families: number
  sessionsCreated: number
  invoicesProposed: number
  t1Sent: number
  /** §12 guard: families invoiced this run with NO accepted policy agreement
   *  (warn, never block — the Ops Director chases via /admin/agreements). */
  familiesWithoutAgreement: number
  /** PL-144: families whose generation failed this run (isolated — the rest
   *  completed; the next sweep retries just these, generation is idempotent). */
  familiesFailed: number
}

// PL-144: the cron used to fire only when denverDay === generateDay, so one
// fully-failed day (outage, deploy breakage) skipped the month until someone
// noticed. Now the sweep asks "is generation due and not yet complete for the
// target month?" — day >= generateDay, and no completion marker. The marker
// is only stamped by a zero-failure run, so partial failures self-heal on the
// next hourly sweep (idempotency makes the re-run safe).
const GENERATED_MARKER_KEY = 'tutoring_generated_period'

export async function generationDueFor(
  now: Date,
  settings: CycleSettings
): Promise<BillingMonth | null> {
  const denverDay = Number(now.toLocaleDateString('en-CA', { timeZone: ORG_TZ }).slice(8, 10))
  if (denverDay < settings.generateDay) return null
  const month = nextBillingMonth(now)
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', GENERATED_MARKER_KEY)
    .maybeSingle()
  return data?.value === month.period ? null : month
}

/**
 * Run the monthly generation for `month` (default: next month). Safe to
 * re-run: sessions dedupe on start instant; draft/proposed invoices get their
 * session + carried-fee lines rebuilt (manual lines preserved); invoices
 * already confirmed/invoiced/paid are never touched; T1 dedupes per invoice.
 */
export async function generateMonthlyCycle(
  now: Date = new Date(),
  monthOverride?: string, // 'YYYY-MM' — staff QA / catch-up runs
  // Restrict the run to these family ids. Two callers: the PL-144
  // regression harness, and PL-195's "Retry now for this family" (the
  // family-card action on a generation failure). A scoped run never stamps
  // the month's completion marker.
  familyScope?: string[]
): Promise<GenerateResult> {
  const month = monthOverride ? billingMonth(monthOverride) : nextBillingMonth(now)
  const settings = await loadCycleSettings()
  const contact = await loadContactInfo()
  const engagements = (await loadActiveEngagements())
    .filter((e) => e.family && e.student && e.subject)
    .filter((e) => !familyScope || familyScope.includes(e.family!.id))
  const result: GenerateResult = {
    month: month.period,
    families: 0,
    sessionsCreated: 0,
    invoicesProposed: 0,
    t1Sent: 0,
    familiesWithoutAgreement: 0,
    familiesFailed: 0,
  }
  const unagreedFamilies: string[] = []
  // PL-144: one poison row must never starve the families after it. Every
  // per-engagement / per-family unit is caught here; failures roll into one
  // admin alert and the completion marker stays unset so the next sweep
  // retries (idempotently) until the month is clean.
  const failedFamilies = new Map<string, { label: string; errors: string[] }>()
  const familyFailed = (family: NonNullable<EngagementFull['family']>, e: unknown) => {
    const name = `${family.parent_first_name} ${family.parent_last_name ?? ''}`.trim()
    const entry = failedFamilies.get(family.id) ?? {
      label: `<a href="${appUrl()}/admin/tutoring?family=${family.id}" style="color:#00AEEE">${name}</a> (${family.parent_email})`,
      errors: [],
    }
    entry.errors.push(e instanceof Error ? e.message : String(e))
    failedFamilies.set(family.id, entry)
    console.error(`monthly generation failed for family ${family.id} (${name}):`, e)
  }

  // ---- 1. Materialize proposed sessions per engagement -------------------
  type PeriodSession = {
    id: string
    engagement: EngagementFull
    starts_at: string
    ends_at: string
    duration_minutes: number
    status: string
  }
  const byFamily = new Map<string, { engagements: EngagementFull[]; sessions: PeriodSession[] }>()

  for (const eng of engagements) {
    try {
    const tz = eng.tutor?.timezone ?? ORG_TZ
    const { fromIso, toIso } = engagementPeriodBounds(month, tz)

    // PL-323A: while a block's continue question is open (asked) or answered
    // no (declined), the cycle materializes NOTHING new — otherwise the
    // auto-drop would release sessions only for the next generation to
    // quietly re-create them.
    if (eng.funding === 'package' && blockHoldActive(eng.block_confirmation)) {
      // fall through to billing (which holds its own lines) with no new rows
    } else if (Array.isArray(eng.recurrence) && eng.recurrence.length > 0) {
      const { data: existing } = await supabase
        .from('tutoring_sessions')
        .select('starts_at')
        .eq('engagement_id', eng.id)
        .gte('starts_at', fromIso)
        .lt('starts_at', toIso)
        // PL-62: cancelled/rescheduled rows are tombstones — a slot a family
        // vacated (moved or dropped pre-confirmation) must never be
        // re-materialized by a cycle re-run.
        .in('status', ['proposed', 'confirmed', 'rescheduled', 'cancelled'])
      const taken = new Set((existing ?? []).map((s) => new Date(s.starts_at).getTime()))
      // PL-200: never materialize before the engagement's start date — a
      // mid-month (or mid-NEXT-month) start must not grow occurrences in the
      // gap between generation day and the agreed first session.
      const occFrom =
        eng.start_date && eng.start_date > month.firstDay ? eng.start_date : month.firstDay
      const rows = generateOccurrences(eng.recurrence, occFrom, month.lastDay, tz)
        .filter((o) => !taken.has(o.startsAt.getTime()) && o.startsAt.getTime() > now.getTime())
        .map((o) => ({
          engagement_id: eng.id,
          student_id: eng.student_id,
          tutor_id: eng.tutor_id,
          starts_at: o.startsAt.toISOString(),
          ends_at: o.endsAt.toISOString(),
          status: 'proposed', // no Google event until confirmed (§6.3)
          rate_snapshot: eng.hourly_rate,
        }))
      if (rows.length > 0) {
        const { error } = await supabase.from('tutoring_sessions').insert(rows)
        if (error) throw new Error(`generation insert failed: ${error.message}`)
        result.sessionsCreated += rows.length
      }
    }

    // Everything billable in the period (whoever created it — the 7a wizard's
    // horizon sessions are already 'confirmed' and still belong on the bill).
    const { data: periodSessions } = await supabase
      .from('tutoring_sessions')
      .select('id, starts_at, ends_at, duration_minutes, status')
      .eq('engagement_id', eng.id)
      .gte('starts_at', fromIso)
      .lt('starts_at', toIso)
      .in('status', ['proposed', 'confirmed'])
      .order('starts_at')

    const famId = eng.family!.id
    if (!byFamily.has(famId)) byFamily.set(famId, { engagements: [], sessions: [] })
    const bucket = byFamily.get(famId)!
    bucket.engagements.push(eng)
    for (const s of periodSessions ?? []) bucket.sessions.push({ ...s, engagement: eng })
    } catch (e) {
      familyFailed(eng.family!, e)
    }
  }

  // ---- 2. One invoice per family ------------------------------------------
  for (const [familyId, bucket] of byFamily) {
    if (bucket.sessions.length === 0) continue
    // PL-144: a family whose session materialization failed would get a
    // partial (wrong) invoice + T1 — skip it entirely; the retry sweep
    // rebuilds it whole.
    if (failedFamilies.has(familyId)) continue
    result.families++
    const family = bucket.engagements[0].family!
    try {

    // §12 guard: warn (never block) when billing a family with no accepted
    // policy agreement — the /admin/agreements banner lists them too.
    const { count: acceptances } = await supabase
      .from('agreement_acceptances')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', familyId)
    if ((acceptances ?? 0) === 0) {
      result.familiesWithoutAgreement++
      unagreedFamilies.push(
        // PL-97: each family deep-links its agreements row.
        `<a href="${appUrl()}/admin/agreements?family=${familyId}" style="color:#00AEEE">${`${family.parent_first_name} ${family.parent_last_name ?? ''}`.trim()}</a> (${family.parent_email})`
      )
    }

    // Find-or-create the invoice; regeneration only touches draft/proposed.
    let { data: invoice } = await supabase
      .from('tutoring_invoices')
      .select('id, status')
      .eq('family_id', familyId)
      .eq('period', month.period)
      .maybeSingle()
    if (!invoice) {
      const { data: created, error } = await supabase
        .from('tutoring_invoices')
        .insert({ family_id: familyId, period: month.period, status: 'draft' })
        .select('id, status')
        .single()
      if (error) throw new Error(`invoice insert failed: ${error.message}`)
      invoice = created
    }
    if (!['draft', 'proposed'].includes(invoice.status)) continue // already moving through payment

    // Rebuild generated lines; manual adjustment/credit/late-fee lines stay.
    await supabase
      .from('tutoring_invoice_lines')
      .delete()
      .eq('invoice_id', invoice.id)
      .in('kind', ['session', 'late_reschedule_fee'])

    const lines: Record<string, unknown>[] = []
    let packageCoveredHours = 0

    for (const eng of bucket.engagements) {
      const engSessions = bucket.sessions
        .filter((s) => s.engagement.id === eng.id)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      // PL-197: no early skip on an empty period — a package engagement with
      // slipped overflow must still get its carry even when its own sessions
      // have wound down (the family's invoice exists via its other sessions).

      // Package draw-down (§6.1): sessions consume the prepaid balance
      // chronologically; only the overflow is billed. PL-197: the drawdown is
      // recomputed over the ENGAGEMENT'S WHOLE HISTORY, not just this period —
      // and overflow that slipped past earlier cycles (sessions added after a
      // month's invoice was already confirmed/paid — Roman's 9h) is CARRIED
      // onto this invoice like a late fee, deduped by the session's own line.
      const coveredIds = new Set<string>()
      if (eng.funding === 'package' && eng.addon_id) {
        const { data: addon } = await supabase
          .from('enrollment_addons')
          .select('hours')
          .eq('id', eng.addon_id)
          .maybeSingle()
        let running = Number(addon?.hours ?? 0)
        const { data: allConsuming } = await supabase
          .from('tutoring_sessions')
          .select('id, starts_at, duration_minutes, status, reschedule_notice')
          .eq('engagement_id', eng.id)
          .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
          .order('starts_at')
        const consuming = ((allConsuming as any[]) ?? []).filter(
          (s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late'
        )
        const tz = eng.tutor?.timezone ?? ORG_TZ
        const { fromIso } = engagementPeriodBounds(month, tz)
        for (const s of consuming) {
          const h = s.duration_minutes / 60
          if (running >= h) {
            running -= h
            coveredIds.add(s.id)
            continue
          }
          running = 0
          // Overflow BEFORE this period with no line anywhere = it slipped a
          // cycle (its month's invoice had already left draft/proposed when
          // the session appeared). Bill it now, once. Tombstones never get a
          // session line (their cost is the late fee).
          if (s.starts_at >= fromIso || s.status === 'rescheduled') continue
          // PL-299: overflow past the block NEVER bills while the family's
          // answer is pending (asked) or was no (declined). Null keeps the
          // PL-197 legacy behavior; confirmed IS the Case-A path.
          if (blockHoldActive(eng.block_confirmation)) continue
          const { data: hasLine } = await supabase
            .from('tutoring_invoice_lines')
            .select('id')
            .eq('session_id', s.id)
            .eq('kind', 'session')
            .limit(1)
          if (hasLine?.length) continue
          const h2 = s.duration_minutes / 60
          lines.push({
            invoice_id: invoice.id,
            session_id: s.id,
            description: `${eng.student!.first_name} — ${eng.subject!.name} with ${eng.tutor?.name ?? 'tutor'}, ${new Date(
              s.starts_at
            ).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })} (past the prepaid package)`,
            qty_hours: h2,
            rate: eng.hourly_rate,
            amount: Number((h2 * eng.hourly_rate).toFixed(2)),
            kind: 'session',
          })
        }
      }

      for (const s of engSessions) {
        const hours = s.duration_minutes / 60
        const when = new Date(s.starts_at).toLocaleDateString('en-US', {
          timeZone: eng.tutor?.timezone ?? ORG_TZ,
          month: 'short',
          day: 'numeric',
        })
        if (eng.funding === 'package' && coveredIds.has(s.id)) {
          packageCoveredHours += hours
          continue // covered by the prepaid balance — no line
        }
        // PL-299: an uncovered (past-the-block) session on a block engagement
        // whose family hasn't confirmed does not bill — the consent gate.
        if (eng.funding === 'package' && blockHoldActive(eng.block_confirmation)) continue
        lines.push({
          invoice_id: invoice.id,
          session_id: s.id,
          description: `${eng.student!.first_name} — ${eng.subject!.name} with ${eng.tutor?.name ?? 'tutor'}, ${when}`,
          qty_hours: hours,
          rate: eng.hourly_rate,
          amount: Number((hours * eng.hourly_rate).toFixed(2)),
          kind: 'session',
        })
      }
    }

    // Carried late-reschedule fees (§6.5): $40/hour on the ORIGINAL slot,
    // appended to the next invoice; a line referencing the session marks it
    // charged so it can never double-bill.
    const { data: lateOnes } = await supabase
      .from('tutoring_sessions')
      .select('id, starts_at, duration_minutes, students ( first_name )')
      .eq('status', 'rescheduled')
      .eq('reschedule_notice', 'late')
      // PL-148: a UTC month boundary here disagreed with the tutor-local
      // bounds used everywhere else, so a late reschedule in the last ~7
      // hours of a Denver month read as "next month" and its fee slipped an
      // entire billing cycle. Same zoned boundary as the rest of the engine.
      .lt('starts_at', zonedToUtc(month.firstDay, '00:00', ORG_TZ).toISOString())
      .in('engagement_id', bucket.engagements.map((e) => e.id))
    for (const s of (lateOnes as any[]) ?? []) {
      const { data: charged } = await supabase
        .from('tutoring_invoice_lines')
        .select('id')
        .eq('session_id', s.id)
        .eq('kind', 'late_reschedule_fee')
        .limit(1)
      if (charged?.length) continue
      const hours = s.duration_minutes / 60
      const feeRate = await lateRescheduleFeePerHour()
      lines.push({
        invoice_id: invoice.id,
        session_id: s.id,
        description: `Late reschedule fee (${one<any>(s.students)?.first_name ?? 'student'}, under 24h notice, ${new Date(s.starts_at).toLocaleDateString('en-US', { timeZone: ORG_TZ, month: 'short', day: 'numeric' })})`,
        qty_hours: hours,
        rate: feeRate,
        amount: Number((hours * feeRate).toFixed(2)),
        kind: 'late_reschedule_fee',
      })
    }

    if (lines.length > 0) {
      const { error } = await supabase.from('tutoring_invoice_lines').insert(lines)
      if (error) throw new Error(`line insert failed: ${error.message}`)
    }
    await recomputeInvoiceTotals(invoice.id)

    // ---- 3. Propose (T1) ---------------------------------------------------
    const famTz = family.timezone ?? bucket.engagements[0].tutor?.timezone ?? ORG_TZ
    const blocks: StudentScheduleBlock[] = bucket.engagements
      .map((eng) => {
        const engSessions = bucket.sessions.filter((s) => s.engagement.id === eng.id)
        if (engSessions.length === 0) return null
        return {
          studentFirst: eng.student!.first_name,
          subjectName: eng.subject!.name,
          tutorFirst: (eng.tutor?.name ?? 'your tutor').split(' ')[0],
          sessionLines: engSessions.map((s) => {
            const d = new Date(s.starts_at)
            const e = new Date(s.ends_at)
            const day = d.toLocaleDateString('en-US', { timeZone: famTz, weekday: 'short', month: 'short', day: 'numeric' })
            const t1 = d.toLocaleTimeString('en-US', { timeZone: famTz, hour: 'numeric', minute: '2-digit' })
            const t2 = e.toLocaleTimeString('en-US', { timeZone: famTz, hour: 'numeric', minute: '2-digit' })
            return `${day} · ${t1}–${t2}`
          }),
        }
      })
      .filter((b): b is StudentScheduleBlock => b !== null)

    // PL-200: a current-month (mid-month remainder) run labels the T1 with
    // the partial period actually billed — "August 12–31", never a bare
    // "August" that implies a full month.
    const nowYm = now.toLocaleDateString('en-CA', { timeZone: ORG_TZ }).slice(0, 7)
    let monthLabel = month.label
    if (month.period.slice(0, 7) === nowYm && bucket.sessions.length > 0) {
      const firstDayNum = Math.min(
        ...bucket.sessions.map((s) =>
          Number(new Date(s.starts_at).toLocaleDateString('en-CA', { timeZone: famTz }).slice(8, 10))
        )
      )
      if (Number.isFinite(firstDayNum) && firstDayNum > 1) {
        // PL-216: a one-day remainder reads "July 31", never "July 31–31".
        const lastDayNum = Number(month.lastDay.slice(8, 10))
        monthLabel =
          firstDayNum === lastDayNum
            ? `${month.label.split(' ')[0]} ${firstDayNum}`
            : `${month.label.split(' ')[0]} ${firstDayNum}–${lastDayNum}`
      }
    }

    const { data: fresh } = await supabase
      .from('tutoring_invoices')
      .select('total, status, proposal_sent_at')
      .eq('id', invoice.id)
      .single()
    const t1Opts = {
      monthLabel,
      blocks,
      totalDue: Number(fresh?.total ?? 0),
      packageNote:
        packageCoveredHours > 0
          ? `${packageCoveredHours} hour${packageCoveredHours === 1 ? '' : 's'} this month ${Number(fresh?.total ?? 0) > 0 ? 'are' : 'is fully'} covered by your prepaid package.`
          : null,
      link: `${appUrl()}/tutoring/schedule/${proposalToken(invoice.id)}`,
      autoconfirmDays: settings.autoconfirmDays,
      contact,
    }
    // PL-13: registry template when live; code copy otherwise.
    const email = await renderRegistered(
      'T1_MONTHLY_PROPOSAL',
      { parentFirstName: family.parent_first_name ?? 'there', parentEmail: family.parent_email },
      {
        tutoringMonthLabel: monthLabel,
        studentNames: [...new Set(blocks.map((b) => b.studentFirst))].join(' & '),
        scheduleBlock: scheduleHtml(blocks),
        monthTotalLine:
          Number(fresh?.total ?? 0) > 0
            ? `<p style="font-size:16px"><strong>Month total: ${money(Number(fresh?.total ?? 0))}</strong> — billed once you confirm, due by the end of this month.</p>`
            : '',
        packageNote: t1Opts.packageNote ? `<p>${t1Opts.packageNote}</p>` : '',
        confirmLink: t1Opts.link,
        // PL-62: the email's Confirm button confirms in one tap (the page
        // auto-POSTs on load); the request-changes link keeps the plain URL.
        confirmOneTapLink: `${t1Opts.link}?confirm=1`,
        autoconfirmDays: settings.autoconfirmDays,
        contactBlock: contactBlockHtml(contact),
      },
      () => t1ProposalEmail(t1Opts)
    )
    const sent = await sendOnce({
      dedupeKey: `t1_proposal:${invoice.id}`,
      emailType: 'T1_MONTHLY_PROPOSAL',
      to: [family.billing_email ?? family.parent_email],
      cc: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
      subject: email.subject,
      html: email.html,
    })
    if (sent === 'sent') result.t1Sent++
    if (fresh?.status === 'draft' || !fresh?.proposal_sent_at) {
      await supabase
        .from('tutoring_invoices')
        .update({
          status: 'proposed',
          proposal_sent_at: fresh?.proposal_sent_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id)
        .in('status', ['draft', 'proposed'])
      result.invoicesProposed++
    }
    } catch (e) {
      familyFailed(family, e)
    }
  }
  result.familiesFailed = failedFamilies.size

  // PL-195: a failed generation is a STATE on the family, not just a flash —
  // one generation_failures row per (family, period) while it's failing.
  // State-driven both directions: a later successful run (this sweep, or the
  // family-card Retry now) DELETES the row.
  try {
    // A SCOPED retry that ends clean clears its families even when nothing
    // was left to generate (e.g. the fix was ending the broken engagement).
    const succeeded = (familyScope ?? [...byFamily.keys()]).filter((id) => !failedFamilies.has(id))
    if (succeeded.length > 0) {
      await supabase
        .from('generation_failures')
        .delete()
        .eq('period', month.period)
        .in('family_id', succeeded)
    }
    if (failedFamilies.size > 0) {
      await supabase.from('generation_failures').upsert(
        [...failedFamilies.entries()].map(([familyId, f]) => ({
          family_id: familyId,
          period: month.period,
          error: f.errors.join('; ').slice(0, 500),
          last_attempt_at: new Date().toISOString(),
        })),
        { onConflict: 'family_id,period' }
      )
    }
  } catch (e) {
    console.error('generation-failure state update failed (run stands):', e)
  }

  // PL-144: stamp the completion marker ONLY on a clean, unscoped run — the
  // hourly sweep keeps retrying (idempotently) while any family is failing,
  // and a harness-scoped run never speaks for the whole month.
  if (failedFamilies.size === 0) {
    if (!familyScope) {
      await supabase
        .from('app_settings')
        .upsert({ key: GENERATED_MARKER_KEY, value: month.period })
    }
  } else {
    const total = result.families + failedFamilies.size
    const dayStamp = new Date().toLocaleDateString('en-CA', { timeZone: ORG_TZ })
    await sendAdminAlert({
      // Once per Denver day, not per hourly retry — but a failure that
      // persists into tomorrow alerts again.
      dedupeKey: `tutoring_gen_failures:${month.period}:${dayStamp}`,
      adminEmail: ADMIN_EMAIL,
      subject: `Monthly tutoring generation: ${result.families} of ${total} famil${total === 1 ? 'y' : 'ies'} completed — ${failedFamilies.size} failed`,
      body: `<p>The ${month.label} billing cycle generated ${result.families} of ${total} families.
        These families failed and will be retried automatically on the next hourly sweep
        (nobody else was affected — each family generates independently):</p>
        <ul>${[...failedFamilies.values()]
          .map((f) => `<li>${f.label} — ${f.errors.map((m) => m.replace(/</g, '&lt;')).join('; ')}</li>`)
          .join('')}</ul>
        <p>If a family keeps failing, open their row from the link above — the error text
        usually names the broken record.</p>`,
    }).catch((e) => console.error('generation-failures alert failed:', e))
  }

  if (unagreedFamilies.length > 0) {
    await sendAdminAlert({
      dedupeKey: `unagreed_families:${month.period}`,
      adminEmail: ADMIN_EMAIL,
      templateKey: 'AL_UNAGREED',
      // PL-216: the variable carries the WHOLE noun phrase ("1 tutoring
      // family" / "2 tutoring families") so the template subject can't
      // mismatch the count's plural.
      vars: {
        alertCounts: `${unagreedFamilies.length} tutoring famil${unagreedFamilies.length === 1 ? 'y' : 'ies'}`,
      },
      subject: `${unagreedFamilies.length} tutoring famil${unagreedFamilies.length === 1 ? 'y' : 'ies'} billed without a signed policy agreement`,
      body: `<p>The ${month.label} cycle just proposed invoices for families with no accepted
        scheduling &amp; billing agreement on file (invoicing proceeds, but chase these):</p>
        <ul>${unagreedFamilies.map((f) => `<li>${f}</li>`).join('')}</ul>
        <p>Send or re-send agreement links from
        <a href="${appUrl()}/admin/agreements" style="color:#00AEEE">the agreements panel</a>
        — or click a family's name above to jump straight to their row.</p>`,
    }).catch((e) => console.error('unagreed-families alert failed:', e))
  }
  return result
}

// ---------------------------------------------------------------------------
// PL-333 A: the read-only UPCOMING-MONTH projection — what the generator
// above WILL do on the generate day, computed from the same inputs and the
// same building blocks (loadActiveEngagements, engagementPeriodBounds,
// generateOccurrences, blockHoldActive, the package-drawdown walk), with
// zero writes. It deliberately mirrors phases 1–2 of generateMonthlyCycle
// line for line — change a billing rule THERE and change it HERE, and the
// regress:monthly-generation harness asserts preview total === generated
// invoice total so a drift fails the gate instead of lying to Kelsie.
// Families that already HAVE an invoice row for the month are skipped: their
// reality is on the panel already (preview is only for what doesn't exist).
// ---------------------------------------------------------------------------

export type PreviewLine = {
  studentFirst: string
  subjectName: string
  tutorName: string | null
  /** Billable hours (for packages: only the uncovered overflow). */
  hours: number
  /** Hours the prepaid package covers this month (informational). */
  coveredHours: number
  rate: number
  amount: number
  /** PL-323: block hold (asked/declined) — nothing new materializes or bills. */
  held: boolean
}

export type PreviewFamilyRow = {
  familyId: string
  familyName: string
  parentEmail: string
  autopay: boolean
  lines: PreviewLine[]
  /** Carried late-reschedule fees the generator would append (§6.5). */
  carriedFees: number
  projectedHours: number
  projectedTotal: number
}

export type CyclePreview = { month: string; monthLabel: string; rows: PreviewFamilyRow[] }

export async function previewMonthlyCycle(
  now: Date = new Date(),
  monthOverride?: string,
  familyScope?: string[]
): Promise<CyclePreview> {
  const month = monthOverride ? billingMonth(monthOverride) : nextBillingMonth(now)
  const engagements = (await loadActiveEngagements())
    .filter((e) => e.family && e.student && e.subject)
    .filter((e) => !familyScope || familyScope.includes(e.family!.id))

  type SimSession = { starts_at: string; duration_minutes: number; existing: boolean }
  const byFamily = new Map<
    string,
    { family: NonNullable<EngagementFull['family']>; engagements: { eng: EngagementFull; sessions: SimSession[] }[] }
  >()

  for (const eng of engagements) {
    const tz = eng.tutor?.timezone ?? ORG_TZ
    const { fromIso, toIso } = engagementPeriodBounds(month, tz)
    const held = eng.funding === 'package' && blockHoldActive(eng.block_confirmation)

    // Mirror of phase 1: what already exists + what the run would create.
    const { data: existing } = await supabase
      .from('tutoring_sessions')
      .select('starts_at, duration_minutes, status')
      .eq('engagement_id', eng.id)
      .gte('starts_at', fromIso)
      .lt('starts_at', toIso)
      .in('status', ['proposed', 'confirmed', 'rescheduled', 'cancelled'])
    const billableExisting: SimSession[] = ((existing as any[]) ?? [])
      .filter((s) => ['proposed', 'confirmed'].includes(s.status))
      .map((s) => ({ starts_at: s.starts_at, duration_minutes: s.duration_minutes, existing: true }))
    const taken = new Set(((existing as any[]) ?? []).map((s) => new Date(s.starts_at).getTime()))
    let simulated: SimSession[] = []
    if (!held && Array.isArray(eng.recurrence) && eng.recurrence.length > 0) {
      const occFrom =
        eng.start_date && eng.start_date > month.firstDay ? eng.start_date : month.firstDay
      simulated = generateOccurrences(eng.recurrence, occFrom, month.lastDay, tz)
        .filter((o) => !taken.has(o.startsAt.getTime()) && o.startsAt.getTime() > now.getTime())
        .map((o) => ({
          starts_at: o.startsAt.toISOString(),
          duration_minutes: Math.round((o.endsAt.getTime() - o.startsAt.getTime()) / 60_000),
          existing: false,
        }))
    }
    const famId = eng.family!.id
    if (!byFamily.has(famId)) byFamily.set(famId, { family: eng.family!, engagements: [] })
    byFamily.get(famId)!.engagements.push({
      eng,
      sessions: [...billableExisting, ...simulated].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    })
  }

  const rows: PreviewFamilyRow[] = []
  for (const [familyId, bucket] of byFamily) {
    if (bucket.engagements.every((b) => b.sessions.length === 0)) continue
    // A real invoice for the month exists → it renders as itself on the
    // panel; the preview only speaks for what hasn't generated yet.
    const { data: invoice } = await supabase
      .from('tutoring_invoices')
      .select('id')
      .eq('family_id', familyId)
      .eq('period', month.period)
      .maybeSingle()
    if (invoice) continue

    const lines: PreviewLine[] = []
    for (const { eng, sessions } of bucket.engagements) {
      const held = eng.funding === 'package' && blockHoldActive(eng.block_confirmation)
      let billableHours = 0
      let coveredHours = 0
      if (eng.funding === 'package' && eng.addon_id) {
        // Mirror of phase 2's drawdown: the whole consuming history — with
        // the would-be sessions folded in chronologically — draws the
        // prepaid balance down; only in-period overflow bills (plus
        // pre-period overflow that slipped a cycle and has no line yet).
        const { data: addon } = await supabase
          .from('enrollment_addons')
          .select('hours')
          .eq('id', eng.addon_id)
          .maybeSingle()
        let running = Number(addon?.hours ?? 0)
        const { data: allConsuming } = await supabase
          .from('tutoring_sessions')
          .select('id, starts_at, duration_minutes, status, reschedule_notice')
          .eq('engagement_id', eng.id)
          .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
          .order('starts_at')
        const tz = eng.tutor?.timezone ?? ORG_TZ
        const { fromIso } = engagementPeriodBounds(month, tz)
        const consuming: { id: string | null; starts_at: string; duration_minutes: number; status: string }[] = [
          ...(((allConsuming as any[]) ?? []).filter(
            (s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late'
          ) as any[]),
          ...sessions.filter((s) => !s.existing).map((s) => ({ id: null, status: 'proposed', ...s })),
        ].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        for (const s of consuming) {
          const h = s.duration_minutes / 60
          if (running >= h) {
            running -= h
            if (s.starts_at >= fromIso) coveredHours += h
            continue
          }
          running = 0
          if (held) continue
          if (s.starts_at >= fromIso) {
            // The generator's in-period billing loop covers proposed/confirmed
            // only (its periodSessions select) — mirror it exactly.
            if (s.status === 'proposed' || s.status === 'confirmed') billableHours += h
            continue
          }
          // Pre-period slipped overflow, carried once (tombstones never).
          if (s.status === 'rescheduled' || !s.id) continue
          const { data: hasLine } = await supabase
            .from('tutoring_invoice_lines')
            .select('id')
            .eq('session_id', s.id)
            .eq('kind', 'session')
            .limit(1)
          if (!hasLine?.length) billableHours += h
        }
      } else {
        billableHours = sessions.reduce((sum, s) => sum + s.duration_minutes / 60, 0)
      }
      if (billableHours === 0 && coveredHours === 0 && sessions.length === 0) continue
      lines.push({
        studentFirst: eng.student!.first_name,
        subjectName: eng.subject!.name,
        tutorName: eng.tutor?.name ?? null,
        hours: Number(billableHours.toFixed(2)),
        coveredHours: Number(coveredHours.toFixed(2)),
        rate: eng.hourly_rate,
        amount: Number((billableHours * eng.hourly_rate).toFixed(2)),
        held,
      })
    }

    // Mirror of the carried late-reschedule fees (§6.5), read-only.
    let carriedFees = 0
    const { data: lateOnes } = await supabase
      .from('tutoring_sessions')
      .select('id, duration_minutes')
      .eq('status', 'rescheduled')
      .eq('reschedule_notice', 'late')
      .lt('starts_at', zonedToUtc(month.firstDay, '00:00', ORG_TZ).toISOString())
      .in('engagement_id', bucket.engagements.map((b) => b.eng.id))
    for (const s of (lateOnes as any[]) ?? []) {
      const { data: charged } = await supabase
        .from('tutoring_invoice_lines')
        .select('id')
        .eq('session_id', s.id)
        .eq('kind', 'late_reschedule_fee')
        .limit(1)
      if (charged?.length) continue
      carriedFees += (s.duration_minutes / 60) * (await lateRescheduleFeePerHour())
    }

    if (lines.length === 0 && carriedFees === 0) continue
    const projectedTotal = Number(
      (lines.reduce((sum, l) => sum + l.amount, 0) + carriedFees).toFixed(2)
    )
    rows.push({
      familyId,
      familyName: `${bucket.family.parent_first_name} ${bucket.family.parent_last_name ?? ''}`.trim(),
      parentEmail: bucket.family.parent_email,
      autopay: bucket.family.autopay === true,
      lines,
      carriedFees: Number(carriedFees.toFixed(2)),
      projectedHours: Number(lines.reduce((sum, l) => sum + l.hours, 0).toFixed(2)),
      projectedTotal,
    })
  }
  rows.sort((a, b) => a.familyName.localeCompare(b.familyName))
  return { month: month.period, monthLabel: month.label, rows }
}

/**
 * PL-200: a monthly-billed engagement that starts mid-month must bill its
 * current-month remainder IMMEDIATELY — the cycle only ever targets the next
 * month, so without this the start-through-month-end sessions are scheduled,
 * confirmed, welcomed… and never billed. Runs the scoped, idempotent
 * generation for the current month (no-op when nothing in the month is
 * billable; paid/confirmed invoices untouched; never stamps the completion
 * marker). Post-20th, ALSO folds the family into the already-generated next
 * month — the sweep believes that month is complete and would never come
 * back for them. Callers sequence this AFTER the welcome/all-set sends so
 * the remainder T1 never races them into the inbox.
 */
export async function billMidMonthStart(engagementId: string): Promise<void> {
  const now = new Date()
  const { data: eng } = await supabase
    .from('tutoring_engagements')
    .select('id, funding, status, students ( family_id )')
    .eq('id', engagementId)
    .maybeSingle()
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const familyId = (one<any>(eng?.students) as any)?.family_id as string | undefined
  if (!eng || !familyId) return
  if (eng.funding === 'package') return // drawdown needs no invoice — unchanged

  const todayDenver = now.toLocaleDateString('en-CA', { timeZone: ORG_TZ })
  await generateMonthlyCycle(now, todayDenver.slice(0, 7), [familyId])

  const next = nextBillingMonth(now)
  const { data: marker } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', GENERATED_MARKER_KEY)
    .maybeSingle()
  const settings = await loadCycleSettings()
  const denverDay = Number(todayDenver.slice(8, 10))
  if (marker?.value === next.period || denverDay >= settings.generateDay) {
    await generateMonthlyCycle(now, next.period.slice(0, 7), [familyId])
  }
}

export async function recomputeInvoiceTotals(invoiceId: string): Promise<number> {
  const { data: lines } = await supabase
    .from('tutoring_invoice_lines')
    .select('amount, kind')
    .eq('invoice_id', invoiceId)
  const subtotal = (lines ?? [])
    .filter((l) => l.kind === 'session' || l.kind === 'late_reschedule_fee')
    .reduce((s, l) => s + Number(l.amount), 0)
  const total = (lines ?? []).reduce((s, l) => s + Number(l.amount), 0)
  await supabase
    .from('tutoring_invoices')
    .update({ subtotal: Number(subtotal.toFixed(2)), total: Number(total.toFixed(2)), updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
  return Number(total.toFixed(2))
}

// ---------------------------------------------------------------------------
// Confirm / request changes (spec §6.2–6.3)
// ---------------------------------------------------------------------------
// PL-62: after a family moves/drops a proposed session on the proposal page,
// the invoice's generated session lines are rebuilt with the same rules the
// monthly cycle uses (package draw-down included) — manual adjustment/credit
// and carried late-fee lines stay untouched — and the totals recompute.
// ---------------------------------------------------------------------------

export async function rebuildProposalInvoice(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: invoice } = await supabase
    .from('tutoring_invoices')
    .select('id, family_id, period, status')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { ok: false, error: 'Unknown invoice.' }
  if (!['draft', 'proposed'].includes(invoice.status)) {
    return { ok: false, error: 'This month is already confirmed.' }
  }
  const month = billingMonth(String(invoice.period).slice(0, 7))
  const engagements = (await loadActiveEngagements()).filter(
    (e) => e.family?.id === invoice.family_id && e.student && e.subject
  )

  await supabase
    .from('tutoring_invoice_lines')
    .delete()
    .eq('invoice_id', invoice.id)
    .eq('kind', 'session')

  const lines: Record<string, unknown>[] = []
  for (const eng of engagements) {
    const tz = eng.tutor?.timezone ?? ORG_TZ
    const { fromIso, toIso } = engagementPeriodBounds(month, tz)
    const { data: engSessions } = await supabase
      .from('tutoring_sessions')
      .select('id, starts_at, duration_minutes')
      .eq('engagement_id', eng.id)
      .gte('starts_at', fromIso)
      .lt('starts_at', toIso)
      .in('status', ['proposed', 'confirmed'])
      .order('starts_at')

    let remaining = Infinity
    if (eng.funding === 'package' && eng.addon_id) {
      const { data: addon } = await supabase
        .from('enrollment_addons')
        .select('hours')
        .eq('id', eng.addon_id)
        .maybeSingle()
      remaining = Math.max(0, Number(addon?.hours ?? 0) - (await packageHoursUsedBefore(eng.id, fromIso)))
    }

    for (const s of engSessions ?? []) {
      const hours = s.duration_minutes / 60
      if (eng.funding === 'package' && remaining >= hours) {
        remaining -= hours
        continue
      }
      remaining = eng.funding === 'package' ? 0 : remaining
      const when = new Date(s.starts_at).toLocaleDateString('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
      })
      lines.push({
        invoice_id: invoice.id,
        session_id: s.id,
        description: `${eng.student!.first_name} — ${eng.subject!.name} with ${eng.tutor?.name ?? 'tutor'}, ${when}`,
        qty_hours: hours,
        rate: eng.hourly_rate,
        amount: Number((hours * eng.hourly_rate).toFixed(2)),
        kind: 'session',
      })
    }
  }
  if (lines.length > 0) {
    const { error } = await supabase.from('tutoring_invoice_lines').insert(lines)
    if (error) return { ok: false, error: error.message }
  }
  await recomputeInvoiceTotals(invoice.id)
  return { ok: true }
}

export async function confirmInvoice(
  invoiceId: string,
  source: 'parent' | 'auto' | 'staff'
): Promise<{ ok: boolean; error?: string }> {
  const { data: invoice } = await supabase
    .from('tutoring_invoices')
    .select('id, family_id, period, status')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { ok: false, error: 'Unknown invoice.' }
  if (!['draft', 'proposed'].includes(invoice.status)) return { ok: true } // already confirmed+ — idempotent

  // Flip the family's proposed sessions in the billed month → confirmed, and
  // push each to Google (§6.3). Bounds are per-engagement on the tutor's wall
  // clock — the same window generation used — so a consecutive month's
  // proposals (e.g. a change request that lingered past the next generation
  // day) are never flipped early.
  const m = billingMonth(String(invoice.period).slice(0, 7))
  const { data: familyEngagements } = await supabase
    .from('tutoring_engagements')
    .select('id, students!inner ( family_id ), instructors ( timezone )')
    .eq('students.family_id', invoice.family_id)
  const familySessionIds: string[] = []
  for (const eng of (familyEngagements as any[]) ?? []) {
    const tz = one<any>(eng.instructors)?.timezone ?? ORG_TZ
    const { fromIso, toIso } = engagementPeriodBounds(m, tz)
    const { data: proposed } = await supabase
      .from('tutoring_sessions')
      .select('id')
      .eq('engagement_id', eng.id)
      .eq('status', 'proposed')
      .gte('starts_at', fromIso)
      .lt('starts_at', toIso)
    for (const s of proposed ?? []) familySessionIds.push(s.id)
  }

  if (familySessionIds.length > 0) {
    await supabase
      .from('tutoring_sessions')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .in('id', familySessionIds)
    for (const id of familySessionIds) await enqueueGcalSync(id, `proposal confirmed (${source})`)
  }

  await supabase
    .from('tutoring_invoices')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      auto_confirmed: source === 'auto',
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .in('status', ['draft', 'proposed'])

  // Payment leg is deliberately decoupled: a Stripe hiccup must never lose a
  // confirmation. The daily payment sweep picks up confirmed-but-unbilled
  // invoices; the caller can also trigger it immediately.
  return { ok: true }
}

export async function requestChanges(invoiceId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const { data: invoice } = await supabase
    .from('tutoring_invoices')
    .select('id, period, status, change_request_note, families ( parent_first_name, parent_last_name, parent_email )')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { ok: false, error: 'Unknown invoice.' }
  const fam: any = one(invoice.families)
  const stamped = `[${new Date().toISOString().slice(0, 16).replace('T', ' ')}] ${note.trim()}`
  await supabase
    .from('tutoring_invoices')
    .update({
      change_request_note: invoice.change_request_note ? `${invoice.change_request_note}\n${stamped}` : stamped,
      change_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
  await sendAdminAlert({
    dedupeKey: `t1_change_request:${invoiceId}:${Date.now()}`,
    adminEmail: ADMIN_EMAIL,
    subject: `Tutoring schedule change requested — ${fam?.parent_first_name ?? ''} ${fam?.parent_last_name ?? ''}`,
    body: `<p><strong>${fam?.parent_first_name ?? ''} ${fam?.parent_last_name ?? ''}</strong>
      (${fam?.parent_email ?? 'unknown'}) asked for changes to the ${billingMonth(String(invoice.period).slice(0, 7)).label}
      schedule:</p><blockquote style="border-left:3px solid #cbd5e1;margin:8px 0;padding:4px 12px;color:#334155">${note
        .trim()
        .replace(/</g, '&lt;')}</blockquote>
      <p>Edit the sessions on
      <a href="${appUrl()}/admin/tutoring?invoice=${invoiceId}" style="color:#00AEEE">the tutoring page</a>
      (this month's invoice row opens highlighted) — the proposal page and invoice update automatically.
      The month stays unconfirmed until they confirm or the auto-confirm window closes (it pauses
      while a change request is open).</p>`,
  }).catch((e) => console.error('change-request alert failed:', e))
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Daily proposal sweeps (nudge +2d, auto-confirm +5d; §6.3)
// ---------------------------------------------------------------------------

export type ProposalSweepResult = { nudged: number; autoConfirmed: number }

export async function sweepProposals(now: Date = new Date()): Promise<ProposalSweepResult> {
  const result: ProposalSweepResult = { nudged: 0, autoConfirmed: 0 }
  const settings = await loadCycleSettings()
  const contact = await loadContactInfo()
  const { data: open } = await supabase
    .from('tutoring_invoices')
    .select(
      `id, period, proposal_sent_at, nudge_sent_at, change_requested_at, total,
       families ( parent_email, billing_email, billing_cc_emails, parent_first_name )`
    )
    .eq('status', 'proposed')
    .not('proposal_sent_at', 'is', null)

  for (const inv of (open as any[]) ?? []) {
    const fam = one<any>(inv.families)
    if (!fam) continue
    const sentAt = new Date(inv.proposal_sent_at).getTime()
    const ageDays = (now.getTime() - sentAt) / 86_400_000
    const month = billingMonth(String(inv.period).slice(0, 7))
    const link = `${appUrl()}/tutoring/schedule/${proposalToken(inv.id)}`

    // An open change request pauses the clock — the Ops Director resolves it
    // and the family confirms the edited schedule (§6.2).
    if (inv.change_requested_at) continue

    if (ageDays >= settings.autoconfirmDays) {
      const res = await confirmInvoice(inv.id, 'auto')
      if (res.ok) {
        result.autoConfirmed++
        await after7cConfirm(inv.id)
      }
      continue
    }

    if (ageDays >= settings.nudgeDays && !inv.nudge_sent_at) {
      // Student names for the subject line, from the invoice's session lines.
      const { data: lineStudents } = await supabase
        .from('tutoring_invoice_lines')
        .select('tutoring_sessions ( students ( first_name ) )')
        .eq('invoice_id', inv.id)
        .eq('kind', 'session')
      const names = [
        ...new Set(
          ((lineStudents as any[]) ?? [])
            .map((l) => one<any>(one<any>(l.tutoring_sessions)?.students)?.first_name)
            .filter(Boolean)
        ),
      ].join(' & ')
      const t1bOpts = {
        monthLabel: month.label,
        names: names || null,
        link,
        daysLeft: Math.max(1, Math.ceil(settings.autoconfirmDays - ageDays)),
        contact,
      }
      // PL-13: registry template when live; code copy otherwise.
      const email = await renderRegistered(
        'T1B_PROPOSAL_NUDGE',
        { parentFirstName: fam.parent_first_name ?? 'there', parentEmail: fam.parent_email },
        {
          tutoringMonthLabel: month.label,
          studentNames: names || 'your student',
          confirmLink: link,
          daysLeft: t1bOpts.daysLeft,
          contactBlock: contactBlockHtml(contact),
        },
        () => t1bNudgeEmail(t1bOpts)
      )
      const sent = await sendOnce({
        dedupeKey: `t1b_nudge:${inv.id}`,
        emailType: 'T1B_PROPOSAL_NUDGE',
        to: [fam.billing_email ?? fam.parent_email],
        cc: fam.billing_cc_emails?.length ? fam.billing_cc_emails : undefined,
        subject: email.subject,
        html: email.html,
      })
      if (sent === 'sent') {
        result.nudged++
        await supabase
          .from('tutoring_invoices')
          .update({ nudge_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', inv.id)
      }
    }
  }
  return result
}

/** Hook the payment leg registers to avoid an import cycle (tutoring-stripe
 *  sets this to issueOrCharge). */
let confirmFollowUp: ((invoiceId: string) => Promise<unknown>) | null = null
export function registerConfirmFollowUp(fn: (invoiceId: string) => Promise<unknown>) {
  confirmFollowUp = fn
}

/**
 * Post-confirm work: Google push + hand-off to collection. Returns a promise
 * on purpose — `after()` callbacks must RETURN their promises or the lambda
 * freezes before the work completes (floating promises silently die).
 */
export async function after7cConfirm(invoiceId: string): Promise<void> {
  const jobs: Promise<unknown>[] = [
    processGcalQueue().catch((e) => console.error('gcal drain after confirm failed:', e)),
  ]
  if (confirmFollowUp) {
    jobs.push(confirmFollowUp(invoiceId).catch((e) => console.error('confirm follow-up failed:', e)))
  }
  await Promise.allSettled(jobs)
}
/* eslint-enable @typescript-eslint/no-explicit-any */
