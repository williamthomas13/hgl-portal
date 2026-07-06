import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Stripe client. We don't pin apiVersion here — the installed SDK
// version ships with a default that matches its TypeScript types.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// Backend Supabase client so we can stamp the session id onto the enrollment.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      className,
      price,
      customerEmail,
      classId,
      enrollmentId,
      packageId,
    }: {
      className: string;
      price: number;
      customerEmail: string;
      classId: string;
      enrollmentId: string;
      packageId?: string | null;
    } = body;

    if (!enrollmentId) {
      return NextResponse.json(
        { error: 'Missing enrollmentId — can\'t reliably track payment back to enrollment.' },
        { status: 400 }
      );
    }

    // Base URL for redirects. Set NEXT_PUBLIC_APP_URL in env
    // (local: http://localhost:3000, production: https://hgl-portal.vercel.app
    // or eventually https://portal.highergroundlearning.com).
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      'http://localhost:3000';

    const lineItems: { price_data: { currency: string; product_data: { name: string }; unit_amount: number }; quantity: number }[] = [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: className },
          unit_amount: Math.round(Number(price) * 100),
        },
        quantity: 1,
      },
    ];

    // Optional pre-class tutoring add-on: joins the class as a second line
    // item in the same checkout session. Price always comes from the
    // packages table — never from the client.
    if (packageId) {
      const { data: pkg, error: pkgError } = await supabase
        .from('tutoring_packages')
        .select('id, name, package_price, phase, active')
        .eq('id', packageId)
        .eq('phase', 'pre_class')
        .eq('active', true)
        .single();
      if (pkgError || !pkg) {
        return NextResponse.json({ error: 'Tutoring package not found.' }, { status: 400 });
      }
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `${pkg.name} — 1-on-1 Tutoring` },
          unit_amount: Math.round(Number(pkg.package_price) * 100),
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: customerEmail,
      line_items: lineItems,
      mode: 'payment',
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/register/${classId}?canceled=1`,
      // The critical link: Stripe carries these identifiers back on the webhook,
      // so we can update the exact enrollment regardless of email collisions.
      metadata: {
        enrollment_id: enrollmentId,
        class_id: classId,
        ...(packageId ? { package_id: packageId } : {}),
      },
    });

    // Stamp the Stripe session id onto the enrollment immediately so the
    // webhook has a deterministic lookup key.
    const { error: stampError } = await supabase
      .from('enrollments')
      .update({ stripe_session_id: session.id })
      .eq('id', enrollmentId);

    if (stampError) {
      console.error('Failed to stamp stripe_session_id on enrollment:', stampError.message);
      // Not fatal for the user — the webhook can still match on metadata.enrollment_id.
    }

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown checkout error';
    console.error('Stripe Checkout error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
