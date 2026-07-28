// PL-158: PostgREST's like/ilike treat % and _ INSIDE THE OPERAND as
// wildcards — so an email that legally contains one of them (both are valid
// in an SMTP local part) matches a broader set of rows than the one it
// names. Everywhere we look a record up by a user-supplied identifier with
// ilike (kept for its case-insensitivity), the operand goes through here
// first: wildcards become literals, matching stays case-insensitive, and
// the query means "this exact address" again. Verified against the live
// API: unescaped 'a-%@x.com' matched three families; escaped, exactly one.
//
// LEAF on purpose (no imports) — client components use it too.

/** Escape like/ilike wildcard characters so the operand matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => '\\' + m)
}
