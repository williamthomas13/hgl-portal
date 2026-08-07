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
      /** PL-280: parent-only (default) or parent+student pairs. */
      audienceMode?: 'parents' | 'pairs'
      studentTemplateKey?: string
      /** PL-280: ISO instant — future = the sweep dispatches it; absent = now. */
      scheduledFor?: string | null
    }
  | { action: 'cancel'; id: string }
  | { action: 'resume'; id: string }
  // PL-280: saved/named segments — live membership (definitions resolve at use).
  | { action: 'save_segment'; name: string; segment: SegmentDef }
  | { action: 'delete_segment'; id: string }

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
  const [{ data: campaigns }, { data: templates }, { data: savedSegments }, { data: opens }] =
    await Promise.all([
      supabase
        .from('campaigns')
        .select(
          'id, name, segment, segment_summary, template_key, student_template_key, audience_mode, scheduled_for, status, created_at, campaign_recipients ( status, role )'
        )
        .order('created_at', { ascending: false })
        .limit(25),
      supabase
        .from('email_templates')
        .select('template_key, display_name, audience')
        .eq('category', 'marketing')
        .order('display_name'),
      // PL-280: saved segments — live membership by construction.
      supabase.from('saved_segments').select('id, name, definition, summary').order('name'),
      // PL-280: opens ride the existing Resend-webhook engagement columns on
      // email_sends — campaigns just read them back by dedupe key.
      supabase
        .from('email_sends')
        .select('dedupe_key, first_opened_at')
        .eq('email_type', 'CAMPAIGN')
        .not('first_opened_at', 'is', null),
    ])
  const opensByCampaign = new Map<string, number>()
  for (const o of (opens as any[]) ?? []) {
    const m = /^campaign:([0-9a-f-]{36}):/.exec(o.dedupe_key ?? '')
    if (m) opensByCampaign.set(m[1], (opensByCampaign.get(m[1]) ?? 0) + 1)
  }
  const rows = ((campaigns as any[]) ?? []).map((c) => {
    const rec = (c.campaign_recipients as any[]) ?? []
    return {
      id: c.id,
      name: c.name,
      segmentSummary: c.segment_summary,
      templateKey: c.template_key,
      studentTemplateKey: c.student_template_key,
      audienceMode: c.audience_mode,
      scheduledFor: c.scheduled_for,
      status: c.status,
      createdAt: c.created_at,
      counts: {
        sent: rec.filter((r) => r.status === 'sent').length,
        pending: rec.filter((r) => r.status === 'pending').length,
        suppressed: rec.filter((r) => r.status === 'suppressed').length,
        failed: rec.filter((r) => r.status === 'failed').length,
        excluded: rec.filter((r) => r.status === 'excluded').length,
        studentLegs: rec.filter((r) => r.role === 'student').length,
        opened: opensByCampaign.get(c.id) ?? 0,
      },
    }
  })
  return NextResponse.json({
    campaigns: rows,
    templates: templates ?? [],
    savedSegments: savedSegments ?? [],
    quota: await quotaPicture(),
  })
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
    // PL-280: the student leg's template, when sending pairs.
    const audienceMode = body.audienceMode === 'pairs' ? 'pairs' : 'parents'
    if (audienceMode === 'pairs') {
      if (!body.studentTemplateKey) {
        return NextResponse.json({ error: 'Pick a student template for paired sends.' }, { status: 400 })
      }
      const { data: sTpl } = await supabase
        .from('email_templates')
        .select('template_key, category')
        .eq('template_key', body.studentTemplateKey)
        .maybeSingle()
      if (sTpl?.category !== 'marketing') {
        return NextResponse.json({ error: 'The student template must be a marketing template too.' }, { status: 400 })
      }
    }
    // PL-280: one-shot scheduling — a future instant parks the campaign as
    // 'scheduled'; the hourly sweep dispatches it.
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null
    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
      return NextResponse.json({ error: 'That scheduled time is not a valid date.' }, { status: 400 })
    }
    const scheduleAhead = Boolean(scheduledFor && scheduledFor.getTime() > Date.now())

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
        audience_mode: audienceMode,
        student_template_key: audienceMode === 'pairs' ? body.studentTemplateKey : null,
        scheduled_for: scheduleAhead ? scheduledFor!.toISOString() : null,
        status: scheduleAhead ? 'scheduled' : 'draft',
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
        role: 'parent',
      })),
      // PL-280: the student legs (pairs mode; only students with an email).
      ...(audienceMode === 'pairs'
        ? finalList.flatMap((r) =>
            r.studentRecords
              .filter((s) => s.email)
              .map((s) => ({
                campaign_id: campaign.id,
                family_id: r.familyId,
                email: s.email!,
                name: s.firstName,
                why: r.why,
                status: 'pending',
                role: 'student',
                student_id: s.id,
              }))
          )
        : []),
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
          role: 'parent',
        })),
    ]
    const { error: recErr } = await supabase.from('campaign_recipients').insert(rows)
    if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 })

    if (scheduleAhead) {
      return NextResponse.json({ ok: true, id: campaign.id, scheduled: true, scheduledFor: scheduledFor!.toISOString() })
    }
    const result = await runCampaignSend(campaign.id)
    return NextResponse.json({ ok: true, id: campaign.id, ...result })
  }

  if (body.action === 'save_segment') {
    if (!body.name?.trim()) return NextResponse.json({ error: 'Give the segment a name.' }, { status: 400 })
    const { error } = await supabase.from('saved_segments').insert({
      name: body.name.trim(),
      definition: body.segment ?? {},
      summary: segmentSummary(body.segment ?? {}),
      created_by: caller.email,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete_segment') {
    await supabase.from('saved_segments').delete().eq('id', body.id)
    return NextResponse.json({ ok: true })
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
      .in('status', ['draft', 'scheduled', 'paused', 'sending'])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
