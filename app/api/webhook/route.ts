import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import {
  combinedWelcomeEmail,
  recipients,
  sendAdminAlert,
  sendOnce,
  thankYouEmail,
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
    const sessionId = session.id;
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
        const supersededSteps = SEQUENCE.filter(
          (s) =>
            (s.type === 'synap_access' || s.type === 'faq') &&
            isDue(bundle.timezone, stepTargetDate(s, bundle), s.hour)
        );

        if (supersededSteps.length > 0) {
          // Combined welcome always sends — it carries transactional
          // Synap/FAQ content — even for opted-out families.
          const { subject, html, from } = combinedWelcomeEmail(ctx);
          const status = await sendOnce({
            dedupeKey: `thank_you:${paidEnrollmentId}`,
            emailType: 'combined_welcome',
            enrollmentId: paidEnrollmentId,
            to: recipients(ctx),
            from,
            subject,
            html,
          });
          if (status === 'sent') {
            await supabase.from('email_log').insert(
              supersededSteps.map((s) => ({
                dedupe_key: `${s.type}:${paidEnrollmentId}`,
                email_type: 'superseded_by_welcome',
                enrollment_id: paidEnrollmentId,
                recipients: recipients(ctx),
              }))
            );
          }
        } else if (!enrollment.marketingOptOut) {
          // Thank-you is a relationship email — suppressed on opt-out.
          const { subject, html, from } = thankYouEmail(ctx);
          await sendOnce({
            dedupeKey: `thank_you:${paidEnrollmentId}`,
            emailType: 'thank_you',
            enrollmentId: paidEnrollmentId,
            to: recipients(ctx),
            from,
            subject,
            html,
          });
        }
      }
    } catch (emailErr) {
      console.error('Welcome email failed:', emailErr);
    }
  }

  return NextResponse.json({ received: true });
}
