import Stripe from 'stripe'
import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, sendAdminAlert } from './email'
import { ADMIN_EMAIL } from './lifecycle'
import { processQboQueue } from './qbo-sync'
import {
  autopayToken,
  billingMonth,
  currentMonthEnd,
  registerConfirmFollowUp,
} from './tutoring-billing'
import { contactBlockHtml, loadContactInfo, money as fmtMoney, t2InvoiceEmail, t4PaymentFailedEmail } from './tutoring-emails'
import { renderRegistered } from './comms-registered'

// Phase 7c payment leg (spec §6.4): Stripe is the single payment rail.
// Autopay families get an off-session PaymentIntent against the saved
// card/bank account (3 attempts over a week, then past-due + Ops alert);
// everyone else gets a Stripe Hosted Invoice with card + ACH Direct Debit
// enabled, sent to billing_email CC billing_cc_emails (the assistant-pays-
// mom-watches requirement, natively). Paid invoices enqueue the Phase 6 QBO
// queue as kind 'tutoring_sale'. All fail-soft: a Stripe error leaves the
// invoice 'confirmed' for the daily sweep to retry.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)
const MAX_CHARGE_ATTEMPTS = 3
const RETRY_GAP_DAYS = [0, 2, 3] // day 0, +2, +3 → "3 attempts over a week"

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

type FamilyBilling = {
  id: string
  parent_first_name: string
  parent_last_name: string | null
  parent_email: string
  billing_email: string | null
  billing_cc_emails: string[]
  autopay: boolean
  stripe_customer_id: string | null
  stripe_payment_method_id: string | null
}

async function loadInvoiceWithFamily(invoiceId: string) {
  const { data } = await supabase
    .from('tutoring_invoices')
    .select(
      `id, family_id, period, status, total, due_at, sent_at, charge_attempts, next_charge_at,
       stripe_invoice_id, stripe_payment_intent_id, stripe_hosted_invoice_url,
       reminder_sent_at, late_fee_flagged_at,
       families ( id, parent_first_name, parent_last_name, parent_email, billing_email,
                  billing_cc_emails, autopay, stripe_customer_id, stripe_payment_method_id )`
    )
    .eq('id', invoiceId)
    .maybeSingle()
  if (!data) return null
  return { ...data, family: one<any>(data.families) as FamilyBilling | null }
}

export async function ensureStripeCustomer(family: FamilyBilling): Promise<string> {
  if (family.stripe_customer_id) return family.stripe_customer_id
  const customer = await stripe.customers.create({
    email: (family.billing_email ?? family.parent_email).toLowerCase(),
    name: `${family.parent_first_name} ${family.parent_last_name ?? ''}`.trim(),
    metadata: { hgl_family_id: family.id },
  })
  await supabase.from('families').update({ stripe_customer_id: customer.id }).eq('id', family.id)
  return customer.id
}

const cents = (n: number) => Math.round(Number(n) * 100)
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function dueDateFor(now: Date = new Date()): { iso: string; label: string; unix: number } {
  // §10.4: due at month-end (of the month the invoice goes out). Stripe wants
  // a future instant — late sends (manual re-issues) fall back to +3 days.
  const monthEnd = currentMonthEnd(now)
  const at = new Date(monthEnd + 'T23:59:00-06:00') // Denver-ish end of day
  const floor = new Date(now.getTime() + 3 * 86_400_000)
  const due = at.getTime() > now.getTime() + 86_400_000 ? at : floor
  return {
    iso: due.toISOString(),
    label: due.toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric' }),
    unix: Math.floor(due.getTime() / 1000),
  }
}

/**
 * Move a confirmed invoice into collection: nothing due → paid; autopay →
 * off-session charge; otherwise → hosted Stripe invoice + T2. Idempotent —
 * re-entry on an already-invoiced row is a no-op.
 */
