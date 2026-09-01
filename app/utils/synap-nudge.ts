import { supabaseAdmin as supabase } from './supabase-admin'
import { sendAdminAlert } from './email'
import { emailBaseUrl } from './base-url'
import { ADMIN_EMAIL, SEQUENCE, addDaysISO } from './lifecycle'
import { classDisplayLabel } from './class-label'
import { creatorRecipient } from './creator-recipient'
import { formatDateLong } from './dates'

// PL-442B: the Synap-group doorbell — the collateral nudge's twin (PL-429
// pattern), urgency-keyed, never a dumb timer. It rings when the FIRST
// synap-consuming email approaches: the diagnostic-intro step (#2,
// 'synap_access') sends at first session −10 days, and the nudge starts 3
// days before that send date (the same horizon the missing-details warning
// uses) while the wizard's deliberate-skip stamp still stands and the group
// is still blank. Once per class, ever (sendOnce dedupe — the dashboard row
// stays the persistent reminder); filling the group clears the stamp (wizard
// edits and the roster's inline edit both do), which cancels a not-yet-rung
// nudge by making the condition false. Recipient: the class's CREATOR
// (PL-439 rule), admin default when unknown. Lives here, not in the cron
// route, so the compile-and-call harness can prove selection and once-only.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

/** The date the class's first synap-consuming email (#2) sends — derived
 *  from the SEQUENCE offset, never hardcoded (retiming #2 retimes this). */
export function synapAccessSendDate(firstSession: string): string {
  const step = SEQUENCE.find((s) => s.type === 'synap_access')!
  return addDaysISO(firstSession, step.offsetDays)
}

/** The nudge starts 3 days before #2 is due — the urgency moment. */
export function synapNudgeStart(firstSession: string): string {
  return addDaysISO(synapAccessSendDate(firstSession), -3)
}

export async function sweepSynapNudges(): Promise<number> {
  const { data: classes } = await supabase
    .from('classes')
    .select(
      `id, class_type, status, start_date, delivery_mode, has_diagnostics,
       synap_group, synap_reminder_at, created_by, fo_short_name,
       schools ( nickname ), sessions ( session_date )`
    )
    .not('synap_reminder_at', 'is', null)
    .neq('status', 'cancelled')

  const todayIso = new Date().toLocaleDateString('en-CA')
  let rang = 0
  for (const c of (classes as any[]) ?? []) {
    if (c.has_diagnostics === false) continue // field irrelevant — never nag
    if ((c.synap_group ?? '').trim()) continue // filled = done
    const dates = ((c.sessions ?? []) as any[]).map((s) => s.session_date).sort()
    const firstDay = dates[0] ?? c.start_date
    const lastDay = dates[dates.length - 1] ?? c.start_date
    if (!firstDay || lastDay < todayIso) continue // run over — nothing to protect
    // THE MOMENT: the first diagnostic email is 3 days out (or closer/past).
    if (todayIso < synapNudgeStart(firstDay)) continue

    const label = classDisplayLabel({
      schoolNickname: one<any>(c.schools)?.nickname ?? null,
      deliveryMode: c.delivery_mode,
      shortName: c.fo_short_name,
      classType: c.class_type,
    })
    // PL-439 rule: the creator gets the doorbell (they checked the skip box's
    // class into existence); unknown/departed → the standing admin default.
    const creator = await creatorRecipient(c.created_by)
    const status = await sendAdminAlert({
      // Once per class, ever — the dashboard row is the persistent reminder.
      dedupeKey: `synap_nudge:${c.id}`,
      adminEmail: creator ?? ADMIN_EMAIL,
      direct: Boolean(creator),
      templateKey: 'AL_SYNAP_NUDGE',
      vars: { alertClassName: label },
      subject: `${label}'s Synap group still isn't set — the first diagnostic email is coming up`,
      body: `<p><strong>${label}</strong> was created with &ldquo;no Synap group yet&rdquo; checked, and the
        first diagnostic email is due <strong>${formatDateLong(synapAccessSendDate(firstDay))}</strong> (10 days before
        the first session). Until the group is filled in, that email's access button lands on the
        parent portal instead of the diagnostic tests.</p>
        <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?synap=${c.id}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Add the Synap group</a></p>
        <p>Fill it in under the class card&rsquo;s Edit class details. The dashboard reminder stays until
        it's done; this email won't repeat for this class.</p>`,
    })
    if (status === 'sent') rang++
  }
  return rang
}
/* eslint-enable @typescript-eslint/no-explicit-any */
