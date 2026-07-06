import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin as supabase } from "../../../utils/supabase-admin"
import { loadClassBundles, localDate, verifyAddonToken } from '../../../utils/lifecycle'

// Buy button on the per-enrollment addon page (email #9). Creates an
// addon-only Stripe checkout session and redirects into payment. The webhook
// records the addon (addon_only metadata) without touching the enrollment's
// original payment fields. Pricing comes from the packages table; the window
// closes at the class's first session.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const enrollmentId = url.searchParams.get('e')
  const token = url.searchParams.get('t')
  const packageId = url.searchParams.get('p')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (!enrollmentId || !token || !packageId || !verifyAddonToken(enrollmentId, token)) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 })
  }

  const bundles = await loadClassBundles()
  const bundle = bundles.find((b) => b.enrollments.some((e) => e.id === enrollmentId))
  const enrollment = bundle?.enrollments.find((e) => e.id === enrollmentId)
  if (!bundle || !enrollment) {
    return NextResponse.json({ error: 'Enrollment not found.' }, { status: 404 })
  }
  if (enrollment.addons.length > 0) {
    return NextResponse.redirect(`${baseUrl}/addons/${enrollmentId}?t=${token}`, 303)
  }
  if (localDate(bundle.timezone) >= bundle.firstSession) {
    return NextResponse.json({ error: 'The pre-class offer has ended.' }, { status: 410 })
  }

  const { data: pkg } = await supabase
    .from('tutoring_packages')
    .select('id, name, package_price')
    .eq('id', packageId)
    .eq('phase', 'pre_class')
    .eq('active', true)
    .single()
  if (!pkg) {
    return NextResponse.json({ error: 'Package not found.' }, { status: 404 })
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: enrollment.parentEmail,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${pkg.name} — 1-on-1 Tutoring (${bundle.schoolLabel} — ${bundle.classType})` },
          unit_amount: Math.round(Number(pkg.package_price) * 100),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/addons/${enrollmentId}?t=${token}`,
    metadata: {
      enrollment_id: enrollmentId,
      package_id: pkg.id,
      addon_only: '1',
    },
  })

  return NextResponse.redirect(session.url as string, 303)
}
