// PL-362: the autopay nudge's PURE copy — client-safe leaf (no imports) so
// the editor-sample path (comms-variables → client components) can compose
// from the one source without dragging server-only token machinery along.
// autopay-nudge.ts wraps this with the real tokenized link + autopay guard.

export type AutopayNudgeTone = 'invoice' | 'welcome' | 'transition'

const INTROS: Record<AutopayNudgeTone, string> = {
  invoice: 'Prefer not to think about this each month?',
  welcome: 'Prefer not to think about invoices?',
  transition: 'Prefer not to think about the monthly invoices?',
}

export function autopayNudgeCopyHtml(link: string, tone: AutopayNudgeTone = 'invoice'): string {
  return `<p style="color:#64748b;font-size:13px">${INTROS[tone]} <a href="${link}" style="color:#00AEEE">Set up autopay</a> and each month's confirmed invoice charges your saved card or bank account automatically.</p>`
}
