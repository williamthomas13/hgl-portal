import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { agreementToken } from '../../../utils/intake'
import { agreementRequestEmail } from '../../../utils/intake-emails'
import { loadContactInfo } from '../../../utils/tutoring-emails'
import { sendOnce } from '../../../utils/email'
import { snapshotAcceptancePdf } from '../../../utils/agreement-pdf'

// Staff agreement actions (Phase 7e, spec §12): signed download URL for a
// PDF snapshot, send/chase the acceptance link, publish a new policy version
// (old acceptances remain valid records of what was agreed when), and retry
// a failed PDF snapshot.

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const KIND = 'scheduling_billing_policy'

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const acceptanceId = new URL(req.url).searchParams.get('acceptance')
  if (!acceptanceId) return NextResponse.json({ error: 'Missing acceptance id.' }, { status: 400 })

  const { data: acc } = await supabase
    .from('agreement_acceptances')
    .select('id, pdf_snapshot_path, pdf_error')
    .eq('id', acceptanceId)
    .maybeSingle()
  if (!acc) return NextResponse.json({ error: 'Unknown acceptance.' }, { status: 404 })
  if (!acc.pdf_snapshot_path) {
    return NextResponse.json(
      { error: acc.pdf_error ?? 'No PDF snapshot yet — try the retry button.' },
      { status: 404 }
    )
  }

  const { data: signed, error } = await supabase.storage
    .from('collateral-private')
    .createSignedUrl(acc.pdf_snapshot_path, 3600)
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'Could not sign the URL.' }, { status: 500 })
  }
  return NextResponse.json({ url: signed.signedUrl })
}

type Body =
  | { action: 'send_link'; family_id: string }
  | { action: 'new_version'; body_markdown: string; effective_date?: string }
  | { action: 'retry_pdf'; acceptance_id: string }

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  try {
    if (body.action === 'send_link') {
      if (!body.family_id) return NextResponse.json({ error: 'Missing family id.' }, { status: 400 })
      const { data: family } = await supabase
        .from('families')
        .select('id, parent_first_name, parent_email, billing_cc_emails')
        .eq('id', body.family_id)
        .maybeSingle()
      if (!family?.parent_email) {
        return NextResponse.json({ error: 'The family has no parent email on file.' }, { status: 400 })
      }
      const contact = await loadContactInfo()
      const email = agreementRequestEmail({
        parentFirst: family.parent_first_name ?? null,
        link: `${appUrl()}/agreements/${agreementToken(family.id)}`,
        contact,
      })
      // Timestamped dedupe key: chasing is a feature; history stays in email_sends.
      const sent = await sendOnce({
        dedupeKey: `agreement_request:${family.id}:${Date.now()}`,
        emailType: 'agreement_request',
        to: [family.parent_email],
        cc: family.billing_cc_emails?.length ? family.billing_cc_emails : undefined,
        subject: email.subject,
        html: email.html,
      })
      if (sent === 'failed') {
        return NextResponse.json({ error: 'Email send failed — check the comms dashboard.' }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'new_version') {
      const markdown = (body.body_markdown ?? '').trim()
      if (markdown.length < 100) {
        return NextResponse.json(
          { error: 'That policy text looks too short — paste the full document.' },
          { status: 400 }
        )
      }
      const { data: latest } = await supabase
        .from('agreement_templates')
        .select('version')
        .eq('kind', KIND)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextVersion = (latest?.version ?? 0) + 1
      // Old acceptances stay pinned to their version rows — only `active` moves.
      const { error: deactivateError } = await supabase
        .from('agreement_templates')
        .update({ active: false })
        .eq('kind', KIND)
      if (deactivateError) return NextResponse.json({ error: deactivateError.message }, { status: 500 })
      const { data: created, error } = await supabase
        .from('agreement_templates')
        .insert({
          kind: KIND,
          version: nextVersion,
          body_markdown: markdown,
          effective_date: body.effective_date || new Date().toISOString().slice(0, 10),
          active: true,
        })
        .select('id, version')
        .single()
      if (error || !created) return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 })
      return NextResponse.json({ ok: true, version: created.version })
    }

    if (body.action === 'retry_pdf') {
      if (!body.acceptance_id) return NextResponse.json({ error: 'Missing acceptance id.' }, { status: 400 })
      const res = await snapshotAcceptancePdf(body.acceptance_id)
      if (!res.ok) return NextResponse.json({ error: res.error ?? 'Snapshot failed again.' }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    console.error('agreements route error:', e)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
