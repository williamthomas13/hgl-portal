import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin as supabase } from "../../utils/supabase-admin"
import { loadClassBundles, verifyResumeToken, ADMIN_EMAIL } from '../../utils/lifecycle'
import { sendAdminAlert } from '../../utils/email'

// "Finalize Registration" button in payment reminders PR1–4. Creates a fresh
// Stripe checkout session for the still-Pending enrollment and redirects
// straight into payment. Signed per-enrollment token, price from the DB.
//
// PL-52: the rebuilt checkout carries the SAME line items the parent
// originally built — the add-on selection persists on the enrollment
// (pending_package_id), not just in the abandoned Stripe session. If the
// rebuilt total differs from what they originally saw
// (pending_checkout_total), the Ops Director is alerted rather than the
// parent being silently charged a different amount.

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
    // PL-60: expired links land on a friendly restart page, never a dead
    // button — the register page reads ?expired=1 and explains.
    return NextResponse.redirect(`${baseUrl}/register/${bundle.slug ?? bundle.id}?expired=1`, 303)
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: 'usd',
        product_data: { name: `${bundle.schoolLabel} ${bundle.classType}` },
        unit_amount: Math.round(bundle.price * 100),
      },
      quantity: 1,
    },
  ]

  // PL-52: rebuild the parent's original cart. The pending selection lives on
  // the enrollment; price and validity always come from the packages table.
  const { data: pending } = await supabase
    .from('enrollments')
    .select('pending_package_id, pending_checkout_total')
    .eq('id', enrollmentId)
    .maybeSingle()
  let packageId: string | null = pending?.pending_package_id ?? null
  if (packageId) {
    const { data: pkg } = await supabase
      .from('tutoring_packages')
      .select('id, name, package_price, phase, active')
      .eq('id', packageId)
      .eq('phase', 'pre_class')
      .eq('active', true)
      .maybeSingle()
    if (pkg) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `${pkg.name} — 1-on-1 Tutoring` },
          unit_amount: Math.round(Number(pkg.package_price) * 100),
        },
        quantity: 1,
      })
    } else {
      // Package retired since they picked it — never silently charge for it,
      // never silently drop it either: proceed class-only and tell the Ops
      // Director so the family hears from a human.
      packageId = null
      await sendAdminAlert({
        dedupeKey: `resume_pkg_gone:${enrollmentId}`,
        adminEmail: ADMIN_EMAIL,
        subject: 'Resume-payment: selected tutoring package no longer available',
        body: `<p>Enrollment <code>${enrollmentId}</code> resumed checkout, but the tutoring
          package they originally selected (<code>${pending?.pending_package_id}</code>) is no
          longer active. The rebuilt checkout is class-only — reach out to the family about
          their tutoring hours.</p>`,
        enrollmentId,
      }).catch((e) => console.error('resume alert failed:', e))
    }
  }

  // PL-52 guard: compare the rebuilt total with what the parent originally
  // built. A price change between selection and resume must be a human
  // conversation, not a silent different charge — alert, then proceed with
  // the current (DB-priced) cart.
  const rebuiltTotal = lineItems.reduce((sum, li) => sum + (li.price_data?.unit_amount ?? 0), 0) / 100
  const originalTotal = pending?.pending_checkout_total != null ? Number(pending.pending_checkout_total) : null
  if (originalTotal != null && Math.abs(rebuiltTotal - originalTotal) > 0.005) {
    await sendAdminAlert({
      dedupeKey: `resume_total_mismatch:${enrollmentId}:${Math.round(rebuiltTotal * 100)}`,
      adminEmail: ADMIN_EMAIL,
      subject: 'Resume-payment total differs from the original checkout',
      body: `<p>Enrollment <code>${enrollmentId}</code> resumed checkout at
        <strong>$${rebuiltTotal.toFixed(2)}</strong>, but the cart they originally built was
        <strong>$${originalTotal.toFixed(2)}</strong> (a price changed in between, or an add-on
        became unavailable). The checkout proceeded at the current price — double-check the
        charge and follow up with the family if needed.</p>`,
      enrollmentId,
    }).catch((e) => console.error('resume alert failed:', e))
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: enrollment.parentEmail,
    allow_promotion_codes: true,
    line_items: lineItems,
    mode: 'payment',
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/register/${bundle.id}?canceled=1`,
    metadata: {
      enrollment_id: enrollmentId,
      class_id: bundle.id,
      ...(packageId ? { package_id: packageId } : {}),
    },
  })

  await supabase
    .from('enrollments')
    .update({ stripe_session_id: session.id })
    .eq('id', enrollmentId)

  return NextResponse.redirect(session.url as string, 303)
}
