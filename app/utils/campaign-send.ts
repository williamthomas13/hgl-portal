import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, sendAdminAlert } from './email'
import { ADMIN_EMAIL } from './lifecycle'
import { unsubscribeToken } from './campaigns'
import { tutoringStubContext } from './comms-registered'
import { renderVersion } from './comms-db-render'
import { emailBaseUrl } from './base-url'

// PL-201: the campaign send engine. Batches through the existing quota-aware
// choke point (sendOnce, marketing: true — suppression, marketing identity,
// one-click headers all enforced THERE); keeps a transactional reserve so a
// campaign can never starve invoices and schedule notices — a campaign that
// would cross the cap PAUSES and the hourly sweep resumes it tomorrow.
// Every send lands on email_sends (the comms surfaces see campaigns like
// everything else) AND on campaign_recipients (the per-recipient log).

const TRANSACTIONAL_RESERVE = 20

async function quotaRemaining(): Promise<number> {
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
  const cap = Number(capRow?.value ?? 100)
  return Math.max(0, cap - (sendsToday ?? 0) - TRANSACTIONAL_RESERVE)
}

export type CampaignRunResult = {
  sent: number
  suppressed: number
  failed: number
  pendingLeft: number
  status: 'done' | 'paused' | 'error'
  error?: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type PinnedVersion = {
  id: string
  subject: string
  preheader: string
  body_markdown: string
  footer_note: string | null
}

/** Load (and pin, first time) one leg's template version + its meta row. */
async function pinnedTemplate(
  campaignId: string,
  templateKey: string,
  versionColumn: 'template_version_id' | 'student_template_version_id',
  pinnedId: string | null
): Promise<{ version: PinnedVersion; meta: any } | null> {
  const { data: meta } = await supabase
    .from('email_templates')
    .select('template_key, display_name, from_identity, category, audience, active_version_id')
    .eq('template_key', templateKey)
    .maybeSingle()
  if (!meta) return null
  let versionId = pinnedId
  if (!versionId) {
    versionId = meta.active_version_id ?? null
    if (versionId)
      await supabase.from('campaigns').update({ [versionColumn]: versionId }).eq('id', campaignId)
  }
  if (!versionId) return null
  const { data: version } = await supabase
    .from('email_template_versions')
    .select('id, subject, preheader, body_markdown, footer_note')
    .eq('id', versionId)
    .single()
  return version ? { version: version as PinnedVersion, meta } : null
}

export async function runCampaignSend(campaignId: string): Promise<CampaignRunResult> {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select(
      'id, name, template_key, template_version_id, student_template_key, student_template_version_id, audience_mode, status'
    )
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { sent: 0, suppressed: 0, failed: 0, pendingLeft: 0, status: 'error', error: 'Unknown campaign.' }
  if (!['sending', 'paused', 'draft', 'scheduled'].includes(campaign.status)) {
    return { sent: 0, suppressed: 0, failed: 0, pendingLeft: 0, status: 'error', error: `Campaign is ${campaign.status}.` }
  }

  // Pin versions at first send; pinned ones on resume.
  const parentTpl = await pinnedTemplate(
    campaignId,
    campaign.template_key,
    'template_version_id',
    campaign.template_version_id
  )
  if (!parentTpl) {
    return { sent: 0, suppressed: 0, failed: 0, pendingLeft: 0, status: 'error', error: 'The template has no version to send.' }
  }
  const studentTpl =
    campaign.audience_mode === 'pairs' && campaign.student_template_key
      ? await pinnedTemplate(
          campaignId,
          campaign.student_template_key,
          'student_template_version_id',
          campaign.student_template_version_id
        )
      : null
  if (campaign.audience_mode === 'pairs' && !studentTpl) {
    return { sent: 0, suppressed: 0, failed: 0, pendingLeft: 0, status: 'error', error: 'The student template has no version to send.' }
  }

  const { data: pendingRows } = await supabase
    .from('campaign_recipients')
    .select('id, email, name, family_id, role, student_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .order('email')
  const pending = pendingRows ?? []

  await supabase.from('campaigns').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', campaignId)

  const room = await quotaRemaining()
  const batch = pending.slice(0, room)
  let sent = 0
  let suppressed = 0
  let failed = 0

  // Family + student facts for the composer contexts (PL-280 Phase B: the
  // FULL variable vocabulary via stub contexts — same pipeline as the
  // editor previews, so what previews is what sends).
  const famIds = [...new Set(batch.map((r) => r.family_id).filter(Boolean))] as string[]
  const famById = new Map<string, any>()
  if (famIds.length > 0) {
    const { data: fams } = await supabase
      .from('families')
      .select('id, parent_first_name, parent_last_name, parent_email, students ( id, first_name, last_name, student_email, pronouns )')
      .in('id', famIds)
    for (const f of (fams as any[]) ?? []) famById.set(f.id, f)
  }

  for (const r of batch) {
    const fam = r.family_id ? famById.get(r.family_id) : null
    const kids: any[] = (fam?.students as any[]) ?? []
    // The leg's student: the addressed student (student legs), else the
    // family's first (parent legs keep v1's semantics).
    const legStudent = (r.role === 'student' && r.student_id
      ? kids.find((k) => k.id === r.student_id)
      : kids[0]) ?? null
    // PL-280 (per-person unsubscribe): each leg's footer tokenizes ITS OWN
    // address — a student unsubscribing suppresses the student email only,
    // and vice versa. renderVersion's non-transactional footer reads
    // ctx.unsubscribeUrl.
    const unsubUrl = `${emailBaseUrl()}/unsubscribe/${unsubscribeToken(r.email)}`
    const ctx = tutoringStubContext({
      parentFirstName: fam?.parent_first_name ?? (r.role === 'parent' ? (r.name ?? '').split(' ')[0] || 'there' : 'there'),
      parentEmail: fam?.parent_email ?? (r.role === 'parent' ? r.email : ''),
      studentFirstName: legStudent?.first_name ?? 'your student',
      studentLastName: legStudent?.last_name ?? '',
      studentPronouns: legStudent?.pronouns ?? null,
    })
    ctx.unsubscribeUrl = unsubUrl
    ctx.studentEmail = r.role === 'student' ? r.email : (legStudent?.student_email ?? null)

    const leg = r.role === 'student' && studentTpl ? studentTpl : parentTpl
    let rendered: { subject: string; html: string }
    try {
      rendered = renderVersion(
        leg.version,
        leg.meta,
        ctx,
        r.role === 'student' ? 'student' : 'parent',
        // {studentNames} predates the full vocabulary — keep it resolving
        // for existing marketing bodies. (The footer's unsubscribe comes
        // from ctx.unsubscribeUrl, per leg.)
        { studentNames: kids.map((k) => k.first_name).join(' & ') || 'your student' }
      )
    } catch (e) {
      console.error(`campaign render failed for ${r.email}:`, e)
      failed++
      await supabase.from('campaign_recipients').update({ status: 'failed' }).eq('id', r.id)
      continue
    }
    const result = await sendOnce({
      marketing: true,
      dedupeKey:
        r.role === 'student'
          ? `campaign:${campaignId}:s:${r.email.toLowerCase()}`
          : `campaign:${campaignId}:${r.email.toLowerCase()}`,
      emailType: 'CAMPAIGN',
      templateKey: leg.meta.template_key,
      to: [r.email],
      subject: rendered.subject,
      html: rendered.html,
      bodySnapshotId: leg.version.id,
    })
    const status =
      result === 'sent' || result === 'duplicate' ? 'sent' : result === 'suppressed' ? 'suppressed' : 'failed'
    if (status === 'sent') sent++
    else if (status === 'suppressed') suppressed++
    else failed++
    await supabase
      .from('campaign_recipients')
      .update({ status, sent_at: status === 'sent' ? new Date().toISOString() : null })
      .eq('id', r.id)
  }

  const pendingLeft = pending.length - batch.length
  const finalStatus = pendingLeft > 0 ? 'paused' : 'done'
  await supabase
    .from('campaigns')
    .update({ status: finalStatus, updated_at: new Date().toISOString() })
    .eq('id', campaignId)

  if (pendingLeft > 0) {
    await sendAdminAlert({
      dedupeKey: `campaign_paused:${campaignId}:${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })}`,
      adminEmail: ADMIN_EMAIL,
      subject: `Campaign "${campaign.name}" paused at the daily email cap — ${pendingLeft} to go`,
      body: `<p>The campaign sent ${sent} today and paused so regular emails (invoices,
        schedules) keep their headroom — transactional always wins. The remaining
        ${pendingLeft} recipient${pendingLeft === 1 ? '' : 's'} send automatically when the
        quota resets; nothing to do unless you want to
        <a href="${emailBaseUrl()}/admin/campaigns" style="color:#00AEEE">cancel it</a>.</p>`,
    }).catch((e) => console.error('campaign-paused alert failed:', e))
  }

  return { sent, suppressed, failed, pendingLeft, status: finalStatus }
}

/** The sweep's leg: pick up campaigns the cap paused. */
export async function resumePausedCampaigns(): Promise<number> {
  const { data: paused } = await supabase.from('campaigns').select('id').eq('status', 'paused')
  let resumed = 0
  for (const c of paused ?? []) {
    const result = await runCampaignSend(c.id)
    if (result.sent > 0) resumed++
  }
  return resumed
}

/** PL-280: the sweep's other leg — dispatch one-shot scheduled campaigns
 *  whose time has come (same hourly cadence as everything else). */
export async function dispatchScheduledCampaigns(): Promise<number> {
  const { data: due } = await supabase
    .from('campaigns')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
  let dispatched = 0
  for (const c of due ?? []) {
    // Claim: only one runner flips scheduled → sending (overlapping sweeps).
    const { data: claimed } = await supabase
      .from('campaigns')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', c.id)
      .eq('status', 'scheduled')
      .select('id')
    if (!claimed || claimed.length === 0) continue
    await runCampaignSend(c.id)
    dispatched++
  }
  return dispatched
}
