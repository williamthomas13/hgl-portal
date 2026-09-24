// PL-501 (batch 56): the school-accent safety rule in a CLIENT-SAFE module.
// It lived in collateral.ts, which imports the server-only Supabase client —
// the moment a client component (the admin Classes list's SchoolTile) reached
// it, the whole admin page died with "supabase-admin was imported in browser
// code" (caught by regress:client-imports + the headless walk). collateral.ts
// re-exports it, so its server callers are unchanged.

export const HGL_BLUE = '#00AEEE'

/** The accent color fills the flyer's burst and CTA circles behind WHITE
 *  text, so a near-white school color (SLS stores #ffffff) renders the text
 *  invisible. Colors too light to carry white text — or unparseable ones —
 *  fall back to HGL blue exactly like an unset color. Exported for PL-348:
 *  the public class page's hero band uses the same safety rule. */
export function usableAccent(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m) return HGL_BLUE
  const n = parseInt(m[1], 16)
  const luminance = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)
  return luminance > 200 ? HGL_BLUE : `#${m[1]}`
}
