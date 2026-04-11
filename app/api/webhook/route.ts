import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// 1. Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-04-10',
});

// 2. Initialize Supabase (Bypassing the frontend to talk directly to the database)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
);

export async function POST(req: Request) {
  const payload = await req.text();
  const sig = req.headers.get('Stripe-Signature') as string;

  let event;

  try {
    // 3. Verify the message is genuinely from Stripe using our secret password
    event = stripe.webhooks.constructEvent(
      payload, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed.', err.message);
    return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
  }

  // 4. If the payment was successful, update the database!
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_details?.email;

    if (email) {
        // Step A: Find the parent's Billing Account
        const { data: family } = await supabase.from('families').select('id').eq('parent_email', email).single();
        
        if (family) {
            // Step B: Find their Student
            const { data: student } = await supabase.from('students').select('id').eq('family_id', family.id).single();
            
            if (student) {
                // Step C: Change 'Pending Checkout' to 'Paid'
                const { error } = await supabase
                  .from('enrollments')
                  .update({ payment_status: 'Paid' })
                  .eq('student_id', student.id)
                  .eq('payment_status', 'Pending Checkout');
                  
                if (!error) console.log(`✅ Successfully marked enrollment as Paid for ${email}`);
            }
        }
    }
  }

  return NextResponse.json({ received: true });
}