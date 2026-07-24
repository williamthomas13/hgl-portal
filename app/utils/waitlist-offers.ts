import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, waitlistOfferEmail, zonedDeadline } from './email'
import { renderEmail } from './comms-db-render'
import { emailBaseUrl } from './base-url'
import type { EnrollmentRow } from './lifecycle'
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
    // PL-118: the stated deadline must match the enforced instant, in the
    // class's own zone with a label.
    const claimDeadline = zonedDeadline(expiresAt, ctx.timezone)
    const { subject, html, versionId } = await renderEmail(
      'W2_SPOT_OPEN',
      ctx,
      'parent',
      { claimLink, claimDeadline, declineLink },
      () => waitlistOfferEmail(ctx, claimLink, expiresAt, declineLink)
    )
    // PL-94: rescued families carry an offer ROUND — a fresh key per round,
    // so the original offer's claimed key never blocks the rescue.
    const round = e.waitlist_offer_round ?? 0
    const status = await sendOnce({
      dedupeKey: round === 0 ? `waitlist_offer:${e.id}` : `waitlist_offer:${e.id}:r${round}`,
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

// PL-94: the rollover alert is a cockpit, not a checkbox — the offer email's
// open status (the spam-folder tell) plus the rescue action row, all
// admin-authed deep-links landing on the class waitlist with the family's
// row in view. Note: there is no separate offer-REMINDER email in the
// product (the admin is CC'd on the offer itself), so the status shown is
// the offer's — stated plainly, no editorializing (PL-93 honesty rule).
export async function waitlistRolloverAlertBody(
  bundle: ClassBundle,
  e: Pick<EnrollmentRow, 'id'>,
  storyHtml: string
): Promise<string> {
  const { data } = await supabase
    .from('email_sends')
    .select('sent_at, status, delivered_at, first_opened_at')
    .like('dedupe_key', `waitlist_offer:${e.id}%`)
    .in('status', ['sent', 'delivered', 'bounced'])
    .order('sent_at', { ascending: false })
    .limit(1)
  const row = data?.[0]
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })
  const offerStatus = !row?.sent_at
    ? 'no offer email on record'
    : row.status === 'bounced'
      ? `sent ${fmt(row.sent_at)} — BOUNCED`
      : `sent ${fmt(row.sent_at)} — ${row.delivered_at || row.status === 'delivered' ? 'delivered, ' : ''}${row.first_opened_at ? `opened ${fmt(row.first_opened_at)}` : 'not yet opened'}`
  const spamLine =
    row?.sent_at && !row.first_opened_at
      ? ` <strong>The offer was never opened — this expiry may be a spam-folder artifact; consider a call.</strong>`
      : ''
  const rowLink = `${emailBaseUrl()}/admin?class=${bundle.id}&enrollment=${e.id}`
  return `${storyHtml}
    <p>Offer email: ${offerStatus}.${spamLine}</p>
    <p style="margin:20px 0">
      <a href="${rowLink}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Re-offer the spot</a>
      &nbsp;&nbsp;<a href="${rowLink}" style="display:inline-block;background:#506171;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Add back at #1</a>
      &nbsp;&nbsp;<a href="${rowLink}" style="color:#00AEEE">See the waitlist</a>
    </p>
    <p style="color:#64748b;font-size:13px">All three land on the family's row on the class roster —
    the re-offer and add-back one-clicks are there (over-cap asks first, and is logged).</p>`
}
