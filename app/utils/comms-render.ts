import {
  addonPageUrlFor,
  emailContext,
  loadClassBundles,
  loadTutoringPackages,
} from './lifecycle'
import { supabaseAdmin as supabase } from './supabase-admin'
import {
  classDetailsEmail,
  faqEmail,
  lateRegistrationWelcomeEmail,
  locationReminderEmail,
  parentConfirmationEmail,
  paymentReminderEmail,
  reviewRequestEmail,
  secondDiagnosticEmail,
  studentConfirmationEmail,
  synapAccessParentEmail,
  synapAccessStudentEmail,
  thankYouEmail,
  tutoringOfferEmail,
  tutoringUpsellEmail,
  type Audience,
  type Rendered,
} from './email'

// Feature A3 render registry: turn an email_sends row back into the exact
// email the pipeline would send — for the dashboard's Preview ("renders the
// template with that enrollment's real variables") and Send now. Covers the
// enrollment-scoped pipeline templates; event-driven sends (waitlist offers,
// digests, cancellations, alerts) carry runtime state that can't be
// reconstructed from a row, so they return null and the UI says so.

export type RenderableRow = {
  dedupe_key: string
  template_key: string
  enrollment_id: string | null
}

export async function renderSendRow(
  row: RenderableRow
): Promise<{ subject: string; html: string; from?: string; emailType: string } | null> {
  if (!row.enrollment_id) return null

  const { data: enrollmentRow } = await supabase
    .from('enrollments')
    .select('class_id')
    .eq('id', row.enrollment_id)
    .single()
  if (!enrollmentRow?.class_id) return null

  const [bundle] = await loadClassBundles(enrollmentRow.class_id)
  const enrollment = bundle?.enrollments.find((e) => e.id === row.enrollment_id)
  if (!bundle || !enrollment) return null
  const ctx = emailContext(bundle, enrollment)
  const audience: Audience = /_s:/.test(row.dedupe_key) ? 'student' : 'parent'

  const wrap = (r: Rendered, emailType: string) => ({ ...r, emailType })

  switch (row.template_key) {
    case 'E0_CONFIRM_PARENT':
      return wrap(parentConfirmationEmail(ctx), 'parent_confirmation')
    case 'E0_CONFIRM_STUDENT':
      return wrap(studentConfirmationEmail(ctx), 'student_confirmation')
    case 'PR1':
    case 'PR2':
    case 'PR3':
    case 'PR4':
      return wrap(paymentReminderEmail(ctx, Number(row.template_key.slice(2))), 'payment_reminder')
    case 'E1_THANKS':
      return wrap(thankYouEmail(ctx), 'thank_you')
    case 'E2_DIAG_PARENT':
      return wrap(synapAccessParentEmail(ctx), 'synap_access')
    case 'E2_DIAG_STUDENT':
      return wrap(synapAccessStudentEmail(ctx), 'synap_access')
    case 'E3_VFAQ':
      return wrap(faqEmail(ctx, audience), 'faq')
    case 'E4_CLASS_DETAILS':
      return wrap(classDetailsEmail(ctx, audience), 'class_details')
    case 'E5_LOCATION':
      return wrap(locationReminderEmail(ctx, audience), 'location_reminder')
    case 'E6_DIAG2':
      return wrap(secondDiagnosticEmail(ctx, audience), 'second_diagnostic')
    case 'E7_REVIEW':
      return wrap(reviewRequestEmail(ctx), 'review_request')
    case 'E8_POSTCLASS_TUTORING': {
      const { post } = await loadTutoringPackages()
      return wrap(tutoringOfferEmail(ctx, post, audience), 'tutoring_offer')
    }
    case 'E9_UPSELL': {
      const { pre } = await loadTutoringPackages()
      if (pre.length === 0) return null
      return wrap(tutoringUpsellEmail(ctx, pre, addonPageUrlFor(enrollment.id)), 'tutoring_upsell')
    }
    case 'LR_WELCOME':
      return wrap(lateRegistrationWelcomeEmail(ctx, audience), 'late_welcome')
    default:
      return null
  }
}
