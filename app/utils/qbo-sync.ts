import { supabaseAdmin as supabase } from './supabase-admin'
import {
  QboApiError,
  createRefundReceipt,
  createSalesReceipt,
  findOrCreateCustomer,
  loadConnection,
  loadItemMap,
  qboQuery,
  type ItemMap,
  type ReceiptLine,
} from './qbo'
import { sendAdminAlert } from './email'
import { ADMIN_EMAIL, DEFAULT_TIMEZONE, localDate } from './lifecycle'

// Phase 6 sync worker (spec §4/§5): drains pending qbo_sync_log rows into QBO
// Sales/Refund Receipts. Runs from two places — an after() trigger right
// behind the Stripe webhook (fast path) and the hourly sweep (retry/backup).
// Concurrency is safe: each row is claimed with a conditional attempts bump
// before any QBO call, so overlapping runs never double-post a receipt.

const MAX_ATTEMPTS = 5

type SyncRow = {
  id: string
  enrollment_id: string | null // null for tutoring rows (Phase 7c)
  enrollment_addon_id: string | null
  tutoring_invoice_id: string | null
  stripe_payment_intent_id: string
  kind: 'sale' | 'refund' | 'tutoring_sale'
  amount: number | null
  attempts: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */

type EnrollmentDetail = {
  id: string
  amount_paid: number | null
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

async function loadEnrollmentDetail(enrollmentId: string): Promise<EnrollmentDetail | null> {
  const { data, error } = await supabase
    .from('enrollments')
    .select(
      `
      id, amount_paid, paid_at, stripe_session_id,
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
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return [
    `Stripe PaymentIntent ${row.stripe_payment_intent_id}`,
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

async function syncRow(row: SyncRow, items: ItemMap): Promise<{ id: string; docNumber: string | null }> {
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
        amount: Number(detail.classes.price),
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

  const classPrice = Number(detail.classes.price)
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
      .select('id, enrollment_id, enrollment_addon_id, tutoring_invoice_id, stripe_payment_intent_id, kind, amount, attempts')
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
        const exhausted = row.attempts + 1 >= MAX_ATTEMPTS
        await supabase
          .from('qbo_sync_log')
          .update({ last_error: message.slice(0, 1000), ...(exhausted ? { status: 'failed' } : {}) })
          .eq('id', row.id)
        if (exhausted) {
          result.failed++
          await sendAdminAlert({
            dedupeKey: `qbo_sync_failed:${row.id}`,
            adminEmail: ADMIN_EMAIL,
            subject: `QuickBooks sync FAILED — ${row.kind} for payment ${row.stripe_payment_intent_id}`,
            body: `<p>After ${MAX_ATTEMPTS} attempts, the ${row.kind === 'refund' ? 'Refund Receipt' : 'Sales Receipt'}
              for Stripe payment <code>${row.stripe_payment_intent_id}</code>
              (${row.tutoring_invoice_id ? `tutoring invoice <code>${row.tutoring_invoice_id}</code>` : `enrollment <code>${row.enrollment_id}</code>`})
              could not be created in QuickBooks.</p>
              <p>Last error: <code>${message.slice(0, 500)}</code></p>
              <p>Fix the cause (see the QuickBooks panel on /admin), then hit Retry there —
              the books are missing this transaction until then.</p>`,
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
      <p>Reconnect from the QuickBooks panel at the bottom of /admin.</p>`,
  })
  return status === 'sent' ? 'alerted' : null
}
