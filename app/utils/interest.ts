import { createHmac, timingSafeEqual } from 'crypto'
import { signingSecret } from './signing'
import { emailBaseUrl } from './base-url'

// PL-484: the interest list's OWN unsubscribe (separate from the Compass /
// marketing suppression — a person can leave the interest list and keep the
// Compass, or vice versa). House HMAC pattern, GET-safe page.
function sig(email: string): string {
  return createHmac('sha256', signingSecret()).update(`interest-unsub:${email.toLowerCase()}`).digest('hex').slice(0, 32)
}
export function interestUnsubscribeUrl(email: string): string {
  const e = email.trim().toLowerCase()
  return `${emailBaseUrl()}/interest/unsubscribe?e=${encodeURIComponent(e)}&t=${sig(e)}`
}
export function verifyInterestUnsubscribe(email: string | null, token: string | null): string | null {
  if (!email || !token) return null
  const e = email.trim().toLowerCase()
  const want = sig(e)
  if (want.length !== token.length) return null
  return timingSafeEqual(Buffer.from(want), Buffer.from(token)) ? e : null
}
