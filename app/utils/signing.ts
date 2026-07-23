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
