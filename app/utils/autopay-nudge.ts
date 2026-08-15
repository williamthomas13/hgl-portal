// PL-362: THE one autopay nudge — every "set up autopay" ask in family
// email composes from here (T1/T1B proposals, T2 invoice, T2B reminders,
// T8 welcome, the BL monthly transition) and nowhere else, so the wording
// can never drift and no email can carry two asks. Composes EMPTY for
// families already on autopay — never nag the converted — and callers in
// wrong-tone contexts (dunning-exhausted alerts, refund/agreement emails,
// payment-failure emails about a *failing* saved card) simply don't call it.

import { emailBaseUrl } from './base-url'
import { autopayToken } from './tutoring-billing'

export type AutopayNudgeTone = 'invoice' | 'welcome' | 'transition'

const INTROS: Record<AutopayNudgeTone, string> = {
  invoice: 'Prefer not to think about this each month?',
  welcome: 'Prefer not to think about invoices?',
  transition: 'Prefer not to think about the monthly invoices?',
}

/** The copy, pure — the editor sample renders through THIS (PL-96 drift
 *  guard), with its fixed sample link. */
export function autopayNudgeCopyHtml(link: string, tone: AutopayNudgeTone = 'invoice'): string {
  return `<p style="color:#64748b;font-size:13px">${INTROS[tone]} <a href="${link}" style="color:#00AEEE">Set up autopay</a> and each month's confirmed invoice charges your saved card or bank account automatically.</p>`
}

/** The block real sends compose: '' for autopay families, else the pitch
 *  with the family's tokenized consent link (the existing
 *  /tutoring/autopay/{token} page — placement, not new consent machinery). */
export function autopayNudgeHtml(
  family: { id: string; autopay?: boolean | null },
  tone: AutopayNudgeTone = 'invoice'
): string {
  if (family.autopay) return ''
  return autopayNudgeCopyHtml(`${emailBaseUrl()}/tutoring/autopay/${autopayToken(family.id)}`, tone)
}
