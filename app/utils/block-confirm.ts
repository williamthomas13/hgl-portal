import { supabaseAdmin as supabase } from './supabase-admin'
import { emailBaseUrl } from './base-url'
import { sendOnce, wrap, footerT, type Rendered } from './email'
import { renderRegistered } from './comms-registered'

// PL-299: hours-block exhaustion — the FAMILY confirms the move to standard
// monthly 1-on-1 billing BEFORE the block runs out (her business model:
// blocks are only sold as group-class add-ons; what follows is the normal
// monthly path, and the family must opt into it, not discover it on an
// invoice).
//
// State machine (tutoring_engagements.block_confirmation):
//   null      — pre-flow. Legacy engagements keep PL-197 behavior exactly
//               (Roman's already-overdrawn 24/15 keeps its carry + the
//               acknowledge surface). Nothing changes until the sweep asks.
//   asked     — the threshold email went out. From here, scheduling past the
//               block REFUSES (no walk-past — the consent that matters is the
//               family's, not the scheduler's) and generation never writes
//               overflow lines.
//   confirmed — the family said continue: PL-197 Case-A billing IS the
//               standard monthly path (overflow bills at the engagement rate
//               on the monthly invoices; remaining hours draw down first) —
//               the PL-84/86 "conversion" needs no funding flip.
//   declined  — sessions stop when the hours do; overflow never bills; any
//               already-planned sessions past the block surface for
//               cancellation on the dashboard.
//
// NO tokenized link (explicit): confirmation is the signed-in portal control
// or a reply recorded by the admin mirror action.

/** Threshold by block size: 15h→3h left · 10h→2h · 5h→1h · other sizes →
 *  20% rounded up (e.g. 8h→2h, 20h→4h). */
export function blockThreshold(blockHours: number): number {
  if (blockHours === 15) return 3
  if (blockHours === 10) return 2
  if (blockHours === 5) return 1
  return Math.max(0.5, Math.ceil(blockHours * 0.2))
}

/** The consent gate: scheduling/billing past the block holds in these
 *  states. Null (pre-flow) and confirmed do NOT hold. */
export function blockHoldActive(blockConfirmation: string | null): boolean {
  return blockConfirmation === 'asked' || blockConfirmation === 'declined'
}

/* eslint-disable @typescript-eslint/no-explicit-any */

type BlockEngagement = {
  id: string
  addonId: string
  blockHours: number
  usedHours: number
  remainingHours: number
  hourlyRate: number
  blockConfirmation: string | null
  studentFirstName: string
  parentFirstName: string
  parentEmail: string | null
  familyId: string
}

/** Every ACTIVE block-funded engagement with its drawdown (the PL-197
 *  consuming rule: rescheduled counts only when late). */
export async function loadBlockEngagements(): Promise<BlockEngagement[]> {
  const { data: engs } = await supabase
    .from('tutoring_engagements')
    .select(
      `id, addon_id, hourly_rate, status, block_confirmation,
       students!inner ( first_name, family_id, families!inner ( id, parent_first_name, parent_email ) ),
       enrollment_addons!tutoring_engagements_addon_id_fkey ( id, hours )`
    )
    .eq('status', 'active')
    .not('addon_id', 'is', null)
  const out: BlockEngagement[] = []
  for (const e of ((engs as any[]) ?? [])) {
    const addon = Array.isArray(e.enrollment_addons) ? e.enrollment_addons[0] : e.enrollment_addons
    const student = Array.isArray(e.students) ? e.students[0] : e.students
    const family = Array.isArray(student?.families) ? student.families[0] : student?.families
    const blockHours = Number(addon?.hours ?? 0)
    if (!(blockHours > 0) || !student || !family) continue
    const { data: consuming } = await supabase
      .from('tutoring_sessions')
      .select('duration_minutes, status, reschedule_notice')
      .eq('engagement_id', e.id)
      .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled'])
    const used = ((consuming as any[]) ?? [])
      .filter((s) => s.status !== 'rescheduled' || s.reschedule_notice === 'late')
      .reduce((sum, s) => sum + s.duration_minutes / 60, 0)
    out.push({
      id: e.id,
      addonId: e.addon_id,
      blockHours,
      usedHours: Number(used.toFixed(1)),
      remainingHours: Number(Math.max(0, blockHours - used).toFixed(1)),
      hourlyRate: Number(e.hourly_rate),
      blockConfirmation: e.block_confirmation ?? null,
      studentFirstName: student.first_name,
      parentFirstName: family.parent_first_name,
      parentEmail: family.parent_email ?? null,
      familyId: family.id,
    })
  }
  return out
}

