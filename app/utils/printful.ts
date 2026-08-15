// PL-364: Printful fulfillment for physical class add-ons. One order per
// product_orders row (external_id = the row's uuid — Printful-side
// idempotency), submitted on payment-confirmed, tracked by POLLING (the
// simpler of webhook-vs-poll), cancelled when an enrollment refunds before
// shipping. API key via PRINTFUL_API_KEY (launch-tail secret) — no key means
// the register flow doesn't offer physical products at all (never sell what
// we can't fulfill). Orders are created as DRAFTS unless PRINTFUL_CONFIRM=1:
// during the sandbox round-trip Scarlett confirms drafts by hand in the
// Printful dashboard; the env flip makes it automatic once trusted.

import { supabaseAdmin as supabase } from './supabase-admin'
import { sendAdminAlert } from './email'
import { ADMIN_EMAIL } from './lifecycle'
import { emailBaseUrl } from './base-url'

const API = 'https://api.printful.com'

export function printfulConfigured(): boolean {
  return Boolean(process.env.PRINTFUL_API_KEY)
}

async function pf(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Shipping coverage: Printful's own country list, cached per process for a
// day. Empty when unconfigured/unreachable — the flow then hides physical
// products rather than promising what can't be checked.
let countryCache: { at: number; list: { code: string; name: string }[] } | null = null
export async function printfulCountries(): Promise<{ code: string; name: string }[]> {
  if (!printfulConfigured()) return []
  if (countryCache && Date.now() - countryCache.at < 86_400_000) return countryCache.list
  try {
    const r = await pf('/countries')
    if (!r.ok || !Array.isArray(r.body?.result)) return countryCache?.list ?? []
    const list = r.body.result.map((c: any) => ({ code: String(c.code), name: String(c.name) }))
    countryCache = { at: Date.now(), list }
    return list
  } catch {
    return countryCache?.list ?? []
  }
}

type OrderRow = {
  id: string
  enrollment_id: string
  product_id: string
  quantity: number
  status: string
  ship_name: string | null
  ship_address1: string | null
  ship_address2: string | null
  ship_city: string | null
  ship_state: string | null
  ship_zip: string | null
  ship_country: string | null
  printful_order_id: string | null
  products?: any
}

async function failOrder(row: OrderRow, error: string, productName: string) {
  console.error(`[PL-364] Printful push failed for order ${row.id}: ${error}`)
  await supabase
    .from('product_orders')
    .update({ status: 'failed', last_error: error, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .in('status', ['queued', 'failed'])
  // Failure ≠ lost order: the alert names the record, and the roster row
  // carries the retry. Dedupe per order so retries can re-alert on new fails.
  await sendAdminAlert({
    dedupeKey: `printful_failed:${row.id}:${error.slice(0, 40)}`,
    adminEmail: ADMIN_EMAIL,
    subject: 'A notebook order could not reach Printful',
    body: `<p>The <strong>${productName}</strong> for a paid registration could not be pushed to
      Printful: ${error}</p>
      <p>The registration itself is fine — only the physical fulfillment is waiting. The order
      keeps its place and retries from the roster (or on the hourly sweep once the cause is
      fixed).</p>
      <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?enrollment=${row.enrollment_id}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open the registration</a></p>`,
  }).catch((e) => console.error('printful-failure alert failed:', e))
}

/** Push one paid product order to Printful. Idempotent: external_id is the
 *  row id — an existing Printful order is adopted, never duplicated. */
export async function submitPrintfulOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await supabase
    .from('product_orders')
    .select('*, products ( name, printful_variant_id )')
    .eq('id', orderId)
    .maybeSingle()
  if (!row) return { ok: false, error: 'order row not found' }
  const product = Array.isArray(row.products) ? row.products[0] : row.products
  if (!['queued', 'failed'].includes(row.status)) return { ok: true } // already submitted/shipped/cancelled

  if (!printfulConfigured()) {
    await failOrder(row, 'PRINTFUL_API_KEY is not configured', product?.name ?? 'product')
    return { ok: false, error: 'unconfigured' }
  }
  if (!product?.printful_variant_id) {
    await failOrder(row, `no Printful variant mapped for "${product?.name}" — set it in Settings → Price list`, product?.name ?? 'product')
    return { ok: false, error: 'unmapped' }
  }
  if (!row.ship_address1 || !row.ship_city || !row.ship_country) {
    await failOrder(row, 'shipping address incomplete', product.name)
    return { ok: false, error: 'address' }
  }

  try {
    // Adopt an existing order first (crash-window idempotency).
    const existing = await pf(`/orders/@${row.id}`)
    let pfOrder = existing.ok ? existing.body?.result : null
    if (!pfOrder) {
      const created = await pf('/orders' + (process.env.PRINTFUL_CONFIRM === '1' ? '?confirm=1' : ''), {
        method: 'POST',
        body: JSON.stringify({
          external_id: row.id,
          recipient: {
            name: row.ship_name ?? 'HGL family',
            address1: row.ship_address1,
            address2: row.ship_address2 ?? undefined,
            city: row.ship_city,
            state_code: row.ship_state ?? undefined,
            zip: row.ship_zip ?? undefined,
            country_code: row.ship_country,
          },
          items: [{ variant_id: Number(product.printful_variant_id), quantity: row.quantity }],
        }),
      })
      if (!created.ok) {
        const msg = created.body?.error?.message ?? created.body?.result ?? `HTTP ${created.status}`
        await failOrder(row, String(msg).slice(0, 300), product.name)
        return { ok: false, error: String(msg) }
      }
      pfOrder = created.body?.result
    }
    await supabase
      .from('product_orders')
      .update({
        status: 'submitted',
        printful_order_id: String(pfOrder?.id ?? ''),
        printful_status: pfOrder?.status ?? null,
        last_error: null,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .in('status', ['queued', 'failed'])
    console.log(`[PL-364] Printful order ${pfOrder?.id} submitted for product order ${row.id}`)
    return { ok: true }
  } catch (e) {
    await failOrder(row, e instanceof Error ? e.message : String(e), product.name)
    return { ok: false, error: String(e) }
  }
}

/** The hourly convergence sweep: push queued/retryable rows, poll submitted
 *  ones for status+tracking, and cancel unshipped orders whose enrollment
 *  was refunded (state-driven — works no matter where the refund was marked). */
export async function sweepPrintfulOrders(): Promise<{ pushed: number; shipped: number; cancelled: number }> {
  const out = { pushed: 0, shipped: 0, cancelled: 0 }

  // Refund cancellation FIRST — never push (or keep) an order for a
  // refunded enrollment that hasn't shipped.
  const { data: refundable } = await supabase
    .from('product_orders')
    .select('id, status, printful_order_id, enrollments!inner ( payment_status )')
    .in('status', ['queued', 'submitted', 'failed'])
    .eq('enrollments.payment_status', 'Refunded')
  for (const row of (refundable as any[]) ?? []) {
    if (row.status === 'submitted' && printfulConfigured()) {
      const r = await pf(`/orders/@${row.id}`, { method: 'DELETE' })
      if (!r.ok && r.status !== 404) {
        console.error(`[PL-364] Printful cancel failed for ${row.id}: HTTP ${r.status} — leaving for next sweep`)
        continue // e.g. already being fulfilled — a human sorts it with Printful
      }
    }
    await supabase
      .from('product_orders')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .in('status', ['queued', 'submitted', 'failed'])
    out.cancelled++
  }

  if (!printfulConfigured()) return out

  // Queued rows (paid but not yet pushed — e.g. the deferred push died).
  const { data: queued } = await supabase.from('product_orders').select('id').eq('status', 'queued')
  for (const q of queued ?? []) {
    const r = await submitPrintfulOrder(q.id)
    if (r.ok) out.pushed++
  }

  // Poll submitted orders for fulfillment/tracking.
  const { data: submitted } = await supabase
    .from('product_orders')
    .select('id, printful_order_id')
    .eq('status', 'submitted')
  for (const row of submitted ?? []) {
    try {
      const r = await pf(`/orders/@${row.id}`)
      if (!r.ok) continue
      const o = r.body?.result
      const shipment = (o?.shipments ?? [])[0]
      const updates: Record<string, unknown> = {
        printful_status: o?.status ?? null,
        updated_at: new Date().toISOString(),
      }
      if (shipment?.tracking_number) {
        updates.status = 'shipped'
        updates.shipped_at = shipment.ship_date
          ? new Date(shipment.ship_date).toISOString()
          : new Date().toISOString()
        updates.tracking_number = shipment.tracking_number
        updates.tracking_url = shipment.tracking_url ?? null
        updates.carrier = shipment.carrier ?? null
        out.shipped++
      } else if (o?.status === 'canceled') {
        updates.status = 'cancelled'
      }
      await supabase.from('product_orders').update(updates).eq('id', row.id).eq('status', 'submitted')
    } catch (e) {
      console.error(`[PL-364] Printful poll failed for ${row.id}:`, e)
    }
  }
  return out
}

/** Composed sale label — "$35.00, regularly $48.00" (never hand-typed). */
export function productPriceLabel(p: { price: number; regular_price?: number | null }): string {
  const money = (n: number) => `$${Number(n).toFixed(2)}`
  return p.regular_price != null && Number(p.regular_price) > Number(p.price)
    ? `${money(p.price)}, regularly ${money(Number(p.regular_price))}`
    : money(p.price)
}
