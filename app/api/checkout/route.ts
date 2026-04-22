import { NextResponse } from 'next/server';
import Stripe from 'stripe';

// We initialize Stripe securely on the backend using your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-04-10', // Standardizes the API version for TypeScript
});

export async function POST(request: Request) {
  try {
    // 1. Receive the class details from our frontend registration form
    const body = await request.json();
    const { className, price, customerEmail, classId } = body;

    // 2. Ask Stripe to generate a Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: customerEmail,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: className, 
            },
            unit_amount: price * 100, 
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://hgl-portal.vercel.app/success', 
      cancel_url: 'https://hgl-portal.vercel.app/',
    }); // <-- THIS WAS MISSING!

    // 3. Send the secure Stripe URL back to the frontend
    return NextResponse.json({ url: session.url });

  } catch (err: any) {
    console.error("Stripe Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}