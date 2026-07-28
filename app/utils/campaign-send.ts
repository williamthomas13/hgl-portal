import { supabaseAdmin as supabase } from './supabase-admin'
import { sendOnce, sendAdminAlert, wrap, footerR } from './email'
import { ADMIN_EMAIL } from './lifecycle'
import { renderMarkdownBody, renderPlain, type ResolvedVars } from './comms-md'
import { unsubscribeToken } from './campaigns'
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

export async function runCampaignSend(campaignId: string): Promise<CampaignRunResult> {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, template_key, template_version_id, status')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { sent: 0, suppressed: 0, failed: 0, pendingLeft: 0, status: 'error', error: 'Unknown campaign.' }
  if (!['sending', 'paused', 'draft'].includes(campaign.status)) {
    return { sent: 0, suppressed: 0, failed: 0, pendingLeft: 0, status: 'error', error: `Campaign is ${campaign.status}.` }
  }

  // Pin the version at first send; use the pinned one on resume.
  let versionId = campaign.template_version_id as string | null
  if (!versionId) {
    const { data: tpl } = await supabase
      .from('email_templates')
      .select('active_version_id')
      .eq('template_key', campaign.template_key)
      .maybeSingle()
    versionId = tpl?.active_version_id ?? null
    if (versionId) await supabase.from('campaigns').update({ template_version_id: versionId }).eq('id', campaignId)
  }
  if (!versionId) {
    return { sent: 0, suppressed: 0, failed: 0, pendingLeft: 0, status: 'error', error: 'The template has no version to send.' }
  }
  const { data: version } = await supabase
    .from('email_template_versions')
    .select('id, subject, preheader, body_markdown, footer_note')
    .eq('id', versionId)
    .single()
  if (!version) {
    return { sent: 0, suppressed: 0, failed: 0, pendingLeft: 0, status: 'error', error: 'Template version missing.' }
  }

  const { data: pendingRows } = await supabase
    .from('campaign_recipients')
    .select('id, email, name, family_id')
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

  // Student first names per family, for {studentNames}.
  const famIds = [...new Set(batch.map((r) => r.family_id).filter(Boolean))] as string[]
  const studentsByFam = new Map<string, string[]>()
  if (famIds.length > 0) {
    const { data: kids } = await supabase.from('students').select('family_id, first_name').in('family_id', famIds)
    for (const k of kids ?? []) {
      studentsByFam.set(k.family_id, [...(studentsByFam.get(k.family_id) ?? []), k.first_name])
    }
  }

  for (const r of batch) {
    const firstName = (r.name ?? '').split(' ')[0] || 'there'
    const unsubUrl = `${emailBaseUrl()}/unsubscribe/${unsubscribeToken(r.email)}`
    const vars: ResolvedVars = {
      parentFirstName: { value: firstName },
      parentName: { value: r.name ?? firstName },
      studentNames: { value: (r.family_id ? studentsByFam.get(r.family_id) ?? [] : []).join(' & ') || 'your student' },
      studentFirstName: { value: (r.family_id ? studentsByFam.get(r.family_id) ?? [] : [])[0] ?? 'your student' },
      unsubscribeLink: { value: unsubUrl },
    }
    const html = wrap(renderMarkdownBody(version.body_markdown, vars), {
      preheader: renderPlain(version.preheader ?? '', vars),
      // footerR = physical address + visible unsubscribe (CAN-SPAM basics).
      footer: footerR(unsubUrl, version.footer_note ?? undefined),
    })
    const result = await sendOnce({
      marketing: true,
      dedupeKey: `campaign:${campaignId}:${r.email.toLowerCase()}`,
      emailType: 'CAMPAIGN',
      templateKey: campaign.template_key,
      to: [r.email],
      subject: renderPlain(version.subject, vars),
      html,
      bodySnapshotId: version.id,
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
