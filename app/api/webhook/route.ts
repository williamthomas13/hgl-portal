import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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
      ? await enrollmentQuery.eq('id', enrollmentId).select('id')
      : await enrollmentQuery.eq('stripe_session_id', sessionId).select('id');

    if (error) {
      console.error('Failed to mark enrollment paid:', error.message);
    } else if (!data || data.length === 0) {
      console.warn(
        `Webhook completed for session ${sessionId} but no enrollment matched. ` +
          `enrollment_id=${enrollmentId ?? 'none'}`
      );
    } else {
      console.log(`Marked enrollment ${data[0].id} paid (session ${sessionId}).`);
    }
  }

  return NextResponse.json({ received: true });
}
