import { NextResponse, after } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin as supabase } from "../../utils/supabase-admin"
import { processQboQueue } from '../../utils/qbo-sync';
import {
  completeAutopaySetup,
  handleAutopayFailure,
  markTutoringInvoicePaid,
  resolveInvoicePaymentIntentId,
} from '../../utils/tutoring-stripe';
import { renderEmail } from '../../utils/comms-db-render';
import { runEnrollmentCommsPass } from '../../utils/comms-inline';
import {
  lateRegistrationWelcomeEmail,
  parentConfirmationEmail,
  registrationNotificationContent,
  sendAdminAlert,
  sendOnce,
  studentConfirmationEmail,
} from '../../utils/email';
import {
  ADMIN_EMAIL,
  REGISTRATION_NOTIFY_EMAIL,
  SEQUENCE,
  emailContext,
  isDue,
  loadClassBundles,
  stepTargetDate,
} from '../../utils/lifecycle';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// The App Router requires this flag so the raw body reaches stripe.webhooks.constructEvent.
export const runtime = 'nodejs';

// Durably record a purchased tutoring add-on (hours become schedulable
// sessions in the future TutorBird-replacement phase). Idempotent: the
// (enrollment_id, package_id) unique constraint absorbs webhook retries.
// Returns the addon row id (inserted or pre-existing) so addon-only
// purchases can enqueue their QBO sale against it (Phase 6).
async function recordAddon(
  enrollmentId: string,
  packageId: string,
  stripeSessionId: string,
  paymentIntentId: string | null
): Promise<string | null> {
  const { data: pkg } = await supabase
    .from('tutoring_packages')
    .select('hours, package_price')
    .eq('id', packageId)
    .single();
  if (!pkg) {
    console.error(`Addon package ${packageId} not found for enrollment ${enrollmentId}`);
    return null;
  }
  const { data, error } = await supabase
    .from('enrollment_addons')
    .insert([
      {
        enrollment_id: enrollmentId,
        package_id: packageId,
        hours: pkg.hours,
        price_paid: pkg.package_price,
        stripe_session_id: stripeSessionId,
        stripe_payment_intent_id: paymentIntentId,
      },
    ])
    .select('id');
  if (data?.[0]?.id) return data[0].id;
  if (error && error.code !== '23505') {
    console.error(`Failed to record addon for enrollment ${enrollmentId}:`, error.message);
    return null;
  }
  // Webhook retry: the row already exists — fetch it.
  const { data: existing } = await supabase
    .from('enrollment_addons')
    .select('id')
    .eq('enrollment_id', enrollmentId)
    .eq('package_id', packageId)
    .maybeSingle();
  return existing?.id ?? null;
}

