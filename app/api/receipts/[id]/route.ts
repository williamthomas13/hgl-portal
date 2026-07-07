import { createSupabaseServerClient } from '../../../utils/supabase-server'
import { buildReceiptPdf } from '../../../utils/receipt-pdf'

// Receipt PDF for a paid enrollment (PHASE4_SPEC §3). Auth is the cookie
// session: the query runs under RLS, so only the enrollment's own parent (or
// staff) gets rows back; everyone else sees 404. Drawing lives in
// utils/receipt-pdf.ts (shared with the render-check script).

/* eslint-disable @typescript-eslint/no-explicit-any */

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function GET(_request: Request, ctx: RouteContext<'/api/receipts/[id]'>) {
  const { id } = await ctx.params
  const supabase = await createSupabaseServerClient()

  const { data: e } = await supabase
    .from('enrollments')
    .select(
      `
      id, payment_status, amount_paid, paid_at, stripe_payment_intent_id,
      enrollment_addons ( hours, price_paid, tutoring_packages ( name ) ),
      students ( first_name, last_name, families ( parent_first_name, parent_last_name, parent_email ) ),
      classes ( class_type, school_nickname, price, start_date, schools ( name, nickname ) )
    `
    )
    .eq('id', id)
    .single()

  if (!e || e.amount_paid == null) {
    return new Response('Receipt not found', { status: 404 })
  }

  const student = one<any>(e.students)
  const family = one<any>(student?.families)
  const cls = one<any>(e.classes)
  const school = one<any>(cls?.schools)
  const label = `${school?.nickname ?? cls?.school_nickname ?? 'HGL'} ${cls?.class_type ?? 'Class'}`

  const bytes = await buildReceiptPdf({
    label,
    classPrice: Number(cls?.price ?? e.amount_paid),
    amountPaid: Number(e.amount_paid),
    paidAt: e.paid_at ? e.paid_at.slice(0, 10) : null,
    parentName: `${family?.parent_first_name ?? ''} ${family?.parent_last_name ?? ''}`.trim(),
    parentEmail: family?.parent_email ?? null,
    studentName: `${student?.first_name ?? ''} ${student?.last_name ?? ''}`.trim(),
    refunded: e.payment_status === 'Refunded',
    paymentRef: e.stripe_payment_intent_id ?? null,
    addons: (e.enrollment_addons ?? []).map((a: any) => ({
      name: one<any>(a.tutoring_packages)?.name ?? 'Tutoring package',
      hours: Number(a.hours),
      pricePaid: Number(a.price_paid),
    })),
  })

  const filename = `HGL-receipt-${label}`.replace(/[^\w-]+/g, '-') + '.pdf'
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
