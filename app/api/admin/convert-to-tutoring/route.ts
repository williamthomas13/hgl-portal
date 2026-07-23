import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { availabilityUrlFor } from '../../../utils/lifecycle'
import { renderRegistered } from '../../../utils/comms-registered'
import {
  contactBlockHtml,
  contactFrom,
  conversionTermsHtml,
  cxTutoringStartEmail,
  loadContactInfo,
  money,
} from '../../../utils/tutoring-emails'
import { ensureStripeCustomer } from '../../../utils/tutoring-stripe'
import { sendOnce } from '../../../utils/email'

// PL-76: one-click "Convert to 1-on-1 tutoring" on a cancelled enrollment —
// the glue between the family's CX reply ("we want the tutoring option") and
// the pipeline that already exists. Credit lands as a Stripe CUSTOMER
// BALANCE (future tutoring invoices consume it automatically — no bespoke
// discount logic), mirrored on the enrollment columns as the record Kelsie
// can reconcile/adjust; the family gets the CX-T availability request (the
// PL-53 tokenized page), and from there it's the standard availability →
// wizard → approval pipeline. Idempotent: a second click never re-credits —
// it offers to re-send the availability email instead (resend: true).

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { enrollmentId?: string; resend?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.enrollmentId) return NextResponse.json({ error: 'Missing enrollment.' }, { status: 400 })

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select(
      `id, payment_status, class_cancelled, amount_paid, converted_to_tutoring_at,
       tutoring_credit_amount, stripe_credit_txn_id, cancellation_offer_hours,
       students ( id, first_name, last_name,
         families ( id, parent_first_name, parent_last_name, parent_email,
                    billing_email, billing_cc_emails, stripe_customer_id ) ),
       classes ( id, class_type, schools ( nickname ) )`
    )
    .eq('id', body.enrollmentId)
    .maybeSingle()
  if (!enrollment) return NextResponse.json({ error: 'Enrollment not found.' }, { status: 404 })

  const student: any = one(enrollment.students)
  const family: any = one(student?.families)
  const cls: any = one(enrollment.classes)
  const school: any = one(cls?.schools)
  if (!student || !family?.parent_email) {
    return NextResponse.json({ error: 'The family has no parent email on file.' }, { status: 400 })
  }
  if (!enrollment.class_cancelled) {
    return NextResponse.json({ error: 'This enrollment is not on a cancelled class.' }, { status: 400 })
  }
  if (!['Paid', 'Completed'].includes(enrollment.payment_status)) {
    return NextResponse.json(
      { error: 'Only a paid enrollment converts — this one never paid.' },
      { status: 400 }
    )
  }

  const classLabel = `${school?.nickname ?? 'HGL'} ${cls?.class_type ?? 'class'}`
  const paid = Number(enrollment.amount_paid ?? 0)
  const alreadyConverted = Boolean(enrollment.converted_to_tutoring_at)
  // PL-84: the persisted hours offer decides the conversion shape. Hours →
  // an add-on hours package (the authoritative record: balance, package-
  // covered proposals, #8b hours remaining). Dollars → ONLY when the
  // cancellation carried no hours offer.
  const offerHours = Number(enrollment.cancellation_offer_hours ?? 0) || null

  // Second click without explicit resend: report state, never re-credit.
  if (alreadyConverted && !body.resend) {
    return NextResponse.json({
      ok: true,
      already: true,
      offerHours,
      creditAmount: Number(enrollment.tutoring_credit_amount ?? paid),
    })
  }

  let creditAmount = Number(enrollment.tutoring_credit_amount ?? paid)
  if (!alreadyConverted) {
    if (!(paid > 0)) {
      return NextResponse.json({ error: 'No recorded paid amount to credit.' }, { status: 400 })
    }
    if (offerHours) {
      // Hours path: stamp first (the idempotency gate), then mint the hours
      // package. If a concurrent click won the stamp, do nothing.
      const { data: stamped } = await supabase
        .from('enrollments')
        .update({
          converted_to_tutoring_at: new Date().toISOString(),
          cancellation_outcome: 'converted',
        })
        .eq('id', enrollment.id)
        .is('converted_to_tutoring_at', null)
        .select('id')
      if (!stamped || stamped.length === 0) {
        return NextResponse.json({ ok: true, already: true, offerHours, creditAmount })
      }
      const { error: addonError } = await supabase.from('enrollment_addons').insert({
        enrollment_id: enrollment.id,
        package_id: null,
        hours: offerHours,
        price_paid: paid,
        source: 'cancellation_conversion',
      })
      if (addonError) {
        // Un-stamp so a retry can mint the package — nothing external moved.
        await supabase
          .from('enrollments')
          .update({ converted_to_tutoring_at: null, cancellation_outcome: null })
          .eq('id', enrollment.id)
        return NextResponse.json(
          { error: `Could not record the hours package: ${addonError.message}` },
          { status: 500 }
        )
      }
    } else {
      // No hours offer on the cancellation record — dollar-credit fallback
      // (the original PL-76 path). Stripe customer credit balance: NEGATIVE
      // balance = credit that future invoices consume automatically.
      const customerId = await ensureStripeCustomer(family)
      const txn = await stripe.customers.createBalanceTransaction(customerId, {
        amount: -Math.round(paid * 100),
        currency: 'usd',
        description: `Cancellation credit — ${classLabel} (enrollment ${enrollment.id})`,
      })
      creditAmount = paid
      const { data: stamped } = await supabase
        .from('enrollments')
        .update({
          converted_to_tutoring_at: new Date().toISOString(),
          tutoring_credit_amount: paid,
          stripe_credit_txn_id: txn.id,
          cancellation_outcome: 'converted',
        })
        .eq('id', enrollment.id)
        .is('converted_to_tutoring_at', null)
        .select('id')
      if (!stamped || stamped.length === 0) {
        // A concurrent click won the race and already credited — reverse ours.
        await stripe.customers
          .createBalanceTransaction(customerId, {
            amount: Math.round(paid * 100),
            currency: 'usd',
            description: `Reversal (duplicate conversion click) — ${classLabel}`,
          })
          .catch((e) => console.error('duplicate-credit reversal failed — fix in Stripe:', e))
        return NextResponse.json({ ok: true, already: true, creditAmount })
      }
    }
  }

  // CX-T availability request (registry copy when live; code twin otherwise).
  const contact = await loadContactInfo()
  const availabilityLink = availabilityUrlFor(family.id)
  const email = await renderRegistered(
    'CX_TUTORING_START',
    {
      parentFirstName: family.parent_first_name ?? 'there',
      parentEmail: family.parent_email,
      studentFirstName: student.first_name,
      schoolNickname: school?.nickname,
      classType: cls?.class_type,
    },
    {
      creditAmount: money(creditAmount),
      // PL-84: hours terms when the offer exists; credit wording otherwise.
      conversionTermsBlock: conversionTermsHtml({
        studentFirst: student.first_name,
        classLabel,
        offerHours,
        creditAmount: money(creditAmount),
      }),
      availabilityLink,
      contactBlock: contactBlockHtml(contact),
    },
    () =>
      cxTutoringStartEmail({
        parentFirst: family.parent_first_name ?? null,
        studentFirst: student.first_name,
        classLabel,
        creditAmount: money(creditAmount),
        offerHours,
        availabilityLink,
        contact,
      })
  )
  const sent = await sendOnce({
    // Timestamped: a deliberate resend is a feature, like the agreement chase.
    dedupeKey: `cx_tutoring_start:${enrollment.id}:${Date.now()}`,
    emailType: 'cx_tutoring_start',
    templateKey: 'CX_TUTORING_START',
    enrollmentId: enrollment.id,
    to: [family.parent_email],
    cc: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
    from: contactFrom(contact),
    subject: email.subject,
    html: email.html,
  })
  if (sent === 'failed') {
    return NextResponse.json(
      { error: 'Credit recorded, but the email failed — check the comms dashboard and resend.' },
      { status: 500 }
    )
  }
  return NextResponse.json({ ok: true, offerHours, creditAmount, resent: alreadyConverted })
}
