// PL-454: THE one routing rule for a family's optional billing contact.
//
// families.billing_email (+ billing_name, PL-454) is a DELIVERY address only —
// parent_email stays the sign-in identity, the RLS key, and the address of
// every enrollment/logistics email. Which templates are "billing" is declared
// ONCE on the registry key list (comms-template-seed.ts: `billing:`), never
// per call site; this helper is the only place that reads the flag, so every
// billing send addresses identically and clearing the field returns everything
// to the parent. The tokenized links inside those emails (autopay consent,
// proposal review, hosted invoice) resolve the FAMILY by id — they never
// depended on who received the email, so a billing contact can act on them
// without a login. The send log records to[0] as recipient_email and cc as
// cc — the real addresses, always.
import { BILLING_TEMPLATE_KEYS } from './comms-template-seed'

export type BillingRoutedFamily = {
  parent_email: string
  billing_email?: string | null
  /** Pass the family's cc list ONLY where the send already cc'd it (the
   *  tutoring billing set). Callers that never cc'd (PR1–4) omit it, so a
   *  family with no billing contact is byte-identical to before. */
  billing_cc_emails?: string[] | null
}

export type FamilyRecipients = { to: string[]; cc?: string[] }

const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase()

/** The billing contact address when one is set and usable, else null. A
 *  billing email equal to the parent's is "not set" (nothing to reroute). */
export function billingContactEmail(family: Pick<BillingRoutedFamily, 'parent_email' | 'billing_email'>): string | null {
  const b = norm(family.billing_email)
  if (!b || b === norm(family.parent_email)) return null
  return family.billing_email!.trim()
}

/** Whether `templateKey` is billing-flagged in the registry (and how). */
export function billingVerdict(templateKey: string): 'replaces' | 'copies-parent' | null {
  return BILLING_TEMPLATE_KEYS.get(templateKey) ?? null
}

/** Where a family-facing send of `templateKey` goes. Non-billing templates
 *  and families without a billing contact: to the parent, cc exactly what
 *  the caller supplied (unchanged behaviour). Billing templates with a
 *  billing contact: to the billing contact; the parent is cc'd only when the
 *  registry verdict is 'copies-parent'. */
export function familyRecipients(family: BillingRoutedFamily, templateKey: string): FamilyRecipients {
  const parent = family.parent_email
  const supplied = (family.billing_cc_emails ?? []).filter((c) => norm(c))
  const billing = billingContactEmail(family)
  const verdict = billingVerdict(templateKey)
  if (!billing || !verdict) {
    return supplied.length ? { to: [parent], cc: supplied } : { to: [parent] }
  }
  const cc = [
    ...(verdict === 'copies-parent' ? [parent] : []),
    ...supplied.filter((c) => norm(c) !== norm(parent) && norm(c) !== norm(billing)),
  ]
  return cc.length ? { to: [billing], cc } : { to: [billing] }
}

/** The address a money document is ADDRESSED to (Stripe customer email, the
 *  admin "send a manual email" mailto): the billing contact when set, else
 *  the parent. Same rule, one place. */
export function billingAddress(family: Pick<BillingRoutedFamily, 'parent_email' | 'billing_email'>): string {
  return billingContactEmail(family) ?? family.parent_email
}
