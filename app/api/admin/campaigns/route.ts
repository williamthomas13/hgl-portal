import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { resolveSegment, segmentSummary, type SegmentDef } from '../../../utils/campaigns'
import { runCampaignSend } from '../../../utils/campaign-send'

// PL-201: Campaigns v1 API. preview → the resolved list with WHY each family
// matched (nobody sends to a list they haven't seen) + the quota picture;
// send → snapshot the final list (exclusions applied) and run the batch —
// the engine pauses at the cap and the sweep resumes it. Staff-gated.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Body =
  | { action: 'preview'; segment: SegmentDef }
  | {
      action: 'send'
      name: string
      segment: SegmentDef
      templateKey: string
      excludeEmails?: string[]
      /** Preview count the caller SAW — refuses if the list changed under them. */
      expectedCount: number
    }
  | { action: 'cancel'; id: string }
  | { action: 'resume'; id: string }

async function quotaPicture() {
  const dayStartDenver = new Date(
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) + 'T00:00:00-06:00'
  ).toISOString()
  const [{ data: capRow }, { count: sendsToday }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'resend_daily_cap').maybeSingle(),
    supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'delivered', 'bounced', 'complained'])
      .gte('sent_at', dayStartDenver),
  ])
  return { cap: Number(capRow?.value ?? 100), usedToday: sendsToday ?? 0 }
}

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const [{ data: campaigns }, { data: templates }] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, name, segment, segment_summary, template_key, status, created_at, campaign_recipients ( status )')
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('email_templates')
      .select('template_key, display_name')
      .eq('category', 'marketing')
      .order('display_name'),
  ])
  const rows = ((campaigns as any[]) ?? []).map((c) => {
    const rec = (c.campaign_recipients as any[]) ?? []
    return {
      id: c.id,
      name: c.name,
      segmentSummary: c.segment_summary,
      templateKey: c.template_key,
      status: c.status,
      createdAt: c.created_at,
      counts: {
        sent: rec.filter((r) => r.status === 'sent').length,
        pending: rec.filter((r) => r.status === 'pending').length,
        suppressed: rec.filter((r) => r.status === 'suppressed').length,
        failed: rec.filter((r) => r.status === 'failed').length,
        excluded: rec.filter((r) => r.status === 'excluded').length,
      },
    }
  })
  return NextResponse.json({ campaigns: rows, templates: templates ?? [], quota: await quotaPicture() })
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

  if (body.action === 'preview') {
    const recipients = await resolveSegment(body.segment ?? {})
    return NextResponse.json({
      recipients,
      summary: segmentSummary(body.segment ?? {}),
      quota: await quotaPicture(),
    })
  }

  if (body.action === 'send') {
    if (!body.name?.trim()) return NextResponse.json({ error: 'Give the campaign a name.' }, { status: 400 })
    if (!body.templateKey) return NextResponse.json({ error: 'Pick a template.' }, { status: 400 })
    const { data: tpl } = await supabase
      .from('email_templates')
      .select('template_key, category')
      .eq('template_key', body.templateKey)
      .maybeSingle()
    // Structural: campaigns can ONLY send marketing-category templates.
    if (tpl?.category !== 'marketing') {
      return NextResponse.json({ error: 'Campaigns send marketing templates only.' }, { status: 400 })
    }
    const excluded = new Set((body.excludeEmails ?? []).map((e) => e.toLowerCase()))
    const resolved = await resolveSegment(body.segment ?? {})
    const finalList = resolved.filter((r) => !excluded.has(r.email.toLowerCase()))
    if (finalList.length !== body.expectedCount) {
      return NextResponse.json(
        {
          error: `The list changed since your preview (now ${finalList.length}, you saw ${body.expectedCount}) — preview again before sending.`,
        },
        { status: 409 }
      )
    }
    if (finalList.length === 0) return NextResponse.json({ error: 'Nobody matches — nothing to send.' }, { status: 400 })

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        name: body.name.trim(),
        segment: body.segment ?? {},
        segment_summary: segmentSummary(body.segment ?? {}),
        template_key: body.templateKey,
        status: 'draft',
        created_by: caller.email,
      })
      .select('id')
      .single()
    if (error || !campaign) return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 })

    const rows = [
      ...finalList.map((r) => ({
        campaign_id: campaign.id,
        family_id: r.familyId,
        email: r.email,
        name: r.name,
        why: r.why,
        status: 'pending',
      })),
      // Excluded names stay on the log — the send list is the FULL story.
      ...resolved
        .filter((r) => excluded.has(r.email.toLowerCase()))
        .map((r) => ({
          campaign_id: campaign.id,
          family_id: r.familyId,
          email: r.email,
          name: r.name,
          why: r.why,
          status: 'excluded',
        })),
    ]
    const { error: recErr } = await supabase.from('campaign_recipients').insert(rows)
    if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 })

    const result = await runCampaignSend(campaign.id)
    return NextResponse.json({ ok: true, id: campaign.id, ...result })
  }

  if (body.action === 'resume') {
    const result = await runCampaignSend(body.id)
    return NextResponse.json({ ok: result.status !== 'error', ...result })
  }

  if (body.action === 'cancel') {
    await supabase
      .from('campaigns')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', body.id)
      .in('status', ['draft', 'paused', 'sending'])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
