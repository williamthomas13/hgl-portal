import Stripe from 'stripe'
import { supabaseAdmin as supabase } from './supabase-admin'
import { availabilityUrlFor } from './lifecycle'
import { renderRegistered } from './comms-registered'
import {
  contactBlockHtml,
  contactFrom,
  conversionTermsHtml,
  cxTutoringStartEmail,
  loadContactInfo,
  money,
} from './tutoring-emails'
import { ensureStripeCustomer } from './tutoring-stripe'
import { sendOnce } from './email'

// PL-86: ONE conversion path for both actors. The PL-84 machinery (hours
// package first, dollar Stripe credit only as the no-offer fallback) is
// extracted here so the family's self-serve confirm and the Ops Director's
// admin one-click can never drift — first-action-wins falls out of the
// converted_to_tutoring_at stamp both paths guard on. `by` records who
// converted ('family' | staff email).

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export type ConversionRecord = {
  enrollment: any
  student: any
  family: any
  classLabel: string
  paid: number
  offerHours: number | null
  creditAmount: number
  alreadyConverted: boolean
  convertedBy: string | null
  convertedAt: string | null
}

export async function loadConversionRecord(enrollmentId: string): Promise<ConversionRecord | { error: string; status: number }> {
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select(
      `id, payment_status, class_cancelled, amount_paid, converted_to_tutoring_at, converted_by,
       tutoring_credit_amount, stripe_credit_txn_id, cancellation_offer_hours,
       students ( id, first_name, last_name,
         families ( id, parent_first_name, parent_last_name, parent_email,
                    billing_email, billing_cc_emails, stripe_customer_id ) ),
       classes ( id, class_type, schools ( nickname ) )`
    )
    .eq('id', enrollmentId)
    .maybeSingle()
  if (!enrollment) return { error: 'Enrollment not found.', status: 404 }
  const student: any = one(enrollment.students)
  const family: any = one(student?.families)
  const cls: any = one(enrollment.classes)
  const school: any = one(cls?.schools)
  if (!student || !family?.parent_email) return { error: 'The family has no parent email on file.', status: 400 }
  if (!enrollment.class_cancelled) return { error: 'This enrollment is not on a cancelled class.', status: 400 }
  if (!['Paid', 'Completed'].includes(enrollment.payment_status)) {
    return { error: 'Only a paid enrollment converts — this one never paid.', status: 400 }
  }
  const paid = Number(enrollment.amount_paid ?? 0)
  return {
    enrollment,
    student,
    family,
    classLabel: `${school?.nickname ?? 'HGL'} ${cls?.class_type ?? 'class'}`,
    paid,
    offerHours: Number(enrollment.cancellation_offer_hours ?? 0) || null,
    creditAmount: Number(enrollment.tutoring_credit_amount ?? paid),
    alreadyConverted: Boolean(enrollment.converted_to_tutoring_at),
    convertedBy: enrollment.converted_by ?? null,
    convertedAt: enrollment.converted_to_tutoring_at ?? null,
  }
}

/** Mint the conversion (PL-84 machinery). Idempotent per enrollment —
 *  the stamp guard makes first-action-wins true across both paths. */
