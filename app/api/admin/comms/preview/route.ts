import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { renderSendRow } from '../../../../utils/comms-render'

// Feature A3 Preview: render an email_sends row with the enrollment's real
// variables. For sent history this is a best-effort re-render with CURRENT
// data (the true body snapshot arrives with A4's body_snapshot_id); the UI
// labels it accordingly.
export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  const { data: row } = await supabase
    .from('email_sends')
    .select('id, dedupe_key, template_key, enrollment_id, subject_rendered')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const rendered = await renderSendRow(row)
  if (!rendered) {
    return NextResponse.json(
      { error: 'This template is event-driven and cannot be re-rendered outside the pipeline.' },
      { status: 422 }
    )
  }
  return NextResponse.json({ subject: rendered.subject, html: rendered.html })
}
