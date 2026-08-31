import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin as supabase } from "../../../utils/supabase-admin"
import { checkClaimToken, loadClassBundles } from '../../../utils/lifecycle'

// The link inside a waitlist offer email. Validates the signed token and the
// 48h window, then creates a Stripe checkout session for the held enrollment
// and redirects straight into payment. Class name and price come from the
// database — nothing sensitive rides in the URL.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const enrollmentId = url.searchParams.get('e')
  const token = url.searchParams.get('t')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // PL-149: an aged-out link is a real family with an old email — send
  // them to the friendly page, not the generic one.
  const tokenState = enrollmentId && token ? checkClaimToken(enrollmentId, token) : 'invalid'
  if (tokenState === 'expired') {
    return NextResponse.redirect(`${baseUrl}/link-help?reason=expired`, 303)
  }
  if (!enrollmentId || !token || tokenState !== 'ok') {
    // PL-70b: friendly landings for humans, never raw JSON.
    return NextResponse.redirect(`${baseUrl}/link-help`, 303)
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, class_id, payment_status, waitlist_offer_expires_at, students(families(parent_email))')
    .eq('id', enrollmentId)
    .single()

  if (!enrollment) {
    return NextResponse.redirect(`${baseUrl}/link-help`, 303)
  }
  if (enrollment.payment_status === 'Paid') {
    return NextResponse.redirect(`${baseUrl}/success?already_paid=1`, 303)
  }
  if (
    enrollment.payment_status !== 'Waitlisted' ||
    !enrollment.waitlist_offer_expires_at ||
    new Date(enrollment.waitlist_offer_expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.redirect(`${baseUrl}/link-help?reason=offer-expired`, 303)
  }

  const [bundle] = await loadClassBundles(enrollment.class_id)
  if (!bundle) {
    return NextResponse.redirect(`${baseUrl}/link-help`, 303)
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const student: any = Array.isArray(enrollment.students) ? enrollment.students[0] : enrollment.students
  const family: any = Array.isArray(student?.families) ? student.families[0] : student?.families
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // PL-139: the Checkout session must die WITH the offer. Stripe's default
  // (~24h) outlives the 48-hour claim window, so a family could pay for a
  // spot the sweep had already rolled to the next family. Stripe requires
  // expires_at to sit between 30 minutes and 24 hours out, so clamp into
  // that range — the offer deadline wins whenever it falls inside it.
  const offerDeadlineMs = new Date(enrollment.waitlist_offer_expires_at).getTime()
  const expiresAt = Math.floor(
    Math.min(Date.now() + 24 * 3600_000 - 60_000, Math.max(Date.now() + 31 * 60_000, offerDeadlineMs)) / 1000
  )

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: family?.parent_email,
    // PL-431C: portal codes aren't Stripe codes — the box misled.
    allow_promotion_codes: false,
    expires_at: expiresAt,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${bundle.schoolLabel} — ${bundle.classType}` },
          unit_amount: Math.round(bundle.price * 100),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/register/${enrollment.class_id}?canceled=1`,
    metadata: { enrollment_id: enrollmentId, class_id: enrollment.class_id },
  })

  await supabase
    .from('enrollments')
    .update({ stripe_session_id: session.id })
    .eq('id', enrollmentId)

  return NextResponse.redirect(session.url as string, 303)
}
