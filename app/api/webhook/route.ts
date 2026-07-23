import { NextResponse, after } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin as supabase } from "../../utils/supabase-admin"
import { processQboQueue } from '../../utils/qbo-sync';
import { enqueueQboSync, handleClassCheckoutCompleted } from '../../utils/checkout-paid';
import {
  completeAutopaySetup,
  handleAutopayFailure,
  markTutoringInvoicePaid,
  resolveInvoicePaymentIntentId,
} from '../../utils/tutoring-stripe';
import { emailBaseUrl } from '../../utils/base-url';
import { sendAdminAlert } from '../../utils/email';
import { ADMIN_EMAIL } from '../../utils/lifecycle';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// The App Router requires this flag so the raw body reaches stripe.webhooks.constructEvent.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const payload = await req.text();
  const sig = req.headers.get('stripe-signature') as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown webhook error';
    console.error('Webhook signature verification failed:', message);
    return NextResponse.json({ error: 'Webhook signature error' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Phase 7c: autopay opt-in (setup-mode Checkout from /tutoring/autopay).
    // Saves the payment method and flips families.autopay — no money moved.
    if (session.mode === 'setup' && session.metadata?.tutoring_autopay_family) {
      const setupIntentId =
        typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
      if (setupIntentId) {
        await completeAutopaySetup(session.metadata.tutoring_autopay_family, setupIntentId);
        console.log(`Autopay enabled for family ${session.metadata.tutoring_autopay_family}.`);
      }
      return NextResponse.json({ received: true });
    }

    // PL-92: the paid-checkout consequences live in checkout-paid.ts so the
    // admin attach-payment action can run the identical path.
    await handleClassCheckoutCompleted(session, { defer: after });
    return NextResponse.json({ received: true });
  }

  // Phase 6 (docs/PHASE6_SPEC.md §5): a refund issued in the Stripe dashboard
  // flows to a QBO Refund Receipt. Matching: the payment intent on the charge
  // is either an enrollment's class payment or an addon-only purchase. The
  // portal-side status change (mark Refunded) stays a manual staff action —
  // this only keeps the books in step with the money.
  // Phase 7c: tutoring invoice lifecycle. Hosted invoices report through
  // invoice.paid/payment_failed; autopay PaymentIntents (notably async ACH
  // debits) through payment_intent.succeeded/payment_failed. Every handler
  // filters to tutoring metadata — class-checkout PIs pass straight through.
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const tutoringInvoiceId = invoice.metadata?.tutoring_invoice_id;
    if (tutoringInvoiceId && invoice.id) {
      // Older API versions carried payment_intent on the invoice; current
      // ones don't — resolve through the payments list (the QBO enqueue
      // needs the PI for idempotency).
      const pi = (invoice as unknown as { payment_intent?: string | { id: string } | null }).payment_intent;
      const paymentIntentId =
        (typeof pi === 'string' ? pi : pi?.id ?? null) ??
        (await resolveInvoicePaymentIntentId(invoice.id));
      await markTutoringInvoicePaid(tutoringInvoiceId, paymentIntentId);
      console.log(`Tutoring invoice ${tutoringInvoiceId} paid (hosted invoice ${invoice.id}).`);
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const tutoringInvoiceId = invoice.metadata?.tutoring_invoice_id;
    if (tutoringInvoiceId) {
      // Hosted-invoice failure (typically an ACH debit bouncing days later):
      // the invoice stays open on Stripe's side — alert the Ops Director.
      await sendAdminAlert({
        dedupeKey: `tutoring_invoice_failed:${invoice.id}:${invoice.attempt_count ?? 0}`,
        adminEmail: ADMIN_EMAIL,
        subject: 'Tutoring invoice payment failed (family pay-by-link)',
        body: `<p>A payment attempt on hosted invoice <code>${invoice.id}</code>
          (portal invoice <code>${tutoringInvoiceId}</code>) failed — commonly an ACH debit
          bouncing after a few days. The invoice link still works; the 10/30-day escalation
          applies from the due date.</p>`,
      }).catch((e) => console.error('alert failed:', e));
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.tutoring_invoice_id) {
      await markTutoringInvoicePaid(pi.metadata.tutoring_invoice_id, pi.id);
      console.log(`Tutoring invoice ${pi.metadata.tutoring_invoice_id} paid (autopay ${pi.id}).`);
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.tutoring_invoice_id) {
      await handleAutopayFailure(
        pi.metadata.tutoring_invoice_id,
        pi.last_payment_error?.message ?? 'payment failed'
      );
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const refundPi =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null;
    const refundedAmount = charge.amount_refunded != null ? charge.amount_refunded / 100 : null;
    if (!refundPi || !refundedAmount) return NextResponse.json({ received: true });

    let refundEnrollmentId: string | null = null;
    const { data: byEnrollment } = await supabase
      .from('enrollments')
      .select('id')
      .eq('stripe_payment_intent_id', refundPi)
      .maybeSingle();
    if (byEnrollment) {
      refundEnrollmentId = byEnrollment.id;
    } else {
      const { data: byAddon } = await supabase
        .from('enrollment_addons')
        .select('enrollment_id')
        .eq('stripe_payment_intent_id', refundPi)
        .maybeSingle();
      refundEnrollmentId = byAddon?.enrollment_id ?? null;
    }
    if (!refundEnrollmentId) {
      // Phase 7c: a tutoring payment refunded from the Stripe dashboard. The
      // policy is reschedule-never-refund, so this is a rare discretionary
      // call — no automatic Refund Receipt; the bookkeeper enters it by hand.
      const { data: tutoringInv } = await supabase
        .from('tutoring_invoices')
        .select('id, period, families ( parent_first_name, parent_last_name, parent_email )')
        .eq('stripe_payment_intent_id', refundPi)
        .maybeSingle();
      if (tutoringInv) {
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const fam: any = Array.isArray(tutoringInv.families) ? tutoringInv.families[0] : tutoringInv.families;
        await sendAdminAlert({
          dedupeKey: `tutoring_refund:${refundPi}:${Math.round(refundedAmount * 100)}`,
          adminEmail: ADMIN_EMAIL,
          subject: 'Tutoring payment refunded in Stripe — manual QuickBooks entry needed',
          body: `<p>$${refundedAmount.toFixed(2)} was refunded on the tutoring invoice for
            <strong>${fam?.parent_first_name ?? ''} ${fam?.parent_last_name ?? ''}</strong>
            (period ${String(tutoringInv.period).slice(0, 7)}). Tutoring refunds are discretionary
            (policy is reschedule-not-refund), so the books entry is manual: record a Refund
            Receipt in QuickBooks against the matching tutoring item.</p>
            <p>If the month should not stay marked paid,
            <a href="${emailBaseUrl()}/admin/tutoring?invoice=${tutoringInv.id}" style="color:#00AEEE">adjust it on the invoice row</a>.</p>`,
        }).catch((e) => console.error('alert failed:', e));
        return NextResponse.json({ received: true });
      }
      // Not a portal payment we know (e.g. pre-Phase-6 history) — note it and
      // move on; the bookkeeper handles it like before.
      console.log(`charge.refunded for unknown payment intent ${refundPi} — no QBO row enqueued.`);
      return NextResponse.json({ received: true });
    }

    const outcome = await enqueueQboSync({
      enrollment_id: refundEnrollmentId,
      stripe_payment_intent_id: refundPi,
      kind: 'refund',
      amount: refundedAmount,
    });

    if (outcome === 'duplicate') {
      // charge.refunded reports the CUMULATIVE refunded amount, and one
      // Refund Receipt per payment is the idempotency rule (spec §3). A
      // second partial refund can only be recorded manually — tell the admin.
      const { data: existing } = await supabase
        .from('qbo_sync_log')
        .select('id, amount, status')
        .eq('stripe_payment_intent_id', refundPi)
        .eq('kind', 'refund')
        .maybeSingle();
      if (existing && refundedAmount > Number(existing.amount ?? 0)) {
        if (existing.status === 'synced') {
          await sendAdminAlert({
            dedupeKey: `qbo_refund_extra:${refundPi}:${Math.round(refundedAmount * 100)}`,
            adminEmail: ADMIN_EMAIL,
            subject: 'Additional Stripe refund needs a manual QuickBooks entry',
            body: `<p>Payment <code>${refundPi}</code> (enrollment <code>${refundEnrollmentId}</code>)
              was refunded again in Stripe — cumulative refunds now total
              <strong>$${refundedAmount.toFixed(2)}</strong>, but a Refund Receipt for the earlier
              amount ($${Number(existing.amount ?? 0).toFixed(2)}) already synced to QuickBooks.</p>
              <p>Enter the additional refund in QuickBooks manually.</p>`,
            enrollmentId: refundEnrollmentId,
          }).catch((e) => console.error('Admin alert failed:', e));
        } else {
          // Not synced yet — the pending row can absorb the new total.
          await supabase
            .from('qbo_sync_log')
            .update({ amount: refundedAmount })
            .eq('id', existing.id)
            .neq('status', 'synced');
        }
      }
    }
    after(() => processQboQueue());
  }

  return NextResponse.json({ received: true });
}
