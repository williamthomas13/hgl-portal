// PL-362: THE one autopay nudge — every "set up autopay" ask in family
// email composes from here (T1/T1B proposals, T2 invoice, T2B reminders,
// T8 welcome, the BL monthly transition) and nowhere else, so the wording
// can never drift and no email can carry two asks. Composes EMPTY for
// families already on autopay — never nag the converted — and callers in
// wrong-tone contexts (dunning-exhausted alerts, refund/agreement emails,
// payment-failure emails about a *failing* saved card) simply don't call it.
// The pure copy lives in autopay-nudge-copy.ts (client-safe — the editor
// sample renders through it, the PL-96 drift guard).

import { emailBaseUrl } from './base-url'
import { autopayToken } from './tutoring-billing'
import { autopayNudgeCopyHtml, type AutopayNudgeTone } from './autopay-nudge-copy'

export { autopayNudgeCopyHtml, type AutopayNudgeTone }

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
