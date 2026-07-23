import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import {
  convertEnrollmentToTutoring,
  loadConversionRecord,
  sendCxTutoringStart,
} from '../../../utils/convert-tutoring'

// PL-76 → PL-86: the Ops Director's one-click conversion, now on the shared
// convert-tutoring machinery (the family's self-serve confirm uses the same
// functions, so first-action-wins reconciliation is structural). Here
// CX_TUTORING_START is the immediate RECEIPT of the conversation — sent
// right away with the once-ever dedupe key; if the family self-served first,
// this click is a friendly no-op reporting who converted and when. A second
// click offers to re-send the availability email (deliberate resends carry
// their own key — that stays a feature).

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

  const record = await loadConversionRecord(body.enrollmentId)
  if ('error' in record) return NextResponse.json({ error: record.error }, { status: record.status })

  // Second click without explicit resend: report state (who + when), never
  // re-credit — "already converted — self-serve, {date}" comes from here.
  if (record.alreadyConverted && !body.resend) {
    return NextResponse.json({
      ok: true,
      already: true,
      convertedBy: record.convertedBy,
      convertedAt: record.convertedAt,
      offerHours: record.offerHours,
      creditAmount: record.creditAmount,
    })
  }

  let already = record.alreadyConverted
  if (!already) {
    const result = await convertEnrollmentToTutoring(record, caller.email)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    already = result.already
    if (already) {
      // The family's self-serve confirm won the race mid-click.
      const fresh = await loadConversionRecord(body.enrollmentId)
      if (!('error' in fresh)) {
        return NextResponse.json({
          ok: true,
          already: true,
          convertedBy: fresh.convertedBy,
          convertedAt: fresh.convertedAt,
          offerHours: fresh.offerHours,
          creditAmount: fresh.creditAmount,
        })
      }
    }
  }

  // The receipt (or the deliberate resend, with its own key).
  const sent = await sendCxTutoringStart(record, {
    dedupeKey: body.resend ? `cx_tutoring_start:${record.enrollment.id}:${Date.now()}` : undefined,
    senderEmail: caller.email,
  })
  if (sent === 'failed') {
    return NextResponse.json(
      { error: 'Conversion recorded, but the email failed — check the comms dashboard and resend.' },
      { status: 500 }
    )
  }
  return NextResponse.json({
    ok: true,
    offerHours: record.offerHours,
    creditAmount: record.creditAmount,
    resent: body.resend === true,
  })
}
