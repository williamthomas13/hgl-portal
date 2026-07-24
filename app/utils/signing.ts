import { createHmac, timingSafeEqual } from 'crypto'

// PL-113: secrets fail CLOSED. Server-only — never import from client code.
//
// Two distinct roles, two helpers:
//   · signingSecret() — HMAC key for every emailed/signed link token
//     (convert, claim/decline, availability, intake, unsubscribe, agreement,
//     counselor digest, classroom request, addon checkout, resume,
//     login-prefill, OAuth state). Prefers TOKEN_SIGNING_SECRET; falls back
//     to CRON_SECRET so a deploy without the new var keeps verifying the
//     tokens already in the wild (they have always been CRON_SECRET-signed).
//     Set TOKEN_SIGNING_SECRET in Vercel to complete the role separation —
//     the cron bearer should not double as the signing key forever.
//   · credentialKeySecret() — the input to the AES key derivations that
//     encrypt stored QBO tokens and the Google service-account JSON. Stays
//     on CRON_SECRET DELIBERATELY: rotating it orphans the stored
//     credentials (surfaces as 'disconnected', fixed by reconnecting), and
//     silently switching the derivation would do exactly that on deploy.
//
// Neither helper has a default. A missing secret THROWS — a token that
// anyone can forge with a public string is worse than a loud failure.

export function signingSecret(): string {
  const s = process.env.TOKEN_SIGNING_SECRET || process.env.CRON_SECRET
  if (!s) {
    throw new Error(
      'TOKEN_SIGNING_SECRET (or CRON_SECRET) is not set — refusing to mint or verify signed links.'
    )
  }
  return s
}

export function credentialKeySecret(): string {
  const s = process.env.CRON_SECRET
  if (!s) {
    throw new Error('CRON_SECRET is not set — refusing to derive credential-encryption keys.')
  }
  return s
}

// ---------------------------------------------------------------------------
// PL-149: issued-at + per-type expiry
// ---------------------------------------------------------------------------
// Signed links used to be valid forever. Some types have state-side expiry
// (a claimed waitlist offer stops working), but plenty did not — so a
// forwarded email handed the new reader indefinite access to a family's
// records, and an old thread stayed live years later.
//
// Tokens now carry the day they were issued, and each TYPE gets a lifetime
// proportional to how long a real person could plausibly need it:
//   · family forms — generous (90 days). Families act on their own clock,
//     and re-minting is a chase email, not a self-serve fix.
//   · family actions — one term (120 days); these ride the class lifecycle.
//   · staff/ops links — short (14 days); they're acted on the same week.
//   · standing subscriptions (calendar feeds) — no expiry, by design: a
//     subscribed calendar that silently dies is worse than a live one.
//
// Backward compatible ON PURPOSE. A token minted before this shipped has no
// issued-at segment, and verifies exactly as it always did — nothing already
// in a family's inbox breaks. Only newly minted links carry a lifetime.
export type TokenLifetime = 'family-form' | 'family-action' | 'staff' | 'never'

const TTL_DAYS: Record<TokenLifetime, number | null> = {
  'family-form': 90,
  'family-action': 120,
  staff: 14,
  never: null,
}

/** Days since the epoch — one integer, stable across timezones. */
function today(): number {
  return Math.floor(Date.now() / 86_400_000)
}

function rawSig(input: string): string {
  return createHmac('sha256', signingSecret()).update(input).digest('hex').slice(0, 32)
}

/**
 * Mint `${issuedDay}~${sig}` for a lifetime-bearing token, or the bare
 * legacy signature when the type never expires. The issued day is inside
 * the signed material, so it can't be edited to extend a link.
 */
export function mintToken(prefix: string, id: string, lifetime: TokenLifetime): string {
  if (TTL_DAYS[lifetime] == null) return rawSig(`${prefix}${id}`)
  const issued = today()
  return `${issued}~${rawSig(`${prefix}${id}:${issued}`)}`
}

/**
 * 'ok' · 'expired' (valid signature, past its lifetime — the caller owes the
 * reader a friendly "this link has aged out" page, never a bare error) ·
 * 'invalid' (forged, truncated, or wrong type).
 */
export function checkToken(
  prefix: string,
  id: string,
  token: string,
  lifetime: TokenLifetime
): 'ok' | 'expired' | 'invalid' {
  if (!token) return 'invalid'
  const eq = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

  const sep = token.indexOf('~')
  if (sep === -1) {
    // Legacy token (no issued-at): verify as before, never expires.
    return eq(token, rawSig(`${prefix}${id}`)) ? 'ok' : 'invalid'
  }
  const issued = Number(token.slice(0, sep))
  const sig = token.slice(sep + 1)
  if (!Number.isInteger(issued)) return 'invalid'
  if (!eq(sig, rawSig(`${prefix}${id}:${issued}`))) return 'invalid'
  const ttl = TTL_DAYS[lifetime]
  if (ttl == null) return 'ok'
  // A clock-skewed future issue date is treated as fresh, not forged — the
  // signature already proved it came from us.
  return today() - issued > ttl ? 'expired' : 'ok'
}
