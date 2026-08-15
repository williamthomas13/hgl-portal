import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

// PL-348: the shared class-page content blocks (Settings → Class pages).
// GET lists every block; POST updates one by key. Keys are FIXED by the
// seed migration — this surface edits copy, it doesn't invent new page
// sections (the page template decides what renders where).

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const { data, error } = await supabase
    .from('site_content_blocks')
    .select('key, section, heading, body_markdown, sort_order, image, updated_at, updated_by')
    .order('section')
    .order('sort_order')
  if (error) {
    return NextResponse.json(
      { error: 'The content blocks table is not set up yet — apply the PL-348 migration first.' },
      { status: 503 }
    )
  }
  return NextResponse.json({ blocks: data ?? [] })
}

export async function POST(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const key = typeof body?.key === 'string' ? body.key : ''
  const heading = typeof body?.heading === 'string' ? body.heading : null
  const markdown = typeof body?.body_markdown === 'string' ? body.body_markdown : null
  if (!key || (heading == null && markdown == null)) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  }
  const { data: existing } = await supabase
    .from('site_content_blocks')
    .select('key')
    .eq('key', key)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'Unknown content block.' }, { status: 404 })
  }
  const { error } = await supabase
    .from('site_content_blocks')
    .update({
      ...(heading != null ? { heading } : {}),
      ...(markdown != null ? { body_markdown: markdown } : {}),
      updated_at: new Date().toISOString(),
      updated_by: caller.email.toLowerCase(),
    })
    .eq('key', key)
  if (error) return NextResponse.json({ error: 'Saving failed: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
