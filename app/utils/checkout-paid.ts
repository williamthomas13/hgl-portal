import type Stripe from 'stripe'
import { supabaseAdmin as supabase } from './supabase-admin'
import { processQboQueue } from './qbo-sync'
import { renderEmail } from './comms-db-render'
import { runEnrollmentCommsPass } from './comms-inline'
import { sendInstructorMilestones } from './instructor-comms'
import { emailBaseUrl } from './base-url'
import {
  lateRegistrationWelcomeEmail,
  parentConfirmationEmail,
  registrationNotificationContent,
  sendAdminAlert,
  sendOnce,
  studentConfirmationEmail,
} from './email'
import {
  ADMIN_EMAIL,
  REGISTRATION_NOTIFY_EMAIL,
  SEQUENCE,
  emailContext,
  isDue,
  loadClassBundles,
  stepTargetDate,
} from './lifecycle'

// PL-92: the checkout.session.completed consequences, extracted from the
// webhook route so the admin "Attach this payment to enrollment X" action
// can run the EXACT same path — confirmation/LR emails, registration
// notification, milestone pings, sequence scheduling, PR cancellation, QBO
// sync — as if the webhook had matched. Everything inside is dedupe-keyed,
// so re-running is a no-op; the webhook passes next/server's after() as
// `defer`, the attach route awaits the deferred work itself.

