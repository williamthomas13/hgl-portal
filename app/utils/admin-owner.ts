import { supabaseAdmin as supabase } from './supabase-admin'

// PL-332: "the admin" (owner) = profiles.role='admin' — the derived copy of
// the ADMIN_EMAILS allowlist (portal-auth stamps it on login). Managers may
// adjust their own and other non-admin staff members' notification settings,
// never an admin's; routes that edit notification prefs use these helpers to
// refuse the admin's rows server-side (Phase 3.1: screens can hide, the
// server refuses).

export type AdminOwner = { email: string; name: string | null }

export async function adminOwners(): Promise<AdminOwner[]> {
  const { data } = await supabase.from('profiles').select('email, full_name').eq('role', 'admin')
  return ((data as { email: string | null; full_name: string | null }[]) ?? [])
    .filter((p) => p.email)
    .map((p) => ({ email: (p.email as string).toLowerCase(), name: p.full_name ?? null }))
}

/** The owner record for an email, or null when it isn't an admin's. */
export function ownerFor(owners: AdminOwner[], email: string | null | undefined): AdminOwner | null {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return null
  return owners.find((o) => o.email === e) ?? null
}

/** The PL-332 refusal line, spoken with the owner's own name. */
export function ownerRefusal(owner: AdminOwner): string {
  return `Only ${owner.name ?? owner.email} can change an owner's notifications.`
}
