import { supabaseAdmin as supabase } from './supabase-admin'
import { sendAdminAlert, sendOnce } from './email'
import { renderRegistered } from './comms-registered'
import { agreementNudgeEmail } from './intake-emails'
import { agreementToken } from './intake'
import { contactBlockHtml, loadContactInfo } from './tutoring-emails'
import { ADMIN_EMAIL } from './lifecycle'

// PL-63b: the automatic agreement chase. Kelsie used to re-send policy links
// by hand; now the daily sweep does the remembering, on the same cadence
// pattern as the schedule-confirm flow:
//
//   first ask (T8's ride-along, or a manual send from /admin/agreements)
//     → +3d: AG_NUDGE
//     → +7d: second AG_NUDGE + one Ops Director alert
//     → nothing further, ever (never auto-escalates beyond the alert)
//
// The chase stops the moment the family accepts (the acceptances check gates
// every run). Billing enforcement stays warn-not-block — the §12 behavior is
// unchanged; the firmness lives in the language and this chase, so a
// billed-unsigned family is a slipped crack, not the normal path.

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const DAY_MS = 24 * 3600_000

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export type AgreementNudgeResult = { nudged1: number; nudged2: number; alerted: number }

export async function runAgreementNudges(now: Date = new Date()): Promise<AgreementNudgeResult> {
  const result: AgreementNudgeResult = { nudged1: 0, nudged2: 0, alerted: 0 }

  // Families with an active engagement — the only ones whose sessions the
  // policies gate.
  const { data: engagements } = await supabase
    .from('tutoring_engagements')
    .select(
      'id, status, students!inner ( first_name, families!inner ( id, parent_first_name, parent_last_name, parent_email, agreement_chase_round, agreement_chase_restarted_at ) )'
    )
    .eq('status', 'active')
  const families = new Map<
    string,
    {
      first: string | null
      last: string | null
      email: string
      students: Set<string>
      round: number
      restartedAt: string | null
    }
  >()
  for (const eng of (engagements as any[]) ?? []) {
    const student = one<any>(eng.students)
    const fam = one<any>(student?.families)
    if (!fam?.id || !fam.parent_email) continue
    const entry = families.get(fam.id) ?? {
      first: fam.parent_first_name,
      last: fam.parent_last_name,
      email: fam.parent_email,
      students: new Set<string>(),
      round: Number(fam.agreement_chase_round ?? 0),
      restartedAt: fam.agreement_chase_restarted_at ?? null,
    }
    if (student?.first_name) entry.students.add(student.first_name)
    families.set(fam.id, entry)
  }
  if (families.size === 0) return result

  const contact = await loadContactInfo()

  for (const [familyId, fam] of families) {
    // Accepted → chase over.
    const { count } = await supabase
      .from('agreement_acceptances')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', familyId)
    if ((count ?? 0) > 0) continue

    // PL-74: round-aware. Round 0 anchors on the FIRST ask (T8's ride-along
    // or a manual AG send); a restarted round anchors on the restart stamp
    // and uses fresh dedupe keys so the cadence re-arms cleanly.
    const round = fam.round
    const keySuffix = round > 0 ? `:r${round}` : ''
    let anchorMs: number | null = null
    if (round > 0 && fam.restartedAt) {
      anchorMs = new Date(fam.restartedAt).getTime()
    } else {
      const { data: anchorRow } = await supabase
        .from('email_sends')
        .select('sent_at')
        .eq('recipient_email', fam.email.toLowerCase())
        .in('template_key', ['AG_REQUEST', 'AG_NUDGE', 'T8_WELCOME_HANDOFF'])
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (anchorRow?.sent_at) anchorMs = new Date(anchorRow.sent_at).getTime()
    }
    if (anchorMs == null) continue // never asked — the ask starts the clock, not the sweep

    const { data: n1 } = await supabase
      .from('email_sends')
      .select('sent_at, status')
      .eq('dedupe_key', `agreement_nudge_1:${familyId}${keySuffix}`)
      .maybeSingle()

    const studentNames = [...fam.students].join(' & ') || 'your student'
    const stub = {
      parentFirstName: fam.first ?? 'there',
      parentEmail: fam.email,
      studentFirstName: studentNames,
    }
    const link = `${appUrl()}/agreements/${agreementToken(familyId)}`
    const render = () =>
      renderRegistered(
        'AG_NUDGE',
        stub,
        { agreementsLink: link, contactBlock: contactBlockHtml(contact) },
        () =>
          agreementNudgeEmail({ parentFirst: fam.first, studentNames, link, contact })
      )

    if (!n1 && now.getTime() >= anchorMs + 3 * DAY_MS) {
      const email = await render()
      const status = await sendOnce({
        dedupeKey: `agreement_nudge_1:${familyId}${keySuffix}`,
        emailType: 'agreement_nudge',
        to: [fam.email],
        subject: email.subject,
        html: email.html,
      })
      if (status === 'sent') result.nudged1++
      continue // one step per run — an old anchor never means two emails at once
    }

    // Second nudge: a week past the ask AND a breath after the first nudge.
    if (
      n1?.sent_at &&
      now.getTime() >= anchorMs + 7 * DAY_MS &&
      now.getTime() >= new Date(n1.sent_at).getTime() + 3 * DAY_MS
    ) {
      const email = await render()
      const status = await sendOnce({
        dedupeKey: `agreement_nudge_2:${familyId}${keySuffix}`,
        emailType: 'agreement_nudge',
        to: [fam.email],
        subject: email.subject,
        html: email.html,
      })
      if (status === 'sent') {
        result.nudged2++
        const name = `${fam.first ?? ''} ${fam.last ?? ''}`.trim() || fam.email
        // PL-74: the button deep-links to the agreement row (admin-authed) —
        // never an in-email action. Round ≥ 2 stops pretending another email
        // round is the plan.
        const rowUrl = `${appUrl()}/admin/agreements?family=${familyId}`
        const roundLine =
          round >= 1
            ? round === 1
              ? `<p><strong>Second automatic chase completed — this one really does need a call.</strong></p>`
              : `<p><strong>Automatic chase ${round + 1} completed — this one really does need a call.</strong></p>`
            : `<p>This was the last automatic nudge of this round — you can restart the chase
              from the agreement row, or make it a phone call.</p>`
        const alerted = await sendAdminAlert({
          dedupeKey: `agreement_unsigned:${familyId}${keySuffix}`,
          adminEmail: ADMIN_EMAIL,
          subject: `Policies still unsigned — ${name}`,
          body: `<p><strong>${name}</strong> (${fam.email}) has been asked twice and still hasn't
            accepted the scheduling &amp; billing policies.</p>
            ${roundLine}
            <p style="margin:20px 0"><a href="${rowUrl}" style="background:#506171;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Open the agreement row</a></p>`,
        })
        if (alerted !== 'failed') result.alerted++
      }
    }
  }
  return result
}
