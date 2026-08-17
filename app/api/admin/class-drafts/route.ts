import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

// PL-370: class-wizard drafts — saved wizard STATE, never classes rows
// (that's what keeps a draft inert everywhere). GET lists, POST saves
// (upsert by id), DELETE removes. Minimal validity on save: a working name
// — the full validation belongs to the real create path the wizard runs at
// the end, same as a straight-through run.

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const { data, error } = await supabase
    .from('class_drafts')
    .select('id, name, created_by, created_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ drafts: data ?? [] })
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (body?.action === 'load') {
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'Missing draft id.' }, { status: 400 })
    const { data, error } = await supabase.from('class_drafts').select('*').eq('id', id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Draft not found — it may have been deleted.' }, { status: 404 })
    return NextResponse.json({ draft: data })
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const state = body?.state
  if (!name) {
    return NextResponse.json(
      { error: 'Give the draft a working name first — pick a school or type a class name.' },
      { status: 400 }
    )
  }
  if (!state || typeof state !== 'object') {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  }
  const id = typeof body?.id === 'string' && body.id ? body.id : undefined
  if (id) {
    const { error } = await supabase
      .from('class_drafts')
      .update({ name, state, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id })
  }
  const { data, error } = await supabase
    .from('class_drafts')
    .insert([{ name, state, created_by: caller.email.toLowerCase() }])
    .select('id')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Save failed.' }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Missing draft id.' }, { status: 400 })
  const { error } = await supabase.from('class_drafts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
