import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

// PL-364: the physical add-on products (notebooks) — price-list-adjacent
// editing, admin-only like the rest of the money surface. Prices are
// forward-only: product_orders freeze what was actually paid.

export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price, regular_price, active, physical, printful_variant_id, sort_order')
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data ?? [] })
}

export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Missing product id.' }, { status: 400 })
  const fields: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) fields.name = body.name.trim()
  if (body.price != null && Number(body.price) >= 0) fields.price = Number(body.price)
  if ('regular_price' in body) {
    fields.regular_price = body.regular_price == null || body.regular_price === '' ? null : Number(body.regular_price)
  }
  if (typeof body.active === 'boolean') fields.active = body.active
  if ('printful_variant_id' in body) {
    fields.printful_variant_id =
      body.printful_variant_id == null || body.printful_variant_id === '' ? null : Number(body.printful_variant_id)
  }
  if (Object.keys(fields).length === 0) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  fields.updated_at = new Date().toISOString()
  const { error } = await supabase.from('products').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
