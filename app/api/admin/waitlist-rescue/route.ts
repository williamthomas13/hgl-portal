import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { renderEmail } from '../../../utils/comms-db-render'
import { sendOnce, waitlistConfirmationEmail, waitlistOfferEmail } from '../../../utils/email'
import {
  WAITLIST_CLAIM_HOURS,
  claimUrlFor,
  declineUrlFor,
  emailContext,
  loadClassBundles,
  spotsTaken,
} from '../../../utils/lifecycle'

// PL-94: waitlist rescue — Scarlett's hour-49 phone call. Two admin-authed
// actions on an expired/declined/rolled waitlist row:
//   add_back — reinsert at a chosen position (#1 default). Position lives in
//     enrolled_at order, so reinsertion re-times the row between its new
//     neighbors; other positions shift by construction, and a LIVE 48h offer
//     already out to another family is never revoked — the rescued family is
//     simply next when that offer resolves. The family gets a fresh W1
//     confirmation with their position (that's the by-hand timeline record).
//   re_offer — a fresh W2 with a fresh 48h clock, right now. If the class is
//     full, the caller must send confirmOverCap (the UI shows the explicit
//     "{n+1}/{cap} — sure?" dialog) and the override is logged on the
//     enrollment — informed Ops decision, never silent (PL-91 philosophy).
// Waitlist history stays honest: the original offer/expiry email_sends rows
// keep their dedupe keys; each rescue increments waitlist_offer_round so the
// new W2 mints a new key.

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { action?: 'add_back' | 're_offer'; enrollmentId?: string; position?: number; confirmOverCap?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.enrollmentId || !body.action) {
    return NextResponse.json({ error: 'Need action and enrollmentId.' }, { status: 400 })
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, class_id, payment_status, enrolled_at, waitlist_offer_round, waitlist_offer_expires_at')
    .eq('id', body.enrollmentId)
    .maybeSingle()
  if (!enrollment) return NextResponse.json({ error: 'Enrollment not found.' }, { status: 404 })
  const rescuable =
    enrollment.payment_status === 'Expired' ||
    (enrollment.payment_status === 'Waitlisted' &&
      (!enrollment.waitlist_offer_expires_at ||
        new Date(enrollment.waitlist_offer_expires_at).getTime() <= Date.now()))
  if (!rescuable) {
    return NextResponse.json(
      { error: 'Only an expired/declined/rolled waitlist row can be rescued.' },
      { status: 400 }
    )
  }

  const [bundle] = await loadClassBundles(enrollment.class_id)
  if (!bundle) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  if (bundle.status === 'cancelled') {
    return NextResponse.json({ error: 'The class is cancelled.' }, { status: 400 })
  }
  const round = (enrollment.waitlist_offer_round ?? 0) + 1

  if (body.action === 'add_back') {
    // Position N among the CURRENT waitlisted rows (enrolled_at order).
    const queue = bundle.enrollments
      .filter((e) => e.payment_status === 'Waitlisted' && e.id !== enrollment.id)
      .sort((a, b) => a.enrolled_at.localeCompare(b.enrolled_at))
    const requested = Math.max(1, Math.min(Math.round(body.position ?? 1), queue.length + 1))
    let newEnrolledAt: string
    if (queue.length === 0) {
      newEnrolledAt = new Date().toISOString()
    } else if (requested === 1) {
      newEnrolledAt = new Date(new Date(queue[0].enrolled_at).getTime() - 1000).toISOString()
    } else if (requested > queue.length) {
      newEnrolledAt = new Date(new Date(queue[queue.length - 1].enrolled_at).getTime() + 1000).toISOString()
    } else {
      const before = new Date(queue[requested - 2].enrolled_at).getTime()
      const after = new Date(queue[requested - 1].enrolled_at).getTime()
      newEnrolledAt = new Date(before + Math.max(1, Math.floor((after - before) / 2))).toISOString()
    }
    const { error } = await supabase
      .from('enrollments')
      .update({
        payment_status: 'Waitlisted',
        enrolled_at: newEnrolledAt,
        waitlist_offer_sent_at: null,
        waitlist_offer_expires_at: null,
        waitlist_declined_at: null,
        waitlist_offer_round: round,
      })
      .eq('id', enrollment.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Fresh W1 with the new position — the family's confirmation AND the
    // by-hand record on the PL-83 timeline.
    const [fresh] = await loadClassBundles(enrollment.class_id)
    const e = fresh?.enrollments.find((x) => x.id === enrollment.id)
    if (fresh && e) {
      const position =
        fresh.enrollments
          .filter((x) => x.payment_status === 'Waitlisted')
          .sort((a, b) => a.enrolled_at.localeCompare(b.enrolled_at))
          .findIndex((x) => x.id === enrollment.id) + 1
      const ctx = emailContext(fresh, e)
      const { subject, html, versionId } = await renderEmail(
        'W1_WAITLIST',
        ctx,
        'parent',
        { waitlistPosition: position },
        () => waitlistConfirmationEmail(ctx, position)
      )
      await sendOnce({
        dedupeKey: `waitlist_addback:${enrollment.id}:r${round}`,
        emailType: 'waitlist_confirmation',
        enrollmentId: enrollment.id,
        classId: fresh.id,
        to: [ctx.parentEmail],
        subject,
        html,
        senderEmail: caller.email,
        bodySnapshotId: versionId,
      })
      return NextResponse.json({ ok: true, position })
    }
    return NextResponse.json({ ok: true })
  }

  // re_offer: fresh W2, fresh 48h clock — over-cap needs the explicit confirm.
  const taken = spotsTaken(bundle) - (enrollment.payment_status === 'Waitlisted' ? 0 : 0)
  const full = taken >= bundle.capacity
  if (full && !body.confirmOverCap) {
    return NextResponse.json(
      {
        needsOverCapConfirm: true,
        taken,
        capacity: bundle.capacity,
        error: `The class is at ${taken}/${bundle.capacity} — re-offering enrolls over capacity.`,
      },
      { status: 409 }
    )
  }

  const now = Date.now()
  const expiresAt = new Date(now + WAITLIST_CLAIM_HOURS * 3_600_000).toISOString()
  const { error } = await supabase
    .from('enrollments')
    .update({
      payment_status: 'Waitlisted',
      waitlist_offer_sent_at: new Date(now).toISOString(),
      waitlist_offer_expires_at: expiresAt,
      waitlist_declined_at: null,
      waitlist_offer_round: round,
      ...(full
        ? {
            waitlist_overcap_override: {
              at: new Date(now).toISOString(),
              by: caller.email,
              capacity: bundle.capacity,
              taken,
            },
          }
        : {}),
    })
    .eq('id', enrollment.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const [fresh] = await loadClassBundles(enrollment.class_id)
  const e = fresh?.enrollments.find((x) => x.id === enrollment.id)
  if (!fresh || !e) return NextResponse.json({ error: 'Reload failed after update.' }, { status: 500 })
  const ctx = emailContext(fresh, e)
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
    dedupeKey: `waitlist_offer:${e.id}:r${round}`,
    emailType: 'waitlist_offer',
    enrollmentId: e.id,
    classId: fresh.id,
    to: [ctx.parentEmail],
    subject,
    html,
    senderEmail: caller.email,
    bodySnapshotId: versionId,
  })
  if (status !== 'sent') {
    return NextResponse.json({ error: `Offer email did not send (${status}).` }, { status: 500 })
  }
  return NextResponse.json({ ok: true, expiresAt, overCap: full })
}
