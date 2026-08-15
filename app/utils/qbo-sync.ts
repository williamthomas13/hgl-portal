import { emailBaseUrl } from './base-url'
import { supabaseAdmin as supabase } from './supabase-admin'
import {
  QboApiError,
  createRefundReceipt,
  createSalesReceipt,
  createTimeActivity,
  findOrCreateCustomer,
  loadConnection,
  loadItemMap,
  qboQuery,
  type ItemMap,
  type ReceiptLine,
} from './qbo'
import { sendAdminAlert } from './email'
import { stripeDashboardUrl } from './checkout-paid'
import { ADMIN_EMAIL, DEFAULT_TIMEZONE, localDate } from './lifecycle'
import { CLASS_WORK_TYPE, DEFAULT_TUTORING_WORK_TYPE, hoursByWorkType, sessionMinutes } from './work-types'

// Phase 6 sync worker (spec §4/§5): drains pending qbo_sync_log rows into QBO
// Sales/Refund Receipts. Runs from two places — an after() trigger right
// behind the Stripe webhook (fast path) and the hourly sweep (retry/backup).
// Concurrency is safe: each row is claimed with a conditional attempts bump
// before any QBO call, so overlapping runs never double-post a receipt.

const MAX_ATTEMPTS = 5

// PL-281: a configuration problem retrying can never fix (unmatched
// employee, salaried card in the queue). The worker fails the row and alerts
// IMMEDIATELY instead of burning two hours of backoff on it.
export class PermanentSyncError extends Error {}

