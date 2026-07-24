import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { ADMIN_EMAIL, verifyRefundToken } from '../../utils/lifecycle'
import { sendAdminAlert } from '../../utils/email'
import { emailBaseUrl } from '../../utils/base-url'

// PL-128: stamp the refund REQUEST — a tracked state, not an email to lose.
// Refunds stay Option A: Ops issues the actual refund in the Stripe
// dashboard; nothing here moves money. First final action wins: a family
// that already converted can't also queue a refund (and vice versa — the
// convert flow's stamp guard is symmetrical).

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export async function POST(req: Request) {
  let body: { enrollmentId?: string; token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { enrollmentId, token } = body
  if (!enrollmentId || !token || !verifyRefundToken(enrollmentId, token)) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select(
      `id, class_id, payment_status, class_cancelled, refund_requested_at,
       converted_to_tutoring_at, cancellation_outcome,
       students ( first_name, last_name, families ( parent_first_name, parent_email ) ),
       classes ( class_type, schools ( nickname ) )`
    )
    .eq('id', enrollmentId)
    .maybeSingle()
  if (!enrollment) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  if (!enrollment.class_cancelled) {
    return NextResponse.json({ error: 'This enrollment is not on a cancelled class.' }, { status: 400 })
  }
  if (enrollment.payment_status === 'Refunded') {
    return NextResponse.json({ ok: true, state: 'already_refunded' })
  }
  if (enrollment.converted_to_tutoring_at) {
    return NextResponse.json({ ok: true, state: 'already_converted' })
  }
  if (!['Paid', 'Completed'].includes(enrollment.payment_status)) {
    return NextResponse.json({ error: 'Only a paid enrollment can request a refund.' }, { status: 400 })
  }
  if (enrollment.refund_requested_at) {
    return NextResponse.json({ ok: true, state: 'already_requested' })
  }

  // Atomic first-action-wins: never stamp over a conversion that landed
  // between the read above and this write.
  const { data: stamped } = await supabase
    .from('enrollments')
    .update({
      refund_requested_at: new Date().toISOString(),
      cancellation_outcome: 'refund_requested',
    })
    .eq('id', enrollmentId)
    .is('refund_requested_at', null)
    .is('converted_to_tutoring_at', null)
    .select('id')
  if (!stamped?.length) return NextResponse.json({ ok: true, state: 'already_requested' })

  const student = one<any>(enrollment.students)
  const fam = one<any>(student?.families)
  const cls = one<any>(enrollment.classes)
  const label = `${one<any>(cls?.schools)?.nickname ?? 'HGL'} ${cls?.class_type ?? 'class'}`
  await sendAdminAlert({
    dedupeKey: `refund_requested:${enrollmentId}`,
    adminEmail: ADMIN_EMAIL,
    templateKey: 'AL_REFUND_REQUEST',
    vars: { alertStudentName: student ? `${student.first_name} ${student.last_name}` : undefined },
    subject: `Refund requested — ${student?.first_name ?? 'a family'} (${label})`,
    body: `<p><strong>${fam?.parent_first_name ?? 'A parent'}</strong> (${fam?.parent_email ?? '—'})
      requested a refund of ${student?.first_name ?? 'the student'}'s cancelled ${label} fee —
      self-serve, nothing to justify, already stamped on the record.</p>
      <p><strong>The refund itself is issued in the Stripe dashboard as always</strong> — the
      portal moves no money. After issuing it there, mark the enrollment Refunded so the
      dashboard row clears.</p>
      <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?class=${enrollment.class_id}&enrollment=${enrollmentId}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open the family's row</a></p>`,
  }).catch((e) => console.error('refund-request alert failed (stamp stands):', e))

  return NextResponse.json({ ok: true, state: 'requested' })
}
