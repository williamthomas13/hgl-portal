import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyAgreementToken } from '../../utils/intake'
import { snapshotAcceptancePdf } from '../../utils/agreement-pdf'

// Public acceptance recording (Phase 7e, spec §12), authenticated by the
// signed link token. Ordering is deliberate: the acceptance row is recorded
// FIRST (that's the legal record — identity, timestamp, IP, pinned template
// version), then the PDF snapshot renders best-effort behind the response —
// a chromium hiccup must never lose an acceptance.

export async function POST(req: Request) {
  let body: { token?: string; name?: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const familyId = body.token ? verifyAgreementToken(body.token) : null
  if (!familyId) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  }
  const name = (body.name ?? '').trim().slice(0, 200)
  const email = (body.email ?? '').trim().toLowerCase().slice(0, 200)
  if (!name) return NextResponse.json({ error: 'Please type your full name.' }, { status: 400 })
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const { data: family } = await supabase
    .from('families')
    .select('id')
    .eq('id', familyId)
    .maybeSingle()
  if (!family) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })

  const { data: template } = await supabase
    .from('agreement_templates')
    .select('id, version')
    .eq('kind', 'scheduling_billing_policy')
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!template) {
    return NextResponse.json({ error: 'There is no active policy to accept right now.' }, { status: 400 })
  }

  // Idempotent: an existing acceptance of the active version stands as-is.
  const { data: existing } = await supabase
    .from('agreement_acceptances')
    .select('id')
    .eq('family_id', familyId)
    .eq('agreement_template_id', template.id)
    .limit(1)
    .maybeSingle()
  if (existing) return NextResponse.json({ ok: true, already: true })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = req.headers.get('user-agent')?.slice(0, 500) ?? null

  const { data: acceptance, error } = await supabase
    .from('agreement_acceptances')
    .insert({
      agreement_template_id: template.id,
      family_id: familyId,
      accepted_by_name: name,
      accepted_by_email: email,
      ip,
      user_agent: userAgent,
      pdf_error: 'snapshot pending', // cleared by the snapshot; a crash leaves the retry note
    })
    .select('id')
    .single()
  if (error || !acceptance) {
    return NextResponse.json({ error: error?.message ?? 'Could not record the acceptance.' }, { status: 500 })
  }

  // Snapshot behind the response — the parent's confirmation never waits on
  // chromium, and a failure only leaves pdf_error for the admin retry button.
  after(() => snapshotAcceptancePdf(acceptance.id))

  return NextResponse.json({ ok: true })
}