/** The code twin of BL_BLOCK_CONFIRM — keep in lockstep with the seed. */
function blockConfirmEmail(e: BlockEngagement): Rendered {
  const base = emailBaseUrl()
  return {
    subject: `${e.studentFirstName}'s tutoring hours are almost used up — one quick confirmation`,
    html: wrap(
      `
      <p>Hi ${e.parentFirstName},</p>
      <p>A quick heads-up: ${e.studentFirstName} has <strong>${e.remainingHours} of the
      ${e.blockHours} tutoring hours</strong> you purchased left.</p>
      <p>When those hours are used up, tutoring simply continues on our standard 1-on-1 plan —
      same tutor, same schedule — billed monthly at <strong>$${e.hourlyRate}/hr</strong>.</p>
      <p><strong>Please confirm you'd like to continue</strong>: open your family portal (no
      password needed) and use the "Continue after the hours" button — or just reply to this
      email and we'll record it for you.</p>
      <p style="margin:20px 0"><a href="${base}/portal" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open your family portal</a></p>
      <p>If we don't hear from you, nothing bills past the hours you purchased — the sessions
      simply stop when the hours do.</p>
      <p>Thanks!</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `${e.remainingHours} of ${e.blockHours} hours left — confirm to continue`,
        footer: footerT(),
      }
    ),
  }
}

export type BlockSweepResult = { asked: number }

/** The hourly-sweep leg: at/below the threshold with no decision on record,
 *  ask the parent once. Idempotent via the state flip + sendOnce dedupe. */
export async function sweepBlockConfirmations(): Promise<BlockSweepResult> {
  const result: BlockSweepResult = { asked: 0 }
  const engagements = await loadBlockEngagements()
  for (const e of engagements) {
    if (e.blockConfirmation !== null) continue
    if (e.remainingHours > blockThreshold(e.blockHours)) continue
    // Already past the block when this shipped = the LEGACY case (PL-197
    // ack flow + Case-A billing keep working; Roman's 24/15 carry must not
    // freeze behind a hold). The ask is only meaningful BEFORE exhaustion.
    if (e.usedHours > e.blockHours + 0.05) continue
    if (!e.parentEmail) continue
    const email = await renderRegistered(
      'BL_BLOCK_CONFIRM',
      { parentFirstName: e.parentFirstName, parentEmail: e.parentEmail, studentFirstName: e.studentFirstName },
      {
        blockHoursLeft: String(e.remainingHours),
        blockHours: String(e.blockHours),
        tutoringHourlyRate: `$${e.hourlyRate}`,
      },
      () => blockConfirmEmail(e)
    )
    const status = await sendOnce({
      dedupeKey: `block_confirm_ask:${e.id}`,
      emailType: 'BL_BLOCK_CONFIRM',
      templateKey: 'BL_BLOCK_CONFIRM',
      to: [e.parentEmail],
      subject: email.subject,
      html: email.html,
      bodySnapshotId: email.versionId,
    })
    if (status === 'sent' || status === 'duplicate') {
      // Claimed (or already had been) — flip to asked; the holds arm now.
      await supabase
        .from('tutoring_engagements')
        .update({ block_confirmation: 'asked', block_confirmation_asked_at: new Date().toISOString() })
        .eq('id', e.id)
        .is('block_confirmation', null)
      if (status === 'sent') result.asked++
    }
  }
  return result
}

/** Record the family's decision — from the signed-in portal ('portal') or
 *  the admin mirror action ('admin', for phone/email confirmations). */
export async function recordBlockDecision(
  engagementId: string,
  decision: 'confirmed' | 'declined',
  via: 'portal' | 'admin'
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('tutoring_engagements')
    .update({
      block_confirmation: decision,
      block_confirmation_at: new Date().toISOString(),
      block_confirmation_via: via,
    })
    .eq('id', engagementId)
    .in('block_confirmation', ['asked', 'confirmed', 'declined'])
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) {
    return { ok: false, error: "This engagement hasn't been asked yet — the low-hours email goes out first." }
  }
  return { ok: true }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
