import { supabaseAdmin as supabase } from './supabase-admin'
import { sendAdminAlert } from './email'
import { emailBaseUrl } from './base-url'
import { ADMIN_EMAIL } from './lifecycle'
import { classDisplayLabel } from './class-label'
import { creatorRecipient } from './creator-recipient'

// PL-429A: the skipped-collateral email nudge — urgency-keyed, never a dumb
// timer. It rings at the first moment collateral would actually be USED: the
// CS welcome is otherwise sendable (sessions on the calendar + the
// enrollment deadline set — the same facts the welcome gate checks) while
// the wizard's skip-for-now stamp still stands. Once per class, ever
// (sendOnce dedupe — the dashboard row stays the persistent reminder, the
// email is the doorbell); completing collateral clears the stamp (the
// collateral panel save does this now), which cancels a not-yet-rung nudge
// by making the condition false. Lives here, not in the cron route, so the
// compile-and-call harness can prove the selection and once-only behavior.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export async function sweepCollateralNudges(): Promise<number> {
  const { data: classes } = await supabase
    .from('classes')
    .select(
      `id, class_type, status, start_date, delivery_mode, enrollment_deadline,
       collateral_reminder_at, short_link, school_id, fo_short_name, created_by,
       schools ( nickname ), sessions ( session_date )`
    )
    .not('collateral_reminder_at', 'is', null)
    .not('school_id', 'is', null)
    .neq('status', 'cancelled')

  const todayIso = new Date().toLocaleDateString('en-CA')
  let rang = 0
  for (const c of (classes as any[]) ?? []) {
    // Legacy completion (short_link set pre-PL-384) = done; a class whose
    // run is over needs no nudge.
    if ((c.short_link ?? '').trim()) continue
    const dates = ((c.sessions ?? []) as any[]).map((s) => s.session_date).sort()
    const lastDay = dates[dates.length - 1] ?? c.start_date
    if (lastDay < todayIso) continue
    // The MOMENT: the welcome is otherwise sendable — collateral is the gap.
    if (dates.length === 0 || !c.enrollment_deadline) continue

    const label = classDisplayLabel({
      schoolNickname: one<any>(c.schools)?.nickname ?? null,
      deliveryMode: c.delivery_mode,
      shortName: c.fo_short_name,
      classType: c.class_type,
    })
    // PL-439: the nudge goes to the class's CREATOR (they skipped the
    // collateral, they get the reminder) — direct, no subscription fan-out.
    // Creator unknown or no longer active staff → the standing admin
    // default (subscribers with the legacy fallback), never silently nobody.
    const creator = await creatorRecipient(c.created_by)
    const status = await sendAdminAlert({
      // Once per class, ever — the dashboard row is the persistent reminder.
      dedupeKey: `collateral_nudge:${c.id}`,
      adminEmail: creator ?? ADMIN_EMAIL,
      direct: Boolean(creator),
      templateKey: 'AL_COLLATERAL_NUDGE',
      vars: { alertClassName: label },
      subject: `${label}'s collateral isn't set up — the counselor welcome goes out plain without it`,
      body: `<p><strong>${label}</strong> was created with its flyer &amp; letter setup skipped, and the
        class record is now otherwise ready — the counselor welcome could go out today, but its
        default is the PLAIN version (no flyer or parent letter attached) until the collateral
        fields are finished.</p>
        <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin?collateral=${c.id}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Finish the collateral</a></p>
        <p>Set it up under Classes → Branding &amp; collateral. The dashboard reminder stays until
        it's done; this email won't repeat for this class.</p>`,
    })
    if (status === 'sent') rang++
  }
  return rang
}
/* eslint-enable @typescript-eslint/no-explicit-any */
