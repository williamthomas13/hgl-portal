import {
  addonPageUrlFor,
  emailContext,
  loadClassBundles,
  loadTutoringPackages,
} from './lifecycle'
import { supabaseAdmin as supabase } from './supabase-admin'
import { renderEmail } from './comms-db-render'
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

  // PL-155c: Preview must show what would ACTUALLY be sent. This used to
  // call the code twins directly, so a template Scarlett had published and
  // made live previewed as the old hard-coded copy — the exact drift the
  // twin system exists to prevent, on the one surface built for checking
  // copy. renderEmail() serves the live registry body when there is one and
  // falls back to the same code twin when there isn't, which is precisely
  // what the pipeline does at send time.
  const wrap = async (
    templateKey: string,
    audienceForRender: Audience,
    fallback: () => Rendered,
    emailType: string
  ) => ({ ...(await renderEmail(templateKey, ctx, audienceForRender, {}, fallback)), emailType })

  switch (row.template_key) {
    case 'E0_CONFIRM_PARENT':
      return wrap('E0_CONFIRM_PARENT', 'parent', () => parentConfirmationEmail(ctx), 'parent_confirmation')
    case 'E0_CONFIRM_STUDENT':
      return wrap('E0_CONFIRM_STUDENT', 'student', () => studentConfirmationEmail(ctx), 'student_confirmation')
    case 'PR1':
    case 'PR2':
    case 'PR3':
    case 'PR4':
      return wrap(row.template_key, 'parent', () => paymentReminderEmail(ctx, Number(row.template_key.slice(2))), 'payment_reminder')
    case 'E1_THANKS':
      return wrap('E1_THANKS', 'parent', () => thankYouEmail(ctx), 'thank_you')
    case 'E2_DIAG_PARENT':
      return wrap('E2_DIAG_PARENT', 'parent', () => synapAccessParentEmail(ctx), 'synap_access')
    case 'E2_DIAG_STUDENT':
      return wrap('E2_DIAG_STUDENT', 'student', () => synapAccessStudentEmail(ctx), 'synap_access')
    case 'E3_VFAQ':
      return wrap('E3_VFAQ', audience, () => faqEmail(ctx, audience), 'faq')
    case 'E4_CLASS_DETAILS':
      return wrap('E4_CLASS_DETAILS', audience, () => classDetailsEmail(ctx, audience), 'class_details')
    case 'E5_LOCATION':
      return wrap('E5_LOCATION', audience, () => locationReminderEmail(ctx, audience), 'location_reminder')
    case 'E6_DIAG2':
      return wrap('E6_DIAG2', audience, () => secondDiagnosticEmail(ctx, audience), 'second_diagnostic')
    case 'E7_REVIEW':
      return wrap('E7_REVIEW', 'parent', () => reviewRequestEmail(ctx), 'review_request')
    case 'E8_POSTCLASS_TUTORING': {
      const { post } = await loadTutoringPackages()
      return wrap('E8_POSTCLASS_TUTORING', audience, () => tutoringOfferEmail(ctx, post, audience), 'tutoring_offer')
    }
    case 'E9_UPSELL': {
      const { pre } = await loadTutoringPackages()
      if (pre.length === 0) return null
      return wrap('E9_UPSELL', 'parent', () => tutoringUpsellEmail(ctx, pre, addonPageUrlFor(enrollment.id)), 'tutoring_upsell')
    }
    case 'LR_WELCOME':
      return wrap('LR_WELCOME', audience, () => lateRegistrationWelcomeEmail(ctx, audience), 'late_welcome')
    default:
      return null
  }
}