type SyncRow = {
  id: string
  enrollment_id: string | null // null for tutoring rows (Phase 7c)
  enrollment_addon_id: string | null
  tutoring_invoice_id: string | null
  timecard_id: string | null // PL-281: timecard → TimeActivity rows
  stripe_payment_intent_id: string | null // null for timecard rows
  kind: 'sale' | 'refund' | 'tutoring_sale' | 'timecard_time'
  amount: number | null
  attempts: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */

type EnrollmentDetail = {
  id: string
  amount_paid: number | null
  /** PL-142: the class component ACTUALLY PAID, frozen at payment. Null only
   *  on rows that predate the snapshot columns — those fall back to the live
   *  class price, which is exactly the drift this replaces. */
  class_price_paid: number | null
  paid_at: string | null
  stripe_session_id: string | null
  classes: {
    class_type: string
    price: number
    schools: { name: string; nickname: string; timezone: string | null } | null
  } | null
  students: {
    first_name: string
    last_name: string
    families: {
      id: string
      parent_first_name: string
      parent_last_name: string | null
      parent_email: string
      qbo_customer_id: string | null
    } | null
  } | null
  enrollment_addons: {
    id: string
    hours: number
    price_paid: number
    stripe_session_id: string | null
    stripe_payment_intent_id: string | null
    tutoring_packages: { name: string } | { name: string }[] | null
  }[]
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/**
 * PL-142: the class amount a receipt (or refund split) may quote. Reading the
 * class's CURRENT price here posted wrong amounts whenever a price changed
 * between payment and sync — silently short, or a phantom "promo discount"
 * once the receipt stopped balancing — and it broke refund matching, which
 * compares the refunded amount against component prices.
 */
function classPricePaid(detail: EnrollmentDetail): number {
  return Number(detail.class_price_paid ?? detail.classes?.price ?? 0)
}

async function loadEnrollmentDetail(enrollmentId: string): Promise<EnrollmentDetail | null> {
  const { data, error } = await supabase
    .from('enrollments')
    .select(
      `
      id, amount_paid, class_price_paid, paid_at, stripe_session_id,
      classes ( class_type, price, schools ( name, nickname, timezone ) ),
      students ( first_name, last_name,
        families ( id, parent_first_name, parent_last_name, parent_email, qbo_customer_id ) ),
      enrollment_addons ( id, hours, price_paid, stripe_session_id, stripe_payment_intent_id, tutoring_packages ( name ) )
    `
    )
    .eq('id', enrollmentId)
    .single()
  if (error || !data) {
    console.error(`QBO sync: enrollment ${enrollmentId} load failed:`, error?.message)
    return null
  }
  const raw = data as any
  return {
    ...raw,
    classes: one(raw.classes),
    students: raw.students
      ? { ...one<any>(raw.students), families: one<any>(one<any>(raw.students)?.families) }
      : null,
  } as EnrollmentDetail
}

const cents = (n: number) => Math.round(n * 100)

function addonName(a: EnrollmentDetail['enrollment_addons'][number]) {
  return one(a.tutoring_packages)?.name ?? 'Tutoring package'
}

/**
 * Deterministic DocNumber from the payment intent (belt-and-braces
 * idempotency): if a previous run created the receipt but crashed before
 * marking the row synced, the pre-create lookup finds it by DocNumber and
 * adopts it instead of double-posting. QBO companies with auto-numbering
 * ignore the field — then the lookup finds nothing and we rely on the row
 * claim, which already covers everything but a mid-call crash.
 */
function docNumberFor(kind: 'sale' | 'refund', paymentIntentId: string) {
  const tail = paymentIntentId.replace(/^pi_/, '')
  return (kind === 'refund' ? `R${tail}` : tail).slice(0, 21)
}

async function findExistingDoc(kind: 'sale' | 'refund', docNumber: string) {
  const entity = kind === 'sale' ? 'SalesReceipt' : 'RefundReceipt'
  const qr = await qboQuery(`select Id, DocNumber from ${entity} where DocNumber = '${docNumber}'`)
  const found = (qr[entity] ?? [])[0]
  return found ? { id: String(found.Id), docNumber: found.DocNumber ?? null } : null
}

/* eslint-enable @typescript-eslint/no-explicit-any */

async function customerIdFor(detail: EnrollmentDetail): Promise<string> {
  const family = detail.students?.families
  if (!family) throw new Error('enrollment has no family row')
  if (family.qbo_customer_id) return family.qbo_customer_id
  const id = await findOrCreateCustomer({
    parentFirstName: family.parent_first_name,
    parentLastName: family.parent_last_name ?? '',
    parentEmail: family.parent_email,
  })
  await supabase.from('families').update({ qbo_customer_id: id }).eq('id', family.id)
  return id
}

function privateNote(row: SyncRow, extra?: string) {
  const base = emailBaseUrl()
  // PL-361: offline payments (check/bank recorded by staff) carry a
  // synthetic reference, not a Stripe PaymentIntent — say so honestly.
  const ref = row.stripe_payment_intent_id?.startsWith('offline_')
    ? `Offline payment recorded in the portal (ref ${row.stripe_payment_intent_id})`
    : `Stripe PaymentIntent ${row.stripe_payment_intent_id}`
  return [
    ref,
    `Portal enrollment ${base}/admin (id ${row.enrollment_id})`,
    ...(extra ? [extra] : []),
  ].join(' · ')
}

/**
 * Build the receipt for one row. Returns null with a reason when the row can
 * never sync (bad data) — those go straight to failed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 7c: a paid tutoring invoice becomes a Sales Receipt with lines split
 * by subject category — test-prep tutoring posts to the 408-1 Item, subject
 * tutoring to 401 (spec §6.4). Credits/negative lines aggregate into the
 * receipt's discount so the document equals the money that moved.
 */
async function syncTutoringRow(row: SyncRow, items: ItemMap): Promise<{ id: string; docNumber: string | null }> {
  if (!row.tutoring_invoice_id) throw new Error('tutoring row has no invoice id')
  const { data: invoice } = await supabase
    .from('tutoring_invoices')
    .select(
      `id, period, total, paid_at,
       families ( id, parent_first_name, parent_last_name, parent_email, qbo_customer_id ),
       tutoring_invoice_lines ( description, amount, kind, session_id,
         tutoring_sessions ( tutoring_engagements ( subjects ( category ) ) ) )`
    )
    .eq('id', row.tutoring_invoice_id)
    .maybeSingle()
  if (!invoice) throw new Error('tutoring invoice no longer loadable')

  const testPrepItem = items.tutoring_test_prep
  const subjectItem = items.tutoring_subject
  const depositAccount = items.deposit_account
  if (!testPrepItem || !subjectItem || !depositAccount) {
    throw new Error('tutoring item mapping incomplete (map tutoring_test_prep + tutoring_subject in the QuickBooks panel)')
  }

  if (!row.stripe_payment_intent_id) throw new Error('tutoring row has no payment intent')
  const docNumber = docNumberFor('sale', row.stripe_payment_intent_id)
  const existing = await findExistingDoc('sale', docNumber)
  if (existing) return existing

  const family = one<any>(invoice.families)
  if (!family) throw new Error('tutoring invoice has no family row')
  let customerId = family.qbo_customer_id as string | null
  if (!customerId) {
    customerId = await findOrCreateCustomer({
      parentFirstName: family.parent_first_name,
      parentLastName: family.parent_last_name ?? '',
      parentEmail: family.parent_email,
    })
    await supabase.from('families').update({ qbo_customer_id: customerId }).eq('id', family.id)
  }

  const lines: ReceiptLine[] = []
  let credits = 0
  for (const line of (invoice.tutoring_invoice_lines as any[]) ?? []) {
    const amount = Number(line.amount)
    if (amount < 0) {
      credits += -amount // discounts/credits reduce the receipt total
      continue
    }
    const category = one<any>(one<any>(one<any>(line.tutoring_sessions)?.tutoring_engagements)?.subjects)?.category
    lines.push({
      amount,
      itemRef: category === 'test_prep' ? testPrepItem : subjectItem,
      description: line.description,
    })
  }
  if (lines.length === 0) throw new Error('tutoring invoice has no positive lines')

  const monthTag = String(invoice.period).slice(0, 7)
  return createSalesReceipt({
    customerId,
    lines,
    discount: Number(credits.toFixed(2)),
    txnDate: localDate(DEFAULT_TIMEZONE, invoice.paid_at ? new Date(invoice.paid_at) : new Date()),
    depositAccount,
    privateNote: [
      `Stripe PaymentIntent ${row.stripe_payment_intent_id}`,
      `HGL tutoring invoice ${monthTag} (id ${invoice.id})`,
      ...(credits > 0 ? [`Includes $${credits.toFixed(2)} in credits/adjustments`] : []),
    ].join(' · '),
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
// PL-281: one approved hourly timecard → ONE TimeActivity (total hours; the
// description carries the by-work-type breakdown the payroll summary shows,
// plus the timecard id for crash-recovery adoption — TimeActivity has no
// DocNumber, so provenance rides the description).
async function syncTimecardRow(row: SyncRow): Promise<{ id: string; docNumber: string | null }> {
  if (!row.timecard_id) throw new Error('timecard row has no timecard id')
  const { data: tc } = await supabase
    .from('timecards')
    .select(
      `id, tutor_id, period_start, period_end, status, total_hours,
       instructors ( name, email, pay_type, qbo_employee_id )`
    )
    .eq('id', row.timecard_id)
    .maybeSingle()
  if (!tc) throw new Error('timecard no longer loadable')
  const tutor: any = Array.isArray(tc.instructors) ? tc.instructors[0] : tc.instructors
  const tutorName = tutor?.name ?? tutor?.email ?? 'this tutor'
  // PL-212 rails, restated at the last gate: salaried hours are tracked for
  // records and NEVER pushed as payable time. The enqueue filters these out;
  // this guard survives a mapping edit between enqueue and drain.
  if (tutor?.pay_type === 'salaried') {
    throw new PermanentSyncError(
      `${tutorName} is salaried — salaried tutors' hours are tracked for records and never pushed to QuickBooks as hourly time.`
    )
  }
  if (!tutor?.qbo_employee_id) {
    throw new PermanentSyncError(
      `${tutorName} isn't matched to a QuickBooks employee yet. Open Settings → QuickBooks → Employee matching, pick their QBO employee, then retry this row. (The portal never creates QBO employees.)`
    )
  }
  // 'approved' is the normal case; 'exported' covers a crash after the
  // status flip on a retryable path. Anything else means the card was
  // reopened after the push was queued — stop and say so.
  if (tc.status !== 'approved' && tc.status !== 'exported') {
    throw new PermanentSyncError(
      `This timecard is no longer approved (it reads "${tc.status}") — it was reopened after the push was queued. Re-approve it and push again.`
    )
  }

  // Crash-recovery idempotency: adopt a TimeActivity a previous attempt
  // created (marker = the timecard id in the description).
  const marker = `HGL timecard ${tc.id}`
  const existingQ = await qboQuery(
    `select Id, Description from TimeActivity where TxnDate = '${tc.period_end}' maxresults 1000`
  )
  const existing = (existingQ.TimeActivity ?? []).find((t: any) =>
    String(t.Description ?? '').includes(marker)
  )
  if (existing) return { id: String(existing.Id), docNumber: null }

  // By-work-type breakdown from the card's stamped sessions — the same
  // numbers the payroll-summary clipboard shows.
  const [{ data: tSessions }, { data: cSessions }] = await Promise.all([
    supabase.from('tutoring_sessions').select('duration_minutes, work_type').eq('timecard_id', tc.id),
    supabase.from('sessions').select('start_time, end_time').eq('timecard_id', tc.id),
  ])
  const breakdown = hoursByWorkType([
    ...((tSessions as any[]) ?? []).map((s) => ({
      workType: s.work_type ?? DEFAULT_TUTORING_WORK_TYPE,
      hours: Number(s.duration_minutes ?? 0) / 60,
    })),
    ...((cSessions as any[]) ?? []).map((s) => ({
      workType: CLASS_WORK_TYPE,
      hours: sessionMinutes(s.start_time, s.end_time) / 60,
    })),
  ])
  const breakdownText = breakdown.map((b) => `${b.workType} ${b.hours.toFixed(2)}h`).join(' · ')

  const created = await createTimeActivity({
    employeeId: tutor.qbo_employee_id,
    txnDate: tc.period_end,
    hours: Number(tc.total_hours),
    description: `HGL hours ${tc.period_start} to ${tc.period_end}: ${Number(tc.total_hours).toFixed(2)} total${breakdownText ? ` (${breakdownText})` : ''} · ${marker}`,
  })
  // Pushed to payroll = the same milestone the CSV click marks. Guarded so a
  // card already exported (via CSV, or a prior attempt) just stays exported.
  await supabase
    .from('timecards')
    .update({ status: 'exported', updated_at: new Date().toISOString() })
    .eq('id', tc.id)
    .eq('status', 'approved')
  return { id: created.id, docNumber: null }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function syncRow(row: SyncRow, items: ItemMap): Promise<{ id: string; docNumber: string | null }> {
  if (row.kind === 'timecard_time') return syncTimecardRow(row)
  if (row.kind === 'tutoring_sale') return syncTutoringRow(row, items)
  if (!row.enrollment_id) throw new Error('class row has no enrollment id')
  const detail = await loadEnrollmentDetail(row.enrollment_id)
  if (!detail || !detail.classes) throw new Error('enrollment/class no longer loadable')
  const classItem = items.group_class
  const tutoringItem = items.tutoring_addon
  const depositAccount = items.deposit_account
  if (!classItem || !depositAccount) throw new Error('item mapping incomplete')

  const school = detail.classes.schools
  const tz = school?.timezone ?? DEFAULT_TIMEZONE
  const student = `${detail.students?.first_name ?? ''} ${detail.students?.last_name ?? ''}`.trim()
  const classLabel = `${school?.nickname ?? 'HGL'} ${detail.classes.class_type}`
  if (!row.stripe_payment_intent_id) throw new Error('payment row has no payment intent')
  const docNumber = docNumberFor(row.kind, row.stripe_payment_intent_id)

  // Crash-recovery idempotency: adopt a receipt a previous attempt created.
  const existing = await findExistingDoc(row.kind, docNumber)
  if (existing) return existing

  const customerId = await customerIdFor(detail)

  if (row.kind === 'sale') {
    const lines: ReceiptLine[] = []
    if (row.enrollment_addon_id) {
      // Addon-only purchase (#9 upsell): its own checkout, its own receipt.
      const addon = detail.enrollment_addons.find((a) => a.id === row.enrollment_addon_id)
      if (!addon) throw new Error(`addon ${row.enrollment_addon_id} not found on enrollment`)
      if (!tutoringItem) throw new Error('item mapping incomplete')
      lines.push({
        amount: Number(addon.price_paid),
        itemRef: tutoringItem,
        description: `${addonName(addon)} (${Number(addon.hours)}h 1-on-1 tutoring) — ${student}`,
      })
    } else {
      lines.push({
        amount: classPricePaid(detail),
        itemRef: classItem,
        description: `${classLabel} — ${student}`,
      })
      // In-checkout add-ons share the enrollment's checkout session; add-ons
      // bought later through the upsell page carry their own session id and
      // sync as their own sale rows.
      for (const a of detail.enrollment_addons) {
        if (!a.stripe_session_id || a.stripe_session_id !== detail.stripe_session_id) continue
        if (!tutoringItem) throw new Error('item mapping incomplete')
        lines.push({
          amount: Number(a.price_paid),
          itemRef: tutoringItem,
          description: `${addonName(a)} (${Number(a.hours)}h 1-on-1 tutoring) — ${student}`,
        })
      }
    }

    // Promo codes make the charged total smaller than the line prices; a
    // discount line keeps the receipt equal to the money that moved.
    const charged = row.amount ?? detail.amount_paid
    const lineSum = lines.reduce((s, l) => s + l.amount, 0)
    const discount =
      charged != null && cents(charged) < cents(lineSum) ? Number((lineSum - charged).toFixed(2)) : 0

    return createSalesReceipt({
      customerId,
      lines,
      discount,
      txnDate: localDate(tz, detail.paid_at ? new Date(detail.paid_at) : new Date()),
      depositAccount,
      privateNote: privateNote(row, discount > 0 ? `Promo discount $${discount.toFixed(2)}` : undefined),
    })
  }

  // kind === 'refund' — split lines per refunded component (spec §5).
  const refunded = Number(row.amount ?? 0)
  if (refunded <= 0) throw new Error('refund row has no amount')

  // Add-on-only payment refunded (matched by the PI stamped on the addon row
  // by the webhook): the whole amount belongs on the tutoring item.
  const addonOnly = detail.enrollment_addons.find(
    (a) => a.stripe_payment_intent_id === row.stripe_payment_intent_id
  )

  const classPrice = classPricePaid(detail)
  const inCheckoutAddons = detail.enrollment_addons.filter(
    (a) => a.stripe_session_id && a.stripe_session_id === detail.stripe_session_id
  )
  const addonSum = inCheckoutAddons.reduce((s, a) => s + Number(a.price_paid), 0)

  const lines: ReceiptLine[] = []
  let reviewNote: string | undefined
  if (addonOnly) {
    if (!tutoringItem) throw new Error('item mapping incomplete')
    lines.push({
      amount: refunded,
      itemRef: tutoringItem,
      description: `Refund — ${addonName(addonOnly)} (${Number(addonOnly.hours)}h) — ${student}`,
    })
  } else if (cents(refunded) === cents(classPrice)) {
    lines.push({ amount: classPrice, itemRef: classItem, description: `Refund — ${classLabel} — ${student}` })
  } else if (addonSum > 0 && cents(refunded) === cents(addonSum) && tutoringItem) {
    for (const a of inCheckoutAddons) {
      lines.push({
        amount: Number(a.price_paid),
        itemRef: tutoringItem,
        description: `Refund — ${addonName(a)} (${Number(a.hours)}h) — ${student}`,
      })
    }
  } else if (addonSum > 0 && cents(refunded) === cents(classPrice + addonSum) && tutoringItem) {
    lines.push({ amount: classPrice, itemRef: classItem, description: `Refund — ${classLabel} — ${student}` })
    for (const a of inCheckoutAddons) {
      lines.push({
        amount: Number(a.price_paid),
        itemRef: tutoringItem,
        description: `Refund — ${addonName(a)} (${Number(a.hours)}h) — ${student}`,
      })
    }
  } else {
    // Any other partial amount: single line against the class item, flagged
    // for the bookkeeper (spec §5 attribution rule).
    lines.push({ amount: refunded, itemRef: classItem, description: `Partial refund — ${classLabel} — ${student}` })
    reviewNote = `⚠ Partial refund of $${refunded.toFixed(2)} does not match class ($${classPrice.toFixed(
      2
    )}) or add-on ($${addonSum.toFixed(2)}) prices — review the split`
  }

  return createRefundReceipt({
    customerId,
    lines,
    txnDate: localDate(tz),
    depositAccount,
    privateNote: privateNote(row, reviewNote),
  })
}

export type QboQueueResult = {
  synced: number
  failed: number
  deferred: number
  paused: boolean
}

/**
 * Drain the queue. Never throws — QBO problems must not take down the webhook
 * or the sweep. Returns counts for the sweep's action counters.
 */
export async function processQboQueue(): Promise<QboQueueResult> {
  const result: QboQueueResult = { synced: 0, failed: 0, deferred: 0, paused: false }
  try {
    const conn = await loadConnection()
    if (!conn || conn.status !== 'connected') {
      // Not connected / expired: rows stay pending and drain on reconnect
      // (spec §6). The sweep owns the daily "reconnect me" alert.
      result.paused = true
      return result
    }

    const { data: rows } = await supabase
      .from('qbo_sync_log')
      .select('id, enrollment_id, enrollment_addon_id, tutoring_invoice_id, timecard_id, stripe_payment_intent_id, kind, amount, attempts')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .order('created_at')
      .limit(25)
    if (!rows || rows.length === 0) return result

    const items = await loadItemMap()

    for (const row of rows as SyncRow[]) {
      // Claim: conditional attempts bump. A concurrent run (after()-trigger
      // racing the sweep) loses the claim and skips the row.
      const backoffMinutes = 5 * 2 ** row.attempts
      const { data: claimed } = await supabase
        .from('qbo_sync_log')
        .update({
          attempts: row.attempts + 1,
          next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'pending')
        .eq('attempts', row.attempts)
        .select('id')
      if (!claimed || claimed.length === 0) continue

      try {
        const doc = await syncRow(row, items)
        await supabase
          .from('qbo_sync_log')
          .update({
            status: 'synced',
            qbo_doc_id: doc.id,
            qbo_doc_number: doc.docNumber,
            synced_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', row.id)
        result.synced++
      } catch (e) {
        if (e instanceof QboApiError && e.status === 0) {
          // Connection dropped mid-run (refresh failed): pause everything.
          result.paused = true
          break
        }
        const message = e instanceof Error ? e.message : String(e)
        console.error(`QBO sync failed for row ${row.id} (attempt ${row.attempts + 1}):`, message)
        // PL-281: a PermanentSyncError is a configuration problem — retrying
        // can't fix it, so fail loud NOW instead of after 2h of backoff.
        const exhausted = e instanceof PermanentSyncError || row.attempts + 1 >= MAX_ATTEMPTS
        await supabase
          .from('qbo_sync_log')
          .update({ last_error: message.slice(0, 1000), ...(exhausted ? { status: 'failed' } : {}) })
          .eq('id', row.id)
        if (exhausted) {
          result.failed++
          const alertBody =
            row.kind === 'timecard_time'
              ? `<p>The timecard push to QuickBooks <strong>did not go through</strong> — no time was recorded, nothing was silently skipped.</p>
              <p>Why: ${message.slice(0, 500)}</p>
              <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?qbo=${row.id}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fix &amp; retry this sync</a></p>
              <p><a href="${emailBaseUrl()}/admin/tutoring" style="color:#00AEEE">The timecards panel</a> — the card stays approved (not exported) until the push lands or you export the CSV instead.</p>`
              : `<p>After ${MAX_ATTEMPTS} attempts, the ${row.kind === 'refund' ? 'Refund Receipt' : 'Sales Receipt'}
              for Stripe payment <code>${row.stripe_payment_intent_id}</code>
              (${row.tutoring_invoice_id ? `tutoring invoice <code>${row.tutoring_invoice_id}</code>` : `enrollment <code>${row.enrollment_id}</code>`})
              could not be created in QuickBooks.</p>
              <p>Last error: <code>${message.slice(0, 500)}</code></p>
              <p>The books are missing this transaction until it's fixed and retried.</p>
              <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?qbo=${row.id}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fix &amp; retry this sync</a></p>
              <p><a href="${stripeDashboardUrl(`payments/${row.stripe_payment_intent_id}`)}" style="color:#00AEEE">The Stripe payment</a>${
                row.enrollment_id
                  ? ` · <a href="${emailBaseUrl()}/admin/communications?enrollment=${row.enrollment_id}" style="color:#00AEEE">the enrollment record</a>`
                  : row.tutoring_invoice_id
                    ? ` · <a href="${emailBaseUrl()}/admin/tutoring?invoice=${row.tutoring_invoice_id}" style="color:#00AEEE">the invoice</a>`
                    : ''
              }</p>`
          await sendAdminAlert({
            dedupeKey: `qbo_sync_failed:${row.id}`,
            adminEmail: ADMIN_EMAIL,
            templateKey: 'AL_QBO_FAILURE',
            subject:
              row.kind === 'timecard_time'
                ? `QuickBooks payroll push FAILED — a timecard didn't land`
                : `QuickBooks sync FAILED — ${row.kind} for payment ${row.stripe_payment_intent_id}`,
            // PL-92: deep-link THIS failed row with its Retry control in
            // view — never the panel root. Error text stays verbatim.
            body: alertBody,
            enrollmentId: row.enrollment_id ?? undefined,
          }).catch((err) => console.error('QBO failure alert failed:', err))
        } else {
          result.deferred++
        }
      }
    }
    return result
  } catch (e) {
    console.error('processQboQueue crashed:', e)
    return result
  }
}

/**
 * PL-143: paid-but-never-enqueued reconciliation. The enqueue happens AFTER
 * the paid marker, so a failure in that window (a DB blip, a lambda dying
 * mid-defer) left the payment permanently invisible to QuickBooks — nothing
 * retried, nothing alerted, and the receipt simply never existed. This sweep
 * is the net: money that landed more than two hours ago with no queue row at
 * all gets one. The two-hour floor keeps it clear of the normal path,
 * including webhook retries and a slow first drain.
 *
 * Returns the number of rows enqueued — the PL-136 health card counts it.
 */
export async function sweepUnsyncedPayments(): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 3600_000).toISOString()
  let enqueued = 0

  // --- Class enrollments (and their in-checkout add-ons ride the same PI) ---
  const { data: paidEnrollments } = await supabase
    .from('enrollments')
    .select('id, stripe_payment_intent_id, amount_paid, paid_at')
    .in('payment_status', ['Paid', 'Completed'])
    .not('stripe_payment_intent_id', 'is', null)
    .lt('paid_at', cutoff)
    .order('paid_at', { ascending: false })
    .limit(500)
  for (const e of paidEnrollments ?? []) {
    const { count } = await supabase
      .from('qbo_sync_log')
      .select('id', { count: 'exact', head: true })
      .eq('stripe_payment_intent_id', e.stripe_payment_intent_id)
      .eq('kind', 'sale')
    if ((count ?? 0) > 0) continue
    const { error } = await supabase.from('qbo_sync_log').insert({
      enrollment_id: e.id,
      stripe_payment_intent_id: e.stripe_payment_intent_id,
      kind: 'sale',
      amount: e.amount_paid,
    })
    if (error) {
      if (error.code !== '23505') {
        console.error(`[PL-143] re-enqueue failed for enrollment ${e.id}:`, error.message)
      }
      continue
    }
    console.log(`[PL-143] re-enqueued missing QBO sale for enrollment ${e.id}`)
    enqueued++
  }

  // --- Tutoring invoices ----------------------------------------------------
  const { data: paidInvoices } = await supabase
    .from('tutoring_invoices')
    .select('id, stripe_payment_intent_id, total, paid_at')
    .eq('status', 'paid')
    .not('stripe_payment_intent_id', 'is', null)
    .lt('paid_at', cutoff)
    .order('paid_at', { ascending: false })
    .limit(500)
  for (const inv of paidInvoices ?? []) {
    const { count } = await supabase
      .from('qbo_sync_log')
      .select('id', { count: 'exact', head: true })
      .eq('stripe_payment_intent_id', inv.stripe_payment_intent_id)
      .eq('kind', 'tutoring_sale')
    if ((count ?? 0) > 0) continue
    const { error } = await supabase.from('qbo_sync_log').insert({
      tutoring_invoice_id: inv.id,
      stripe_payment_intent_id: inv.stripe_payment_intent_id,
      kind: 'tutoring_sale',
      amount: inv.total,
    })
    if (error) {
      if (error.code !== '23505') {
        console.error(`[PL-143] re-enqueue failed for tutoring invoice ${inv.id}:`, error.message)
      }
      continue
    }
    console.log(`[PL-143] re-enqueued missing QBO sale for tutoring invoice ${inv.id}`)
    enqueued++
  }

  return enqueued
}

/**
 * Sweep-side health nag (spec §6): while the connection is expired, alert the
 * admin once a day until someone reconnects; unsynced rows are waiting.
 */
export async function sweepQboHealth(): Promise<'alerted' | null> {
  const conn = await loadConnection()
  if (!conn || conn.status !== 'expired') return null
  const { count } = await supabase
    .from('qbo_sync_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  const today = localDate(DEFAULT_TIMEZONE)
  const status = await sendAdminAlert({
    dedupeKey: `qbo_expired:${today}`,
    adminEmail: ADMIN_EMAIL,
    subject: 'QuickBooks connection expired — reconnect needed',
    body: `<p>The QuickBooks connection stopped working (revoked or past Intuit's ~100-day
      refresh window). <strong>${count ?? 0}</strong> payment record${count === 1 ? ' is' : 's are'}
      waiting to sync and will drain automatically once reconnected.</p>
      <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?qbo=reconnect" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Reconnect QuickBooks</a>
      — lands with the QuickBooks section open.</p>`,
  })
  return status === 'sent' ? 'alerted' : null
}