export async function issueOrCharge(invoiceId: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const inv = await loadInvoiceWithFamily(invoiceId)
  if (!inv || !inv.family) return { ok: false, error: 'invoice/family not loadable' }
  if (inv.status !== 'confirmed') return { ok: true, path: 'noop' }

  const total = Number(inv.total)
  if (total <= 0) {
    // Fully package-covered month: the confirmation IS the outcome (§6.1 —
    // no invoice while the balance covers it).
    await supabase
      .from('tutoring_invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('status', 'confirmed')
    return { ok: true, path: 'package_covered' }
  }

  try {
    if (inv.family.autopay && inv.family.stripe_payment_method_id) {
      return await chargeAutopay(inv)
    }
    return await issueHostedInvoice(inv)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`issueOrCharge failed for invoice ${invoiceId} (sweep will retry):`, message)
    return { ok: false, error: message }
  }
}


// PL-13: registry extras for T2 — the same conditional intro/autopay pieces
// the code renderer builds, pre-rendered as blocks.
function t2Extras(opts: {
  monthLabel: string
  total: number
  hostedUrl: string
  dueLabel: string
  autopayLink: string | null
  reminder?: boolean
}) {
  return {
    tutoringMonthLabel: opts.monthLabel,
    invoiceReminderPrefix: opts.reminder ? 'Reminder: ' : '',
    invoiceTotal: fmtMoney(opts.total),
    invoiceDueDate: opts.dueLabel,
    invoiceUrl: opts.hostedUrl,
    invoiceIntroBlock: opts.reminder
      ? `<p>Just a nudge that the ${opts.monthLabel} tutoring invoice (<strong>${fmtMoney(opts.total)}</strong>, due ${opts.dueLabel}) is still open. If it's already on its way — thank you, ignore this!</p>`
      : `<p>Your invoice for ${opts.monthLabel} tutoring is ready: <strong>${fmtMoney(opts.total)}</strong>, due by <strong>${opts.dueLabel}</strong>.</p>`,
    autopayBlock: opts.autopayLink
      ? `<p style="color:#64748b;font-size:13px">Prefer not to think about this each month? <a href="${opts.autopayLink}" style="color:#00AEEE">Set up autopay</a> and future invoices charge your saved card or bank account automatically.</p>`
      : '',
  }
}

async function issueHostedInvoice(inv: NonNullable<Awaited<ReturnType<typeof loadInvoiceWithFamily>>>) {
  const family = inv.family!
  const customerId = await ensureStripeCustomer(family)
  const due = dueDateFor()
  const month = billingMonth(String(inv.period).slice(0, 7))

  // Invoice first (excluding any stray pending items from an earlier failed
  // attempt), then attach lines directly to it — a retry can never double-up.
  const stripeInvoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    due_date: due.unix,
    auto_advance: false, // we deliver the link in HGL voice (T2), Stripe stays quiet
    payment_settings: { payment_method_types: ['card', 'us_bank_account'] },
    pending_invoice_items_behavior: 'exclude',
    metadata: { tutoring_invoice_id: inv.id, hgl_family_id: family.id },
  })
  const { data: lines } = await supabase
    .from('tutoring_invoice_lines')
    .select('description, amount')
    .eq('invoice_id', inv.id)
    .order('created_at')
  for (const line of lines ?? []) {
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: stripeInvoice.id,
      amount: cents(line.amount), // negative amounts (credits) are supported
      currency: 'usd',
      description: line.description,
    })
  }
  const finalized = await stripe.invoices.finalizeInvoice(stripeInvoice.id!)

  await supabase
    .from('tutoring_invoices')
    .update({
      status: 'invoiced',
      stripe_invoice_id: finalized.id,
      stripe_hosted_invoice_url: finalized.hosted_invoice_url ?? null,
      sent_at: new Date().toISOString(),
      due_at: due.iso,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inv.id)
    .eq('status', 'confirmed')

  const contact = await loadContactInfo()
  const t2Opts = {
    monthLabel: month.label,
    total: Number(inv.total),
    hostedUrl: finalized.hosted_invoice_url ?? '',
    dueLabel: due.label,
    autopayLink: `${appUrl()}/tutoring/autopay/${autopayToken(family.id)}`,
    contact,
  }
  const email = await renderRegistered(
    'T2_INVOICE',
    { parentFirstName: family.parent_first_name ?? 'there', parentEmail: family.parent_email },
    { ...t2Extras(t2Opts), contactBlock: contactBlockHtml(contact) },
    () => t2InvoiceEmail(t2Opts)
  )
  await sendOnce({
    // Keyed on the STRIPE invoice too: a re-issue (late fee, line edit) is a
    // new document and must re-send; plain retries of the same document dedupe.
    dedupeKey: `t2_invoice:${inv.id}:${finalized.id}`,
    emailType: 'T2_INVOICE',
    to: [family.billing_email ?? family.parent_email],
    cc: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
    subject: email.subject,
    html: email.html,
  })
  return { ok: true, path: 'hosted_invoice' }
}