export async function convertEnrollmentToTutoring(
  record: ConversionRecord,
  by: string
): Promise<{ ok: true; already: boolean } | { ok: false; error: string; status: number }> {
  const { enrollment, family, classLabel, paid, offerHours } = record
  if (record.alreadyConverted) return { ok: true, already: true }
  if (!(paid > 0)) return { ok: false, error: 'No recorded paid amount to convert.', status: 400 }

  if (offerHours) {
    const { data: stamped } = await supabase
      .from('enrollments')
      .update({
        converted_to_tutoring_at: new Date().toISOString(),
        cancellation_outcome: 'converted',
        converted_by: by,
      })
      .eq('id', enrollment.id)
      .is('converted_to_tutoring_at', null)
      .select('id')
    if (!stamped || stamped.length === 0) return { ok: true, already: true }
    const { error: addonError } = await supabase.from('enrollment_addons').insert({
      enrollment_id: enrollment.id,
      package_id: null,
      hours: offerHours,
      price_paid: paid,
      source: 'cancellation_conversion',
    })
    if (addonError) {
      await supabase
        .from('enrollments')
        .update({ converted_to_tutoring_at: null, cancellation_outcome: null, converted_by: null })
        .eq('id', enrollment.id)
      return { ok: false, error: `Could not record the hours package: ${addonError.message}`, status: 500 }
    }
    return { ok: true, already: false }
  }

  // Dollar-credit fallback (no hours offer on the cancellation record).
  const customerId = await ensureStripeCustomer(family)
  const txn = await stripe.customers.createBalanceTransaction(customerId, {
    amount: -Math.round(paid * 100),
    currency: 'usd',
    description: `Cancellation credit — ${classLabel} (enrollment ${enrollment.id})`,
  })
  const { data: stamped } = await supabase
    .from('enrollments')
    .update({
      converted_to_tutoring_at: new Date().toISOString(),
      tutoring_credit_amount: paid,
      stripe_credit_txn_id: txn.id,
      cancellation_outcome: 'converted',
      converted_by: by,
    })
    .eq('id', enrollment.id)
    .is('converted_to_tutoring_at', null)
    .select('id')
  if (!stamped || stamped.length === 0) {
    await stripe.customers
      .createBalanceTransaction(customerId, {
        amount: Math.round(paid * 100),
        currency: 'usd',
        description: `Reversal (duplicate conversion) — ${classLabel}`,
      })
      .catch((e) => console.error('duplicate-credit reversal failed — fix in Stripe:', e))
    return { ok: true, already: true }
  }
  return { ok: true, already: false }
}

/** CX_TUTORING_START, exactly once ever per enrollment (fixed dedupe key) —
 *  the receipt when Kelsie converts from a reply, or the +1d follow-up when
 *  a self-serve family hasn't shared availability. A deliberate human
 *  resend passes its own timestamped key. */
export async function sendCxTutoringStart(
  record: ConversionRecord,
  opts: { dedupeKey?: string; senderEmail?: string } = {}
): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed'> {
  const { enrollment, student, family, classLabel, offerHours } = record
  const creditAmount = money(record.creditAmount)
  const contact = await loadContactInfo()
  const availabilityLink = availabilityUrlFor(family.id)
  const email = await renderRegistered(
    'CX_TUTORING_START',
    {
      parentFirstName: family.parent_first_name ?? 'there',
      parentEmail: family.parent_email,
      studentFirstName: student.first_name,
    },
    {
      creditAmount,
      conversionTermsBlock: conversionTermsHtml({
        studentFirst: student.first_name,
        classLabel,
        offerHours,
        creditAmount,
      }),
      availabilityLink,
      contactBlock: contactBlockHtml(contact),
    },
    () =>
      cxTutoringStartEmail({
        parentFirst: family.parent_first_name ?? null,
        studentFirst: student.first_name,
        classLabel,
        creditAmount,
        offerHours,
        availabilityLink,
        contact,
      })
  )
  return sendOnce({
    dedupeKey: opts.dedupeKey ?? `cx_tutoring_start:${enrollment.id}`,
    emailType: 'cx_tutoring_start',
    templateKey: 'CX_TUTORING_START',
    enrollmentId: enrollment.id,
    to: [family.parent_email],
    cc: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
    from: contactFrom(contact),
    subject: email.subject,
    html: email.html,
    senderEmail: opts.senderEmail,
  })
}

// PL-86: self-serve conversions that never reached the availability grid —
// one CX_TUTORING_START follow-up at +1d (the fixed dedupe key makes
// "exactly once ever" structural; families who shared times get nothing).
// Called by the hourly cron.
export async function sweepConversionFollowups(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const { data: rows } = await supabase
    .from('enrollments')
    .select('id, students ( family_id )')
    .eq('converted_by', 'family')
    .not('converted_to_tutoring_at', 'is', null)
    .lte('converted_to_tutoring_at', cutoff)
  let sent = 0
  for (const row of rows ?? []) {
    const familyId = (one(row.students) as any)?.family_id
    if (!familyId) continue
    const { data: students } = await supabase.from('students').select('id').eq('family_id', familyId)
    const ids = (students ?? []).map((s) => s.id)
    const { count } = ids.length
      ? await supabase
          .from('student_availability')
          .select('id', { count: 'exact', head: true })
          .in('student_id', ids)
      : { count: 0 }
    if ((count ?? 0) > 0) continue // they shared — no nudge, ever
    const record = await loadConversionRecord(row.id)
    if ('error' in record) continue
    const status = await sendCxTutoringStart(record) // fixed once-ever key
    if (status === 'sent') sent++
  }
  return sent
}