// Phase 6 (docs/PHASE6_SPEC.md §4/§5): enqueue a QBO sync row. Never blocks
// or fails the webhook — QBO downtime must never affect checkout. Duplicate
// webhook deliveries insert-conflict away on (payment_intent, kind).
async function enqueueQboSync(row: {
  enrollment_id: string;
  enrollment_addon_id?: string | null;
  stripe_payment_intent_id: string;
  kind: 'sale' | 'refund';
  amount: number | null;
}) {
  const { error } = await supabase.from('qbo_sync_log').insert([row]);
  if (!error) return 'inserted';
  if (error.code === '23505') return 'duplicate';
  console.error(`QBO enqueue failed for ${row.kind} ${row.stripe_payment_intent_id}:`, error.message);
  return 'failed';
}

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

    const enrollmentId = session.metadata?.enrollment_id;
    const packageId = session.metadata?.package_id;
    const sessionId = session.id;

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    // Addon-only purchase (from the #9 upsell page): the enrollment was
    // already paid — record the addon and leave the payment fields alone.
    // It is still portal revenue, so it gets its own QBO Sales Receipt.
    if (session.metadata?.addon_only === '1') {
      if (enrollmentId && packageId) {
        const addonId = await recordAddon(enrollmentId, packageId, sessionId, paymentIntentId);
        console.log(`Recorded addon-only purchase for enrollment ${enrollmentId}.`);
        if (addonId && paymentIntentId) {
          await enqueueQboSync({
            enrollment_id: enrollmentId,
            enrollment_addon_id: addonId,
            stripe_payment_intent_id: paymentIntentId,
            kind: 'sale',
            amount: session.amount_total != null ? session.amount_total / 100 : null,
          });
          after(() => processQboQueue());
        }
      }
      return NextResponse.json({ received: true });
    }

    // Primary match: the enrollment id we set in metadata.
    // Fallback: the stripe session id we stamped on the enrollment before redirect.
    const enrollmentQuery = supabase
      .from('enrollments')
      .update({
        payment_status: 'Paid',
        stripe_session_id: sessionId,
        stripe_payment_intent_id: paymentIntentId,
        paid_at: new Date().toISOString(),
        // Real charged total (class + any add-on) for the #0-P order summary.
        amount_paid: session.amount_total != null ? session.amount_total / 100 : null,
        // PL-52: the pending-cart marker has served its purpose.
        pending_package_id: null,
        pending_checkout_total: null,
      });

    const { data, error } = enrollmentId
      ? await enrollmentQuery.eq('id', enrollmentId).select('id, class_id, classes ( status )')
      : await enrollmentQuery.eq('stripe_session_id', sessionId).select('id, class_id, classes ( status )');

    if (error || !data || data.length === 0) {
      // Payment came in but we couldn't record it — the one failure the
      // admin must hear about immediately.
      const problem = error
        ? `Database error: ${error.message}`
        : `No enrollment matched (enrollment_id=${enrollmentId ?? 'none'}).`;
      console.error(`Webhook failed for session ${sessionId}: ${problem}`);
      await sendAdminAlert({
        dedupeKey: `webhook_failure:${sessionId}`,
        adminEmail: ADMIN_EMAIL,
        subject: 'Stripe payment could not be matched to an enrollment',
        body: `<p>Stripe checkout session <code>${sessionId}</code> completed, but the
          enrollment could not be updated.</p><p>${problem}</p>
          <p>Check the Stripe dashboard and the enrollments table.</p>`,
      }).catch((e) => console.error('Admin alert failed:', e));
      return NextResponse.json({ received: true });
    }

    const paidEnrollmentId = data[0].id;
    const classId = data[0].class_id;
    console.log(`Marked enrollment ${paidEnrollmentId} paid (session ${sessionId}).`);

    // Phase 6: money moved, so the sale must reach QuickBooks — even in the
    // paid-after-cancel race below (the refund receipt will pair with it).
    // The worker runs after the response; the webhook never waits on QBO.
    if (paymentIntentId) {
      await enqueueQboSync({
        enrollment_id: paidEnrollmentId,
        stripe_payment_intent_id: paymentIntentId,
        kind: 'sale',
        amount: session.amount_total != null ? session.amount_total / 100 : null,
      });
      after(() => processQboQueue());
    } else {
      console.error(`No payment intent on session ${sessionId} — QBO sale not enqueued.`);
    }

    // Race guard (PHASE4_SPEC §12): a checkout opened before the class was
    // cancelled can complete after it. The payment is recorded (money moved —
    // that's the refund audit trail), but no welcome emails go out; the admin
    // refunds it in Stripe like the others.
    const classRel = data[0].classes as { status?: string } | { status?: string }[] | null;
    const classStatus = (Array.isArray(classRel) ? classRel[0] : classRel)?.status;
    if (classStatus === 'cancelled') {
      await supabase
        .from('enrollments')
        .update({ class_cancelled: true })
        .eq('id', paidEnrollmentId);
      await sendAdminAlert({
        dedupeKey: `paid_after_cancel:${paidEnrollmentId}`,
        adminEmail: ADMIN_EMAIL,
        subject: 'Payment received for a CANCELLED class — refund needed',
        body: `<p>Enrollment <code>${paidEnrollmentId}</code> completed Stripe checkout
          (session <code>${sessionId}</code>) after its class was cancelled. No welcome email
          was sent. Issue the refund in the Stripe dashboard and reply to the family from the
          cancellation thread.</p>`,
      }).catch((e) => console.error('Admin alert failed:', e));
      return NextResponse.json({ received: true });
    }

    // Record the in-checkout tutoring add-on before loading the bundle so
    // the #0 confirmation recap includes it. PI stays null here — in-checkout
    // add-ons ride the enrollment's payment intent; only addon-only purchases
    // (their own checkout) stamp a PI, which is what refund matching keys on.
    if (packageId) {
      await recordAddon(paidEnrollmentId, packageId, sessionId, null);
    }

    // Welcome email: normally the thank-you; if the signup happened after
    // pre-start emails would already have fired, send one combined welcome
    // (thank-you + Synap + FAQ) instead and claim those steps' dedupe keys
    // so the sweep never re-sends them individually.
    // A failure here must not fail the webhook (Stripe would keep retrying
    // an already-recorded payment).
    try {
      const [bundle] = await loadClassBundles(classId);
      const enrollment = bundle?.enrollments.find((e) => e.id === paidEnrollmentId);
      if (bundle && enrollment) {
        const ctx = emailContext(bundle, enrollment);

        // Registration notification (ADMIN email — replaces the old
        // Squarespace notification): once per PAID registration, with the
        // add-on and the class's running counts. The bundle was loaded after
        // the Paid update and recordAddon, so both are reflected.
        const paidCount = bundle.enrollments.filter(
          (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
        ).length;
        const pendingCount = bundle.enrollments.filter(
          (e) => e.payment_status === 'Pending'
        ).length;
        const note = registrationNotificationContent({
          studentName: `${enrollment.studentFirstName} ${enrollment.studentLastName}`,
          label: `${bundle.schoolLabel} ${bundle.classType}`,
          schoolName: bundle.schoolName,
          addonNames: enrollment.addons.map((a) => `${a.name} (${a.hours}h)`),
          paid: paidCount,
          pending: pendingCount,
          minEnrollment: bundle.minEnrollment,
          capacity: bundle.capacity,
        });
        await sendAdminAlert({
          dedupeKey: `registration_notification:${paidEnrollmentId}`,
          adminEmail: REGISTRATION_NOTIFY_EMAIL,
          subject: note.subject,
          body: note.body,
          enrollmentId: paidEnrollmentId,
        });

        // Late registration test: would the pre-start emails (#2/#3) already
        // have fired? If so, the LR welcome replaces the whole confirmation
        // flow (#0-P/#0-S spacing, #1, #2, #3) in one email per audience —
        // the parent variant carries the #0-style order summary.
        const supersededSteps = SEQUENCE.filter(
          (s) =>
            (s.type === 'synap_access' || s.type === 'faq') &&
            isDue(bundle.timezone, stepTargetDate(s, bundle), s.hour)
        );

        if (supersededSteps.length > 0) {
          // LR is transactional — always sends, even for opted-out families.
          // Reuses the confirmation dedupe keys so #0 and LR can never both
          // send for the same enrollment.
          const targets: { audience: 'parent' | 'student'; to: string; key: string }[] = [
            { audience: 'parent', to: ctx.parentEmail, key: `parent_confirmation:${paidEnrollmentId}` },
          ];
          if (ctx.studentEmail) {
            targets.push({ audience: 'student', to: ctx.studentEmail, key: `student_confirmation:${paidEnrollmentId}` });
          }
          let anySent = false;
          for (const t of targets) {
            const { subject, html, versionId } = await renderEmail(
              'LR_WELCOME',
              ctx,
              t.audience,
              {},
              () => lateRegistrationWelcomeEmail(ctx, t.audience)
            );
            const status = await sendOnce({
              dedupeKey: t.key,
              emailType: 'late_welcome',
              enrollmentId: paidEnrollmentId,
              classId,
              to: [t.to],
              subject,
              html,
              bodySnapshotId: versionId,
            });
            if (status === 'sent') anySent = true;
          }
          if (anySent) {
            // Claim the replaced sends: thank-you (#1) + both audiences of
            // the superseded pre-start steps. Cancelled email_sends rows ARE
            // the claim (sendOnce suppresses on cancelled) — and the comms
            // dashboard shows exactly why each step didn't go out. One by one
            // so a duplicate (webhook retry) can't abort the remaining claims.
            const claimKeys = [
              `thank_you:${paidEnrollmentId}`,
              ...supersededSteps.flatMap((s) =>
                ['p', 's'].map((tag) => `${s.type}_${tag}:${paidEnrollmentId}`)
              ),
            ];
            for (const dedupe_key of claimKeys) {
              const { error: claimErr } = await supabase.from('email_sends').insert([
                {
                  dedupe_key,
                  template_key: 'SUPERSEDED',
                  enrollment_id: paidEnrollmentId,
                  class_id: classId,
                  recipient_email: ctx.parentEmail.toLowerCase(),
                  status: 'cancelled',
                  cancel_reason: 'superseded by combined late-registration welcome',
                },
              ]);
              if (claimErr && claimErr.code !== '23505') {
                console.error(`Failed to claim ${dedupe_key}:`, claimErr.message);
              }
            }
            // A pre-projected scheduled row may already exist for these keys —
            // the insert conflicts away; cancel those in place instead.
            await supabase
              .from('email_sends')
              .update({
                status: 'cancelled',
                cancel_reason: 'superseded by combined late-registration welcome',
              })
              .in('dedupe_key', claimKeys)
              .in('status', ['scheduled', 'held']);
          }
        } else {
          // Normal flow: #0-P + #0-S now; #1 follows from the sweep at ~3h.
          const parent = await renderEmail('E0_CONFIRM_PARENT', ctx, 'parent', {}, () =>
            parentConfirmationEmail(ctx)
          );
          await sendOnce({
            dedupeKey: `parent_confirmation:${paidEnrollmentId}`,
            emailType: 'parent_confirmation',
            enrollmentId: paidEnrollmentId,
            classId,
            to: [ctx.parentEmail],
            subject: parent.subject,
            html: parent.html,
            bodySnapshotId: parent.versionId,
          });

          if (ctx.studentEmail) {
            const student = await renderEmail('E0_CONFIRM_STUDENT', ctx, 'student', {}, () =>
              studentConfirmationEmail(ctx)
            );
            await sendOnce({
              dedupeKey: `student_confirmation:${paidEnrollmentId}`,
              emailType: 'student_confirmation',
              enrollmentId: paidEnrollmentId,
              classId,
              to: [ctx.studentEmail],
              subject: student.subject,
              html: student.html,
              bodySnapshotId: student.versionId,
            });
          }
        }
      }
    } catch (emailErr) {
      console.error('Confirmation email failed:', emailErr);
    }

    // PL-51: re-materialize this enrollment's schedule for its new Paid state
    // (PR rows become obsolete via the cron's reconciliation; thank-you/#9/
    // sequence rows appear now) and send anything already due — a payment
    // days after registration releases backed-up steps immediately instead of
    // waiting for tomorrow's cron.
    after(() =>
      runEnrollmentCommsPass(paidEnrollmentId).catch((e) =>
        console.error('inline comms pass failed (cron will catch up):', e)
      )
    );
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
            <p>If the month should not stay marked paid, adjust it on /admin/tutoring.</p>`,
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
