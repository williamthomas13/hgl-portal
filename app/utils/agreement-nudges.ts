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
    .select('id, status, students!inner ( first_name, families!inner ( id, parent_first_name, parent_last_name, parent_email ) )')
    .eq('status', 'active')
  const families = new Map<string, { first: string | null; last: string | null; email: string; students: Set<string> }>()
  for (const eng of (engagements as any[]) ?? []) {
    const student = one<any>(eng.students)
    const fam = one<any>(student?.families)
    if (!fam?.id || !fam.parent_email) continue
    const entry = families.get(fam.id) ?? {
      first: fam.parent_first_name,
      last: fam.parent_last_name,
      email: fam.parent_email,
      students: new Set<string>(),
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

    // Anchor: the FIRST ask — T8's ride-along link or a manual AG send.
    const { data: anchorRow } = await supabase
      .from('email_sends')
      .select('sent_at')
      .eq('recipient_email', fam.email.toLowerCase())
      .in('template_key', ['AG_REQUEST', 'AG_NUDGE', 'T8_WELCOME_HANDOFF'])
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!anchorRow?.sent_at) continue // never asked — the ask starts the clock, not the sweep
    const anchorMs = new Date(anchorRow.sent_at).getTime()

    const { data: n1 } = await supabase
      .from('email_sends')
      .select('sent_at, status')
      .eq('dedupe_key', `agreement_nudge_1:${familyId}`)
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
        dedupeKey: `agreement_nudge_1:${familyId}`,
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
        dedupeKey: `agreement_nudge_2:${familyId}`,
        emailType: 'agreement_nudge',
        to: [fam.email],
        subject: email.subject,
        html: email.html,
      })
      if (status === 'sent') {
        result.nudged2++
        const name = `${fam.first ?? ''} ${fam.last ?? ''}`.trim() || fam.email
        const alerted = await sendAdminAlert({
          dedupeKey: `agreement_unsigned:${familyId}`,
          adminEmail: ADMIN_EMAIL,
          subject: `Policies still unsigned — ${name}`,
          body: `<p><strong>${name}</strong> (${fam.email}) has been asked twice and still hasn't
            accepted the scheduling &amp; billing policies. This was the last automatic nudge —
            it's a phone-call matter now. Their link can be re-sent from
            <strong>/admin/agreements</strong>.</p>`,
        })
        if (alerted !== 'failed') result.alerted++
      }
    }
  }
  return result
}
