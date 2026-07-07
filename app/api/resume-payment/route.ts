import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin as supabase } from "../../utils/supabase-admin"
import { loadClassBundles, verifyResumeToken } from '../../utils/lifecycle'

// "Finalize Registration" button in payment reminders PR1–4. Creates a fresh
// Stripe checkout session for the still-Pending enrollment and redirects
// straight into payment. Signed per-enrollment token, price from the DB.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const enrollmentId = url.searchParams.get('e')
  const token = url.searchParams.get('t')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (!enrollmentId || !token || !verifyResumeToken(enrollmentId, token)) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 })
  }

  const bundles = await loadClassBundles()
  const bundle = bundles.find((b) => b.enrollments.some((e) => e.id === enrollmentId))
  const enrollment = bundle?.enrollments.find((e) => e.id === enrollmentId)
  if (!bundle || !enrollment) {
    return NextResponse.json({ error: 'Registration not found.' }, { status: 404 })
  }
  if (bundle.status === 'cancelled') {
    // Cancelled class: never reopen a checkout (the enrollment was expired at
    // cancel time; this covers the race where a reminder link is clicked
    // mid-cancellation). The register page shows the full/no-waitlist state.
    return NextResponse.redirect(`${baseUrl}/register/${bundle.slug ?? bundle.id}`, 303)
  }
  if (enrollment.payment_status === 'Paid' || enrollment.payment_status === 'Completed') {
    return NextResponse.redirect(`${baseUrl}/success?already_paid=1`, 303)
  }
  if (enrollment.payment_status !== 'Pending') {
    // Expired: send them back to register fresh while spots remain.
    return NextResponse.redirect(`${baseUrl}/register/${bundle.id}?expired=1`, 303)
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: enrollment.parentEmail,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${bundle.schoolLabel} ${bundle.classType}` },
          unit_amount: Math.round(bundle.price * 100),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/register/${bundle.id}?canceled=1`,
    metadata: { enrollment_id: enrollmentId, class_id: bundle.id },
  })

  await supabase
    .from('enrollments')
    .update({ stripe_session_id: session.id })
    .eq('id', enrollmentId)

  return NextResponse.redirect(session.url as string, 303)
}
