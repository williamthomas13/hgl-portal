import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createSupabaseServerClient } from '../../../utils/supabase-server'

// Receipt PDF for a paid enrollment (PHASE4_SPEC §3) — generated from our own
// data with the same pdf-lib machinery as the schedule PDF. Auth is the
// cookie session: the query runs under RLS, so only the enrollment's own
// parent (or staff) gets rows back; everyone else sees 404.

/* eslint-disable @typescript-eslint/no-explicit-any */

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
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
  const addons = (e.enrollment_addons ?? []).map((a: any) => ({
    name: one<any>(a.tutoring_packages)?.name ?? 'Tutoring package',
    hours: Number(a.hours),
    pricePaid: Number(a.price_paid),
  }))

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const slate = rgb(0.2, 0.25, 0.33)
  const blue = rgb(0, 0.68, 0.93)
  const gray = rgb(0.35, 0.42, 0.5)

  const page = doc.addPage([612, 792]) // US Letter
  let y = 720

  page.drawText('Higher Ground Learning', { x: 56, y, size: 20, font: bold, color: slate })
  y -= 8
  page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 3, color: blue })
  y -= 30
  page.drawText('Receipt', { x: 56, y, size: 16, font: bold, color: slate })
  if (e.paid_at) {
    page.drawText(formatDate(e.paid_at.slice(0, 10)), { x: 460, y, size: 11, font, color: gray })
  }
  y -= 30

  const line = (label: string, value: string, valueBold = false) => {
    page.drawText(label, { x: 56, y, size: 11, font, color: gray })
    page.drawText(value, { x: 220, y, size: 11, font: valueBold ? bold : font, color: slate })
    y -= 18
  }

  if (family) {
    line('Billed to', `${family.parent_first_name ?? ''} ${family.parent_last_name ?? ''}`.trim())
    line('Email', family.parent_email ?? '—')
  }
  if (student) line('Student', `${student.first_name} ${student.last_name}`)
  y -= 8

  page.drawText('Items', { x: 56, y, size: 13, font: bold, color: slate })
  y -= 22
  line(label, `$${Number(cls?.price ?? e.amount_paid).toLocaleString()}`)
  for (const a of addons) {
    line(`${a.name} — 1-on-1 tutoring (${a.hours}h)`, `$${a.pricePaid.toLocaleString()}`)
  }
  y -= 4
  page.drawLine({ start: { x: 56, y }, end: { x: 400, y }, thickness: 1, color: gray })
  y -= 18
  line('Amount paid', `$${Number(e.amount_paid).toLocaleString()}`, true)
  if (e.payment_status === 'Refunded') {
    line('Status', 'Refunded')
  }
  if (e.stripe_payment_intent_id) line('Payment reference', e.stripe_payment_intent_id)

  y -= 20
  page.drawText('Questions? Reply to any of our emails or write info@highergroundlearning.com.', {
    x: 56, y, size: 9, font, color: gray,
  })

  const bytes = await doc.save()
  const filename = `HGL-receipt-${label}`.replace(/[^\w-]+/g, '-') + '.pdf'
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
