import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, waitlistOfferEmail } from './email'
import { renderEmail } from './comms-db-render'
import {
  ADMIN_EMAIL,
  WAITLIST_CLAIM_HOURS,
  claimUrlFor,
  declineUrlFor,
  emailContext,
  localDate,
  registrationCloseFor,
  spotsTaken,
  type ClassBundle,
} from './lifecycle'

// PL-72: the W2 offer-extension pass, extracted from the cron's
// sweepWaitlist so a confirmed DECLINE can run the exact same cascade
// immediately — the next family gets their offer with a fresh 48h clock
// instead of waiting out the old deadline. One source: the cron calls this
// too, so the two paths can never drift.

export async function extendWaitlistOffers(bundle: ClassBundle): Promise<number> {
  if (localDate(bundle.timezone) > registrationCloseFor(bundle)) return 0
  const now = Date.now()
  const waitlisted = bundle.enrollments
    .filter((e) => e.payment_status === 'Waitlisted')
    .sort((a, b) => a.enrolled_at.localeCompare(b.enrolled_at))
  if (waitlisted.length === 0) return 0

  let sent = 0
  let open = bundle.capacity - spotsTaken(bundle)
  for (const e of waitlisted) {
    if (open <= 0) break
    if (e.payment_status !== 'Waitlisted' || e.waitlist_offer_sent_at) continue

    const expiresAt = new Date(now + WAITLIST_CLAIM_HOURS * 3_600_000).toISOString()
    const ctx = emailContext(bundle, e)
    const claimLink = claimUrlFor(e.id)
    const declineLink = declineUrlFor(e.id)
    const claimDeadline = new Date(expiresAt).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    const { subject, html, versionId } = await renderEmail(
      'W2_SPOT_OPEN',
      ctx,
      'parent',
      { claimLink, claimDeadline, declineLink },
      () => waitlistOfferEmail(ctx, claimLink, expiresAt, declineLink)
    )
    const status = await sendOnce({
      dedupeKey: `waitlist_offer:${e.id}`,
      emailType: 'waitlist_offer',
      enrollmentId: e.id,
      classId: bundle.id,
      to: [ctx.parentEmail],
      cc: [ADMIN_EMAIL], // admin CC'd on each offer
      subject,
      html,
      bodySnapshotId: versionId,
    })
    if (status === 'sent') {
      await supabase
        .from('enrollments')
        .update({ waitlist_offer_sent_at: new Date(now).toISOString(), waitlist_offer_expires_at: expiresAt })
        .eq('id', e.id)
      sent++
      open--
    } else if (status === 'duplicate') {
      open-- // offer already out but flags not yet stamped; still holds a spot
    }
  }
  return sent
}