async function chargeAutopay(inv: NonNullable<Awaited<ReturnType<typeof loadInvoiceWithFamily>>>) {
  const family = inv.family!
  const customerId = await ensureStripeCustomer(family)
  const attempt = Number(inv.charge_attempts) + 1

  await supabase
    .from('tutoring_invoices')
    .update({
      status: 'invoiced',
      charge_attempts: attempt,
      sent_at: inv.sent_at ?? new Date().toISOString(),
      due_at: inv.due_at ?? dueDateFor().iso,
      next_charge_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inv.id)
    .in('status', ['confirmed', 'invoiced'])

  try {
    const pi = await stripe.paymentIntents.create({
      amount: cents(inv.total),
      currency: 'usd',
      customer: customerId,
      payment_method: family.stripe_payment_method_id!,
      off_session: true,
      confirm: true,
      description: `HGL tutoring — ${billingMonth(String(inv.period).slice(0, 7)).label}`,
      metadata: { tutoring_invoice_id: inv.id, hgl_family_id: family.id },
    })
    await supabase
      .from('tutoring_invoices')
      .update({ stripe_payment_intent_id: pi.id, updated_at: new Date().toISOString() })
      .eq('id', inv.id)
    if (pi.status === 'succeeded') {
      await markTutoringInvoicePaid(inv.id, pi.id) // cards resolve inline; ACH lands via webhook
    }
    return { ok: true, path: `autopay_attempt_${attempt}` }
  } catch (e) {
    await handleAutopayFailure(inv.id, e instanceof Error ? e.message : String(e))
    return { ok: true, path: `autopay_failed_attempt_${attempt}` }
  }
}

export async function handleAutopayFailure(invoiceId: string, reason: string): Promise<void> {
  const inv = await loadInvoiceWithFamily(invoiceId)
  if (!inv || !inv.family || inv.status === 'paid') return
  const attempts = Number(inv.charge_attempts)
  const month = billingMonth(String(inv.period).slice(0, 7))
  const contact = await loadContactInfo()
  const exhausted = attempts >= MAX_CHARGE_ATTEMPTS

  let hostedUrl = inv.stripe_hosted_invoice_url
  if (exhausted) {
    // Dunning done (§6.4): past due, Ops alert, and a pay-by-link fallback so
    // the family can settle without a working saved method.
    if (!hostedUrl) {
      try {
        const asConfirmed = { ...inv, status: 'confirmed' as const }
        await supabase.from('tutoring_invoices').update({ status: 'confirmed' }).eq('id', invoiceId)
        const issued = await issueHostedInvoice(asConfirmed)
        void issued
        hostedUrl = (await loadInvoiceWithFamily(invoiceId))?.stripe_hosted_invoice_url ?? null
      } catch (e) {
        console.error('fallback hosted invoice failed:', e)
      }
    }
    await supabase
      .from('tutoring_invoices')
      .update({ status: 'past_due', updated_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .neq('status', 'paid')
    await sendAdminAlert({
      dedupeKey: `t4_exhausted:${invoiceId}`,
      adminEmail: ADMIN_EMAIL,
      subject: `Autopay failed ${MAX_CHARGE_ATTEMPTS}× — ${month.label} tutoring invoice past due`,
      body: `<p>All ${MAX_CHARGE_ATTEMPTS} automatic charges failed for
        <strong>${inv.family.parent_first_name} ${inv.family.parent_last_name ?? ''}</strong>
        (${inv.family.parent_email}) — ${month.label}, $${Number(inv.total).toFixed(2)}.
        Last error: <code>${reason.slice(0, 300)}</code></p>
        <p>The family got a pay-by-link fallback. Consider a call, and the 10-day/30-day
        escalation applies from the due date (late fee is your call, never automatic).</p>`,
    }).catch(() => {})
  } else {
    const gapDays = RETRY_GAP_DAYS[attempts] ?? 2
    await supabase
      .from('tutoring_invoices')
      .update({
        next_charge_at: new Date(Date.now() + gapDays * 86_400_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
  }

  const t4Opts = {
    monthLabel: month.label,
    total: Number(inv.total),
    attempt: attempts,
    maxAttempts: MAX_CHARGE_ATTEMPTS,
    hostedUrl: exhausted ? hostedUrl : null,
    willRetry: !exhausted,
    contact,
  }
  const email = await renderRegistered(
    'T4_PAYMENT_FAILED',
    { parentFirstName: inv.family.parent_first_name ?? 'there', parentEmail: inv.family.parent_email },
    {
      tutoringMonthLabel: month.label,
      paymentFailBlock:
        `<p>The ${fmtMoney(Number(inv.total))} charge for ${month.label} tutoring didn't go through (attempt ${attempts} of ${MAX_CHARGE_ATTEMPTS}).</p>` +
        (t4Opts.willRetry
          ? `<p>No action needed if this was a temporary card issue — we'll retry automatically in a couple of days.</p>`
          : `<p><strong>We've stopped automatic retries.</strong> You can pay directly, or update your saved payment method:</p>`),
      payButtonBlock: t4Opts.hostedUrl
        ? `<p style="margin:24px 0"><a href="${t4Opts.hostedUrl}" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Pay now</a></p>`
        : '',
      contactBlock: contactBlockHtml(contact),
    },
    () => t4PaymentFailedEmail(t4Opts)
  )
  await sendOnce({
    dedupeKey: `t4_failed:${invoiceId}:${attempts}`,
    emailType: 'T4_PAYMENT_FAILED',
    to: [inv.family.billing_email ?? inv.family.parent_email],
    cc: inv.family.billing_cc_emails?.length ? inv.family.billing_cc_emails : undefined,
    subject: email.subject,
    html: email.html,
  })
}

/**
 * Current Stripe API versions no longer expose payment_intent on the Invoice
 * object — resolve it through the invoice's payments list (the QBO queue
 * keys idempotency on the PI, so this must not come back null for paid
 * hosted invoices).
 */
export async function resolveInvoicePaymentIntentId(stripeInvoiceId: string): Promise<string | null> {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const inv: any = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ['payments'] })
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const payments: any[] = inv.payments?.data ?? []
    const paid = payments.find((p) => p.status === 'paid') ?? payments[0]
    const pi = paid?.payment?.payment_intent
    return typeof pi === 'string' ? pi : (pi?.id ?? null)
  } catch (e) {
    console.error(`resolving PI for stripe invoice ${stripeInvoiceId} failed:`, e)
    return null
  }
}

/** Idempotent paid-marker: stamps the invoice and enqueues the Phase 6 QBO
 *  queue (kind 'tutoring_sale'); duplicate webhook deliveries conflict away
 *  on the (payment_intent, kind) unique index. */
export async function markTutoringInvoicePaid(invoiceId: string, paymentIntentId: string | null): Promise<void> {
  const { data: updated } = await supabase
    .from('tutoring_invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .neq('status', 'paid')
    .neq('status', 'void')
    .select('id, total')
  if (!updated || updated.length === 0) return // already paid — duplicate event

  if (paymentIntentId) {
    const { error } = await supabase.from('qbo_sync_log').insert({
      tutoring_invoice_id: invoiceId,
      stripe_payment_intent_id: paymentIntentId,
      kind: 'tutoring_sale',
      amount: Number(updated[0].total),
    })
    if (error && error.code !== '23505') {
      console.error(`QBO enqueue failed for tutoring invoice ${invoiceId}:`, error.message)
    }
    // Drain synchronously — a floating promise dies with the lambda (callers
    // are webhook handlers and sweeps; both can afford the wait, and the
    // daily cron is the retry backstop either way).
    await processQboQueue().catch((e) => console.error('QBO drain after tutoring payment failed:', e))
  }
}

// ---------------------------------------------------------------------------
// Autopay opt-in (SetupIntent via hosted Checkout, §3 families / §8)
// ---------------------------------------------------------------------------

export async function createAutopaySetupSession(familyId: string): Promise<string> {
  const { data: family } = await supabase
    .from('families')
    .select('id, parent_first_name, parent_last_name, parent_email, billing_email, billing_cc_emails, autopay, stripe_customer_id, stripe_payment_method_id')
    .eq('id', familyId)
    .single()
  if (!family) throw new Error('unknown family')
  const customerId = await ensureStripeCustomer(family as FamilyBilling)
  const returnUrl = `${appUrl()}/tutoring/autopay/${autopayToken(familyId)}`
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: customerId,
    payment_method_types: ['card', 'us_bank_account'],
    success_url: `${returnUrl}?done=1`,
    cancel_url: returnUrl,
    metadata: { tutoring_autopay_family: familyId },
  })
  return session.url!
}

/** Webhook side of the opt-in: stash the saved method + flip autopay on. */
export async function completeAutopaySetup(familyId: string, setupIntentId: string): Promise<void> {
  const si = await stripe.setupIntents.retrieve(setupIntentId)
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id
  if (!pm) return
  await supabase
    .from('families')
    .update({ stripe_payment_method_id: pm, autopay: true })
    .eq('id', familyId)
}

// ---------------------------------------------------------------------------
// Daily collection sweeps (§6.4): confirmed-but-unbilled retry, autopay
// retries, +10-day reminder, +30-day late-fee flag
// ---------------------------------------------------------------------------

export type CollectionSweepResult = {
  issued: number
  retried: number
  reminders: number
  lateFeeFlags: number
}

export async function sweepCollections(now: Date = new Date()): Promise<CollectionSweepResult> {
  const result: CollectionSweepResult = { issued: 0, retried: 0, reminders: 0, lateFeeFlags: 0 }
  try {
    // Confirmed but never billed (fail-soft catch-up).
    const { data: confirmed } = await supabase
      .from('tutoring_invoices')
      .select('id')
      .eq('status', 'confirmed')
    for (const inv of confirmed ?? []) {
      const r = await issueOrCharge(inv.id)
      if (r.ok && r.path !== 'noop') result.issued++
    }

    // Autopay retries due.
    const { data: retries } = await supabase
      .from('tutoring_invoices')
      .select('id')
      .eq('status', 'invoiced')
      .gt('charge_attempts', 0)
      .lt('charge_attempts', MAX_CHARGE_ATTEMPTS)
      .lte('next_charge_at', now.toISOString())
      .not('next_charge_at', 'is', null)
    for (const inv of retries ?? []) {
      const full = await loadInvoiceWithFamily(inv.id)
      if (!full || !full.family?.autopay || !full.family.stripe_payment_method_id) continue
      await chargeAutopay(full)
      result.retried++
    }

    // Escalation (§6.4, signed policy automated — money never moves itself).
    const { data: overdue } = await supabase
      .from('tutoring_invoices')
      .select('id, period, total, due_at, reminder_sent_at, late_fee_flagged_at, stripe_hosted_invoice_url, families ( parent_first_name, parent_last_name, parent_email, billing_email, billing_cc_emails )')
      .in('status', ['invoiced', 'past_due'])
      .not('due_at', 'is', null)
    const contact = await loadContactInfo()
    for (const inv of (overdue as any[]) ?? []) {
      const fam = one<any>(inv.families)
      if (!fam) continue
      const overdueDays = (now.getTime() - new Date(inv.due_at).getTime()) / 86_400_000
      const month = billingMonth(String(inv.period).slice(0, 7))

      if (overdueDays >= 10 && !inv.reminder_sent_at) {
        const t2rOpts = {
          monthLabel: month.label,
          total: Number(inv.total),
          hostedUrl: inv.stripe_hosted_invoice_url ?? '',
          dueLabel: new Date(inv.due_at).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric' }),
          autopayLink: null,
          contact,
          reminder: true,
        }
        const email = await renderRegistered(
          'T2_INVOICE',
          { parentFirstName: fam.parent_first_name ?? 'there', parentEmail: fam.parent_email },
          { ...t2Extras(t2rOpts), contactBlock: contactBlockHtml(contact) },
          () => t2InvoiceEmail(t2rOpts)
        )
        await sendOnce({
          dedupeKey: `t2_reminder:${inv.id}`,
          emailType: 'T2_INVOICE',
          to: [fam.billing_email ?? fam.parent_email],
          cc: fam.billing_cc_emails?.length ? fam.billing_cc_emails : undefined,
          subject: email.subject,
          html: email.html,
        })
        await sendAdminAlert({
          dedupeKey: `overdue10:${inv.id}`,
          adminEmail: ADMIN_EMAIL,
          subject: `Tutoring invoice 10+ days past due — ${fam.parent_first_name} ${fam.parent_last_name ?? ''}`,
          body: `<p>${month.label}, $${Number(inv.total).toFixed(2)}, due ${new Date(inv.due_at).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })} —
            reminder sent to the family. 30-day mark adds the late-fee flag.</p>`,
        }).catch(() => {})
        await supabase
          .from('tutoring_invoices')
          .update({ status: 'past_due', reminder_sent_at: now.toISOString(), updated_at: now.toISOString() })
          .eq('id', inv.id)
        result.reminders++
      }

      if (overdueDays >= 30 && !inv.late_fee_flagged_at) {
        await supabase
          .from('tutoring_invoices')
          .update({ late_fee_flagged_at: now.toISOString(), updated_at: now.toISOString() })
          .eq('id', inv.id)
        await sendAdminAlert({
          dedupeKey: `overdue30:${inv.id}`,
          adminEmail: ADMIN_EMAIL,
          subject: `30+ days past due — late-fee decision needed (${fam.parent_first_name} ${fam.parent_last_name ?? ''})`,
          body: `<p>${month.label} tutoring invoice ($${Number(inv.total).toFixed(2)}) is 30+ days past due.
            Per the signed policy you MAY apply the 10% late fee — it's a button on the invoice panel
            (/admin/tutoring), never automatic — and consider pausing the schedule.</p>`,
        }).catch(() => {})
        result.lateFeeFlags++
      }
    }
    return result
  } catch (e) {
    console.error('sweepCollections crashed:', e)
    return result
  }
}

// Auto-confirmed proposals flow straight into collection (no import cycle:
// tutoring-billing exposes the hook, we register the implementation).
registerConfirmFollowUp((invoiceId) => issueOrCharge(invoiceId))
/* eslint-enable @typescript-eslint/no-explicit-any */
