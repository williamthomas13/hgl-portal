import { supabaseAdmin as supabase } from './supabase-admin'

// PL-395: ONE resolver for the PERSON behind an attribution email. Every
// `*_by` field stores whichever email signed in (profiles for admin/manager,
// instructors for tutors, contacts for school counselors) — surfaces render
// the person's NAME, falling back to the raw email honestly when no record
// knows them. Internal identifiers stay in tooltips/history where already
// present. Uses instructors.name (the internal name), never public_name
// (that's the marketing override — see instructor-editor).

export type StaffNames = Record<string, string> // lowercased email → display name

export async function staffNameMap(): Promise<StaffNames> {
  const map: StaffNames = {}
  const [{ data: contacts }, { data: instructors }, { data: profiles }] = await Promise.all([
    supabase.from('contacts').select('email, first_name, last_name'),
    supabase.from('instructors').select('email, name'),
    supabase.from('profiles').select('email, full_name'),
  ])
  // Later sources win: external school contacts < instructors < profiles.
  for (const r of (contacts ?? []) as { email: string | null; first_name: string | null; last_name: string | null }[]) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
    if (r.email && name) map[r.email.toLowerCase()] = name
  }
  for (const r of (instructors ?? []) as { email: string | null; name: string | null }[]) {
    if (r.email && r.name?.trim()) map[r.email.toLowerCase()] = r.name.trim()
  }
  for (const r of (profiles ?? []) as { email: string | null; full_name: string | null }[]) {
    if (r.email && r.full_name?.trim()) map[r.email.toLowerCase()] = r.full_name.trim()
  }
  return map
}

/** name ?? email — the one render rule. Non-email values ('system',
 *  'family') and unknown addresses pass through unchanged. */
export function staffLabel(map: StaffNames, email: string | null | undefined): string {
  if (!email) return ''
  return map[email.toLowerCase()] ?? email
}