/** Mode-aware Stripe dashboard link (test-mode objects need /test/). */
export function stripeDashboardUrl(path: string): string {
  const test = (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test')
  return `https://dashboard.stripe.com/${test ? 'test/' : ''}${path}`
}

// Durably record a purchased tutoring add-on. Idempotent: the
// (enrollment_id, package_id) unique constraint absorbs webhook retries.
// Returns the addon row id (inserted or pre-existing) so addon-only
// purchases can enqueue their QBO sale against it (Phase 6).
async function recordAddon(
  enrollmentId: string,
  packageId: string,
  stripeSessionId: string,
  paymentIntentId: string | null
): Promise<string | null> {
  const { data: pkg } = await supabase
    .from('tutoring_packages')
    .select('hours, package_price')
    .eq('id', packageId)
    .single()
  if (!pkg) {
    console.error(`Addon package ${packageId} not found for enrollment ${enrollmentId}`)
    return null
  }
  const { data, error } = await supabase
    .from('enrollment_addons')
    .insert([
      {
        enrollment_id: enrollmentId,
        package_id: packageId,
        hours: pkg.hours,
        price_paid: pkg.package_price,
        stripe_session_id: stripeSessionId,
        stripe_payment_intent_id: paymentIntentId,
      },
    ])
    .select('id')
  if (data?.[0]?.id) return data[0].id
  if (error && error.code !== '23505') {
    console.error(`Failed to record addon for enrollment ${enrollmentId}:`, error.message)
    return null
  }
  // Webhook retry: the row already exists — fetch it.
  const { data: existing } = await supabase
    .from('enrollment_addons')
    .select('id')
    .eq('enrollment_id', enrollmentId)
    .eq('package_id', packageId)
    .maybeSingle()
  return existing?.id ?? null
}

// Phase 6 (docs/PHASE6_SPEC.md §4/§5): enqueue a QBO sync row. Never blocks
// or fails the caller — QBO downtime must never affect checkout. Duplicate
// webhook deliveries insert-conflict away on (payment_intent, kind).
export async function enqueueQboSync(row: {
  enrollment_id: string
  enrollment_addon_id?: string | null
  stripe_payment_intent_id: string
  kind: 'sale' | 'refund'
  amount: number | null
}) {
  const { error } = await supabase.from('qbo_sync_log').insert([row])
  if (!error) return 'inserted'
  if (error.code === '23505') return 'duplicate'
  console.error(`QBO enqueue failed for ${row.kind} ${row.stripe_payment_intent_id}:`, error.message)
  return 'failed'
}

export type CheckoutOutcome = {
  outcome: 'addon_only' | 'matched' | 'mismatch' | 'paid_after_cancel'
  enrollmentId?: string
  problem?: string
}

export async function handleClassCheckoutCompleted(
  session: Stripe.Checkout.Session,
  opts: {
    defer: (fn: () => Promise<unknown>) => void
    /** PL-92 attach: match THIS enrollment instead of metadata/fallback. */
    overrideEnrollmentId?: string
    /** false → a mismatch returns quietly (the attach route reports its own error). */
    alertOnMismatch?: boolean
  }
): Promise<CheckoutOutcome> {
  const enrollmentId = opts.overrideEnrollmentId ?? session.metadata?.enrollment_id
  const packageId = session.metadata?.package_id
  const sessionId = session.id

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  // Addon-only purchase (from the #9 upsell page): the enrollment was
  // already paid — record the addon and leave the payment fields alone.
  // It is still portal revenue, so it gets its own QBO Sales Receipt.
  if (session.metadata?.addon_only === '1') {
    if (enrollmentId && packageId) {
      const addonId = await recordAddon(enrollmentId, packageId, sessionId, paymentIntentId)
      console.log(`Recorded addon-only purchase for enrollment ${enrollmentId}.`)
      if (addonId && paymentIntentId) {
        await enqueueQboSync({
          enrollment_id: enrollmentId,
          enrollment_addon_id: addonId,
          stripe_payment_intent_id: paymentIntentId,
          kind: 'sale',
          amount: session.amount_total != null ? session.amount_total / 100 : null,
        })
        opts.defer(() => processQboQueue())
      }
    }
    return { outcome: 'addon_only', enrollmentId }
  }

  // Primary match: the enrollment id we set in metadata (or the attach
  // override). Fallback: the stripe session id stamped before redirect.
  const enrollmentQuery = supabase.from('enrollments').update({
    payment_status: 'Paid',
    stripe_session_id: sessionId,
    stripe_payment_intent_id: paymentIntentId,
    paid_at: new Date().toISOString(),
    // Real charged total (class + any add-on) for the #0-P order summary.
    amount_paid: session.amount_total != null ? session.amount_total / 100 : null,
    // PL-52: the pending-cart marker has served its purpose.
    pending_package_id: null,
    pending_checkout_total: null,
  })

  const { data, error } = enrollmentId
    ? await enrollmentQuery.eq('id', enrollmentId).select('id, class_id, classes ( status )')
    : await enrollmentQuery.eq('stripe_session_id', sessionId).select('id, class_id, classes ( status )')

  if (error || !data || data.length === 0) {
    // Payment came in but we couldn't record it — the one failure the
    // admin must hear about immediately.
    const problem = error
      ? `Database error: ${error.message}`
      : `No enrollment matched (enrollment_id=${enrollmentId ?? 'none'}).`
    console.error(`Checkout match failed for session ${sessionId}: ${problem}`)
    if (opts.alertOnMismatch !== false) {
      // PL-92: the alert is a cockpit — the exact Stripe object (mode-aware
      // link), the consequences ledger, and the one-click match surface.
      const payerEmail = session.customer_details?.email ?? null
      const stripeLink = paymentIntentId
        ? stripeDashboardUrl(`payments/${paymentIntentId}`)
        : stripeDashboardUrl(`search?query=${encodeURIComponent(sessionId)}`)
      const matchLink = `${emailBaseUrl()}/admin/match-payment?session=${encodeURIComponent(sessionId)}${payerEmail ? `&email=${encodeURIComponent(payerEmail)}` : ''}`
      await sendAdminAlert({
        dedupeKey: `webhook_failure:${sessionId}`,
        adminEmail: ADMIN_EMAIL,
        templateKey: 'AL_WEBHOOK_FAILURE',
        subject: 'Stripe payment could not be matched to an enrollment',
        body: `<p>Stripe checkout session <code>${sessionId}</code> completed
          ${payerEmail ? ` (payer <strong>${payerEmail}</strong>)` : ''}, but the enrollment
          could not be updated.</p><p>${problem}</p>
          <p><strong>Because this payment isn't matched, none of this has happened yet:</strong>
          the enrollment still shows unpaid · no confirmation email went to the family · the
          class email sequence isn't scheduled · <strong>payment reminders for this family are
          NOT suppressed</strong> (they could be dunned despite having paid) · no QuickBooks
          receipt exists.</p>
          <p><strong>Nothing retries automatically.</strong> Once you match the payment (below),
          everything above happens on its own — confirmation, sequence, reminder cancellation,
          QuickBooks — exactly as if the webhook had matched.</p>
          <p style="margin:20px 0">
            <a href="${matchLink}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Match to an enrollment</a>
            &nbsp;&nbsp;<a href="${stripeLink}" style="color:#00AEEE">Open this payment in Stripe</a>
          </p>`,
      }).catch((e) => console.error('Admin alert failed:', e))
    }
    return { outcome: 'mismatch', problem }
  }

  const paidEnrollmentId = data[0].id
  const classId = data[0].class_id
  console.log(`Marked enrollment ${paidEnrollmentId} paid (session ${sessionId}).`)

  // Phase 6: money moved, so the sale must reach QuickBooks — even in the
  // paid-after-cancel race below (the refund receipt will pair with it).
  // The worker runs deferred; the caller never waits on QBO.
  if (paymentIntentId) {
    await enqueueQboSync({
      enrollment_id: paidEnrollmentId,
      stripe_payment_intent_id: paymentIntentId,
      kind: 'sale',
      amount: session.amount_total != null ? session.amount_total / 100 : null,
    })
    opts.defer(() => processQboQueue())
  } else {
    console.error(`No payment intent on session ${sessionId} — QBO sale not enqueued.`)
  }

  // Race guard (PHASE4_SPEC §12): a checkout opened before the class was
  // cancelled can complete after it. The payment is recorded (money moved —
  // that's the refund audit trail), but no welcome emails go out; the admin
  // refunds it in Stripe like the others.
  const classRel = data[0].classes as { status?: string } | { status?: string }[] | null
  const classStatus = (Array.isArray(classRel) ? classRel[0] : classRel)?.status
  if (classStatus === 'cancelled') {
    await supabase.from('enrollments').update({ class_cancelled: true }).eq('id', paidEnrollmentId)
    await sendAdminAlert({
      dedupeKey: `paid_after_cancel:${paidEnrollmentId}`,
      adminEmail: ADMIN_EMAIL,
      subject: 'Payment received for a CANCELLED class — refund needed',
      body: `<p>Enrollment <code>${paidEnrollmentId}</code> completed Stripe checkout
        (session <code>${sessionId}</code>) after its class was cancelled. No welcome email
        was sent. Issue the refund in the Stripe dashboard and reply to the family from the
        cancellation thread.</p>`,
    }).catch((e) => console.error('Admin alert failed:', e))
    return { outcome: 'paid_after_cancel', enrollmentId: paidEnrollmentId }
  }

  // Record the in-checkout tutoring add-on before loading the bundle so
  // the #0 confirmation recap includes it. PI stays null here — in-checkout
  // add-ons ride the enrollment's payment intent; only addon-only purchases
  // (their own checkout) stamp a PI, which is what refund matching keys on.
  if (packageId) {
    await recordAddon(paidEnrollmentId, packageId, sessionId, null)
  }

  // Welcome email: normally the thank-you; if the signup happened after
  // pre-start emails would already have fired, send one combined welcome
  // (thank-you + Synap + FAQ) instead and claim those steps' dedupe keys
  // so the sweep never re-sends them individually.
  // A failure here must not fail the caller (Stripe would keep retrying
  // an already-recorded payment).
  try {
    const [bundle] = await loadClassBundles(classId)
    const enrollment = bundle?.enrollments.find((e) => e.id === paidEnrollmentId)
    if (bundle && enrollment) {
      const ctx = emailContext(bundle, enrollment)

      // Registration notification (ADMIN email — replaces the old
      // Squarespace notification): once per PAID registration, with the
      // add-on and the class's running counts. The bundle was loaded after
      // the Paid update and recordAddon, so both are reflected.
      const paidCount = bundle.enrollments.filter(
        (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
      ).length
      const pendingCount = bundle.enrollments.filter((e) => e.payment_status === 'Pending').length
      const note = registrationNotificationContent({
        studentName: `${enrollment.studentFirstName} ${enrollment.studentLastName}`,
        label: `${bundle.schoolLabel} ${bundle.classType}`,
        schoolName: bundle.schoolName,
        addonNames: enrollment.addons.map((a) => `${a.name} (${a.hours}h)`),
        paid: paidCount,
        pending: pendingCount,
        minEnrollment: bundle.minEnrollment,
        capacity: bundle.capacity,
      })
      await sendAdminAlert({
        dedupeKey: `registration_notification:${paidEnrollmentId}`,
        adminEmail: REGISTRATION_NOTIFY_EMAIL,
        templateKey: 'AL_REGISTRATION',
        vars: {
          alertStudentName: `${enrollment.studentFirstName} ${enrollment.studentLastName}`,
          alertCounts:
            pendingCount > 0
              ? `${paidCount} enrolled + ${pendingCount} pending / ${bundle.minEnrollment} min / ${bundle.capacity} cap`
              : `${paidCount} enrolled / ${bundle.minEnrollment} min / ${bundle.capacity} cap`,
          schoolNickname: bundle.schoolLabel,
          classType: bundle.classType,
          schoolName: bundle.schoolName,
        },
        subject: note.subject,
        body: note.body,
        enrollmentId: paidEnrollmentId,
      })

      // PL-78: instant milestone pings (min met / class full) the moment a
      // payment crosses the line — PL-51 event-driven pattern; dedupe keys
      // make retries no-ops. Gated on comms_enabled inside.
      opts.defer(() =>
        sendInstructorMilestones(bundle).catch((e) =>
          console.error('instructor milestone ping failed (cron backstop):', e)
        )
      )

      // Late registration test: would the pre-start emails (#2/#3) already
      // have fired? If so, the LR welcome replaces the whole confirmation
      // flow (#0-P/#0-S spacing, #1, #2, #3) in one email per audience —
      // the parent variant carries the #0-style order summary.
      const supersededSteps = SEQUENCE.filter(
        (s) =>
          (s.type === 'synap_access' || s.type === 'faq') &&
          isDue(bundle.timezone, stepTargetDate(s, bundle), s.hour)
      )

      if (supersededSteps.length > 0) {
        // LR is transactional — always sends, even for opted-out families.
        // Reuses the confirmation dedupe keys so #0 and LR can never both
        // send for the same enrollment.
        const targets: { audience: 'parent' | 'student'; to: string; key: string }[] = [
          { audience: 'parent', to: ctx.parentEmail, key: `parent_confirmation:${paidEnrollmentId}` },
        ]
        if (ctx.studentEmail) {
          targets.push({
            audience: 'student',
            to: ctx.studentEmail,
            key: `student_confirmation:${paidEnrollmentId}`,
          })
        }
        let anySent = false
        for (const t of targets) {
          const { subject, html, versionId } = await renderEmail('LR_WELCOME', ctx, t.audience, {}, () =>
            lateRegistrationWelcomeEmail(ctx, t.audience)
          )
          const status = await sendOnce({
            dedupeKey: t.key,
            emailType: 'late_welcome',
            enrollmentId: paidEnrollmentId,
            classId,
            to: [t.to],
            subject,
            html,
            bodySnapshotId: versionId,
          })
          if (status === 'sent') anySent = true
        }
        if (anySent) {
          // Claim the replaced sends: thank-you (#1) + both audiences of
          // the superseded pre-start steps. Cancelled email_sends rows ARE
          // the claim (sendOnce suppresses on cancelled) — and the comms
          // dashboard shows exactly why each step didn't go out. One by one
          // so a duplicate (webhook retry) can't abort the remaining claims.
          const claimKeys = [
            `thank_you:${paidEnrollmentId}`,
            ...supersededSteps.flatMap((s) => ['p', 's'].map((tag) => `${s.type}_${tag}:${paidEnrollmentId}`)),
          ]
          for (const dedupe_key of claimKeys) {
            const { error: claimErr } = await supabase.from('email_sends').insert([
              {
                dedupe_key,
                template_key: 'SUPERSEDED',
                enrollment_id: paidEnrollmentId,
                class_id: classId,
                recipient_email: ctx.parentEmail.toLowerCase(),
                status: 'cancelled',
                cancel_reason: 'superseded by combined late-registration welcome',
              },
            ])
            if (claimErr && claimErr.code !== '23505') {
              console.error(`Failed to claim ${dedupe_key}:`, claimErr.message)
            }
          }
          // A pre-projected scheduled row may already exist for these keys —
          // the insert conflicts away; cancel those in place instead.
          await supabase
            .from('email_sends')
            .update({
              status: 'cancelled',
              cancel_reason: 'superseded by combined late-registration welcome',
            })
            .in('dedupe_key', claimKeys)
            .in('status', ['scheduled', 'held'])
        }
      } else {
        // Normal flow: #0-P + #0-S now; #1 follows from the sweep at ~3h.
        const parent = await renderEmail('E0_CONFIRM_PARENT', ctx, 'parent', {}, () =>
          parentConfirmationEmail(ctx)
        )
        await sendOnce({
          dedupeKey: `parent_confirmation:${paidEnrollmentId}`,
          emailType: 'parent_confirmation',
          enrollmentId: paidEnrollmentId,
          classId,
          to: [ctx.parentEmail],
          subject: parent.subject,
          html: parent.html,
          bodySnapshotId: parent.versionId,
        })

        if (ctx.studentEmail) {
          const student = await renderEmail('E0_CONFIRM_STUDENT', ctx, 'student', {}, () =>
            studentConfirmationEmail(ctx)
          )
          await sendOnce({
            dedupeKey: `student_confirmation:${paidEnrollmentId}`,
            emailType: 'student_confirmation',
            enrollmentId: paidEnrollmentId,
            classId,
            to: [ctx.studentEmail],
            subject: student.subject,
            html: student.html,
            bodySnapshotId: student.versionId,
          })
        }
      }
    }
  } catch (emailErr) {
    console.error('Confirmation email failed:', emailErr)
  }

  // PL-51: re-materialize this enrollment's schedule for its new Paid state
  // (PR rows become obsolete via the cron's reconciliation; thank-you/#9/
  // sequence rows appear now) and send anything already due — a payment
  // days after registration releases backed-up steps immediately instead of
  // waiting for tomorrow's cron.
  opts.defer(() =>
    runEnrollmentCommsPass(paidEnrollmentId).catch((e) =>
      console.error('inline comms pass failed (cron will catch up):', e)
    )
  )

  return { outcome: 'matched', enrollmentId: paidEnrollmentId }
}
