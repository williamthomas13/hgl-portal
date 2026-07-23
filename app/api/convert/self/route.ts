import { NextResponse } from 'next/server'
import { verifyConvertToken } from '../../../utils/lifecycle'
import { emailBaseUrl } from '../../../utils/base-url'
import { ADMIN_EMAIL } from '../../../utils/lifecycle'
import { sendAdminAlert } from '../../../utils/email'
import { convertEnrollmentToTutoring, loadConversionRecord } from '../../../utils/convert-tutoring'

// PL-86: the self-serve confirm — JS-executed POST behind one visible tap
// (the tokenized GET page never converts). Mints via the shared PL-84
// machinery; the Ops Director hears immediately; CX_TUTORING_START does NOT
// send here (on this path it demotes to the +1d follow-up, only if the
// family doesn't share availability). Idempotent: a repeat POST (or a race
// with Kelsie's click) lands in the friendly already state.

export async function POST(req: Request) {
  let body: { enrollmentId?: string; token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.enrollmentId || !body.token || !verifyConvertToken(body.enrollmentId, body.token)) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  }

  const record = await loadConversionRecord(body.enrollmentId)
  if ('error' in record) return NextResponse.json({ error: record.error }, { status: record.status })
  if (record.alreadyConverted) {
    return NextResponse.json({ ok: true, already: true, offerHours: record.offerHours })
  }

  const result = await convertEnrollmentToTutoring(record, 'family')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  if (!result.already) {
    // Ops alert — Kelsie always sees the current state before acting on a
    // reply thread.
    const terms = record.offerHours
      ? `<strong>${record.offerHours} hours</strong> (paid $${record.paid.toLocaleString()}) — hours package minted`
      : `<strong>$${record.paid.toLocaleString()}</strong> Stripe credit (no hours offer was on the record)`
    await sendAdminAlert({
      dedupeKey: `self_serve_conversion:${record.enrollment.id}`,
      adminEmail: ADMIN_EMAIL,
      subject: `Self-serve conversion — ${record.student.first_name} ${record.student.last_name} (${record.classLabel})`,
      body: `<p><strong>${record.family.parent_first_name ?? 'A parent'}</strong>
        (${record.family.parent_email}) converted ${record.student.first_name}'s
        ${record.classLabel} payment themselves from the cancellation email: ${terms}.</p>
        <p>The page rolled straight into the availability grid; if they don't share times,
        the CX-T follow-up goes out automatically after a day.</p>
        <p><a href="${emailBaseUrl()}/admin/tutoring?family=${record.family.id}" style="color:#00AEEE">The family record</a>
        · <a href="${emailBaseUrl()}/admin/communications?enrollment=${record.enrollment.id}" style="color:#00AEEE">the enrollment's comms</a></p>`,
    }).catch((e) => console.error('self-serve conversion alert failed (conversion stands):', e))
  }

  return NextResponse.json({ ok: true, already: result.already, offerHours: record.offerHours })
}
