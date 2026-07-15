import Stripe from 'stripe'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import {
  after7cConfirm,
  confirmInvoice,
  recomputeInvoiceTotals,
} from '../../../../utils/tutoring-billing'
import { issueOrCharge } from '../../../../utils/tutoring-stripe'

// Staff invoice actions (Phase 7c §6): manual lines (adjustment / credit /
// the staff-applied 10% late fee — never automatic), confirm on a family's
// behalf (phone/email requests write the same records, §8), send now, retry
// an autopay charge, void, and clearing a handled change request. Line edits
// on an already-issued Stripe invoice re-issue it (void + recreate) so the
// hosted page always matches the portal.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

type Body =
  | { action: 'add_line'; id: string; kind: 'adjustment' | 'credit' | 'late_payment_fee'; description: string; amount: number }
  | { action: 'apply_late_fee'; id: string } // 10% of current total (§6.4)
  | { action: 'confirm'; id: string } // staff confirm = same record as parent confirm
  | { action: 'send_now'; id: string }
  | { action: 'retry_charge'; id: string }
  | { action: 'void'; id: string }
  | { action: 'mark_change_handled'; id: string }

async function reissueStripeInvoiceIfNeeded(invoiceId: string) {
  const { data: inv } = await supabase
    .from('tutoring_invoices')
    .select('id, status, stripe_invoice_id')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!inv || !inv.stripe_invoice_id || !['invoiced', 'past_due'].includes(inv.status)) return
  try {
    await stripe.invoices.voidInvoice(inv.stripe_invoice_id)
  } catch (e) {
    console.error(`voiding stripe invoice ${inv.stripe_invoice_id} failed (continuing):`, e)
  }
  // Back to confirmed → issueOrCharge builds a fresh hosted invoice from the
  // current lines and re-sends T2 (sendOnce dedupe key is per-invoice, so a
  // re-issue needs its own key — handled by clearing stripe ids first).
  await supabase
    .from('tutoring_invoices')
    .update({
      status: 'confirmed',
      stripe_invoice_id: null,
      stripe_hosted_invoice_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
  await issueOrCharge(invoiceId)
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!('id' in body) || !body.id) return NextResponse.json({ error: 'Missing invoice id.' }, { status: 400 })

  const { data: invoice } = await supabase
    .from('tutoring_invoices')
    .select('id, status, total, stripe_invoice_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Unknown invoice.' }, { status: 404 })

  try {
    if (body.action === 'add_line' || body.action === 'apply_late_fee') {
      if (invoice.status === 'paid' || invoice.status === 'void') {
        return NextResponse.json(
          { error: `A ${invoice.status} invoice can't change — add the line to next month's invoice instead.` },
          { status: 400 }
        )
      }
      const line =
        body.action === 'apply_late_fee'
          ? {
              invoice_id: invoice.id,
              description: `Late payment fee (10%, per the signed policy — 30+ days past due)`,
              qty_hours: 0,
              rate: null,
              amount: Number((Number(invoice.total) * 0.1).toFixed(2)),
              kind: 'late_payment_fee',
            }
          : {
              invoice_id: invoice.id,
              description: body.description?.trim() || 'Adjustment',
              qty_hours: 0,
              rate: null,
              amount:
                body.kind === 'credit' ? -Math.abs(Number(body.amount)) : Math.abs(Number(body.amount)),
              kind: body.kind,
            }
      if (body.action === 'add_line' && !(Math.abs(Number(body.amount)) > 0)) {
        return NextResponse.json({ error: 'Amount must be non-zero.' }, { status: 400 })
      }
      const { error } = await supabase.from('tutoring_invoice_lines').insert(line)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const total = await recomputeInvoiceTotals(invoice.id)
      await reissueStripeInvoiceIfNeeded(invoice.id)
      return NextResponse.json({ ok: true, total })
    }

    if (body.action === 'confirm') {
      const res = await confirmInvoice(invoice.id, 'staff')
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
      const invoiceId = invoice.id
      after(() => {
        after7cConfirm(invoiceId)
        issueOrCharge(invoiceId).catch((e) => console.error('issueOrCharge after staff confirm failed:', e))
      })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'send_now' || body.action === 'retry_charge') {
      const res = await issueOrCharge(invoice.id)
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })
      return NextResponse.json({ ok: true, path: res.path })
    }

    if (body.action === 'void') {
      if (invoice.status === 'paid') {
        return NextResponse.json({ error: 'Paid invoices stay — refund in Stripe and adjust next month instead.' }, { status: 400 })
      }
      if (invoice.stripe_invoice_id) {
        try {
          await stripe.invoices.voidInvoice(invoice.stripe_invoice_id)
        } catch (e) {
          console.error('stripe void failed (continuing):', e)
        }
      }
      const { error } = await supabase
        .from('tutoring_invoices')
        .update({ status: 'void', updated_at: new Date().toISOString() })
        .eq('id', invoice.id)
        .neq('status', 'paid')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'mark_change_handled') {
      const { error } = await supabase
        .from('tutoring_invoices')
        .update({ change_requested_at: null, updated_at: new Date().toISOString() })
        .eq('id', invoice.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('tutoring invoice route failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
