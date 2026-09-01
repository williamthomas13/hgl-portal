// PL-442A: cutoff-vs-deadline ordering — the ONE validation source for the
// wizard's "Next needs:" machinery, the Edit-class-details inline edits, and
// the deadline's server route (class-min-enrollment). Client-safe leaf.
//
// The sign-up cutoff (registration_close_date; blank = the first session —
// lifecycle's registrationCloseFor rule) is when the register page stops
// taking sign-ups; the registration deadline (enrollment_deadline) is the
// commit-by date decisions run on. A cutoff BEFORE the deadline is nonsense
// — sign-ups would close while families could still be deciding — and the
// blank-cutoff default is held to the same rule: a deadline after the first
// session with no cutoff set closes sign-ups at the first session, before
// the deadline ever arrives.

export function cutoffDeadlineError(opts: {
  enrollmentDeadline: string | null | undefined
  registrationClose: string | null | undefined
  /** Earliest session date when known (wizard step 3+, saved classes). */
  firstSession?: string | null
}): string | null {
  const deadline = (opts.enrollmentDeadline ?? '').slice(0, 10)
  const close = (opts.registrationClose ?? '').slice(0, 10)
  if (!deadline) return null
  if (close) {
    if (close < deadline) {
      return "the sign-up cutoff can't be before the registration deadline — families could still be deciding when sign-ups close"
    }
    return null
  }
  const first = (opts.firstSession ?? '').slice(0, 10)
  if (first && first < deadline) {
    return 'the registration deadline is after the first session — with no sign-up cutoff set, sign-ups close at the first session, before the deadline arrives'
  }
  return null
}
