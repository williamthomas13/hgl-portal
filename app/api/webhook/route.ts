import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import {
  lateRegistrationWelcomeEmail,
  parentConfirmationEmail,
  sendAdminAlert,
  sendOnce,
  studentConfirmationEmail,
} from '../../utils/email';
import {
  ADMIN_EMAIL,
  SEQUENCE,
  emailContext,
  isDue,
  loadClassBundles,
  stepTargetDate,
} from '../../utils/lifecycle';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
);

// The App Router requires this flag so the raw body reaches stripe.webhooks.constructEvent.
export const runtime = 'nodejs';

// Durably record a purchased tutoring add-on (hours become schedulable
// sessions in the future TutorBird-replacement phase). Idempotent: the
// (enrollment_id, package_id) unique constraint absorbs webhook retries.
async function recordAddon(enrollmentId: string, packageId: string, stripeSessionId: string) {
  const { data: pkg } = await supabase
    .from('tutoring_packages')
    .select('hours, package_price')
    .eq('id', packageId)
    .single();
  if (!pkg) {
    console.error(`Addon package ${packageId} not found for enrollment ${enrollmentId}`);
    return;
  }
  const { error } = await supabase.from('enrollment_addons').insert([
    {
      enrollment_id: enrollmentId,
      package_id: packageId,
      hours: pkg.hours,
      price_paid: pkg.package_price,
      stripe_session_id: stripeSessionId,
    },
  ]);
  if (error && error.code !== '23505') {
    console.error(`Failed to record addon for enrollment ${enrollmentId}:`, error.message);
  }
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
    const enrollmentId = session.metadata?.enrollment_id;
    const packageId = session.metadata?.package_id;
    const sessionId = session.id;

    // Addon-only purchase (from the #9 upsell page): the enrollment was
    // already paid — record the addon and leave the payment fields alone.
    if (session.metadata?.addon_only === '1') {
      if (enrollmentId && packageId) {
        await recordAddon(enrollmentId, packageId, sessionId);
        console.log(`Recorded addon-only purchase for enrollment ${enrollmentId}.`);
      }
      return NextResponse.json({ received: true });
    }
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

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
      });

    const { data, error } = enrollmentId
      ? await enrollmentQuery.eq('id', enrollmentId).select('id, class_id')
      : await enrollmentQuery.eq('stripe_session_id', sessionId).select('id, class_id');

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

    // Record the in-checkout tutoring add-on before loading the bundle so
    // the #0 confirmation recap includes it.
    if (packageId) {
      await recordAddon(paidEnrollmentId, packageId, sessionId);
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
            const { subject, html } = lateRegistrationWelcomeEmail(ctx, t.audience);
            const status = await sendOnce({
              dedupeKey: t.key,
              emailType: 'late_welcome',
              enrollmentId: paidEnrollmentId,
              to: [t.to],
              subject,
              html,
            });
            if (status === 'sent') anySent = true;
          }
          if (anySent) {
            // Claim the replaced sends: thank-you (#1) + both audiences of
            // the superseded pre-start steps. One by one so a duplicate
            // (webhook retry) can't abort the remaining claims.
            const claimKeys = [
              `thank_you:${paidEnrollmentId}`,
              ...supersededSteps.flatMap((s) =>
                ['p', 's'].map((tag) => `${s.type}_${tag}:${paidEnrollmentId}`)
              ),
            ];
            for (const dedupe_key of claimKeys) {
              const { error: claimErr } = await supabase.from('email_log').insert([
                {
                  dedupe_key,
                  email_type: 'superseded_by_welcome',
                  enrollment_id: paidEnrollmentId,
                  recipients: targets.map((t) => t.to),
                },
              ]);
              if (claimErr && claimErr.code !== '23505') {
                console.error(`Failed to claim ${dedupe_key}:`, claimErr.message);
              }
            }
          }
        } else {
          // Normal flow: #0-P + #0-S now; #1 follows from the sweep at ~3h.
          const parent = parentConfirmationEmail(ctx);
          await sendOnce({
            dedupeKey: `parent_confirmation:${paidEnrollmentId}`,
            emailType: 'parent_confirmation',
            enrollmentId: paidEnrollmentId,
            to: [ctx.parentEmail],
            subject: parent.subject,
            html: parent.html,
          });

          if (ctx.studentEmail) {
            const student = studentConfirmationEmail(ctx);
            await sendOnce({
              dedupeKey: `student_confirmation:${paidEnrollmentId}`,
              emailType: 'student_confirmation',
              enrollmentId: paidEnrollmentId,
              to: [ctx.studentEmail],
              subject: student.subject,
              html: student.html,
            });
          }
        }
      }
    } catch (emailErr) {
      console.error('Confirmation email failed:', emailErr);
    }
  }

  return NextResponse.json({ received: true });
}
