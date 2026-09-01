import { supabaseAdmin as supabase } from './supabase-admin'

// PL-439: creator-targeted class emails (the collateral nudge, the PL-442
// synap reminder) go to whoever created the class — they made the skip
// decision, they get the doorbell. The creator qualifies only while their
// email still resolves to ACTIVE staff (an admin or manager profile);
// unknown creators (NULL created_by — imports, legacy, pre-PL-439 rows) or
// departed ones fall back to the caller's admin default recipient so the
// alert never goes silently nowhere. The dashboard Needs Attention rows stay
// visible to all admins regardless — the email targets, the row informs.

let staffCache: { at: number; emails: Set<string> } | null = null

async function activeStaffEmails(): Promise<Set<string>> {
  if (!staffCache || Date.now() - staffCache.at > 60_000) {
    const { data } = await supabase
      .from('profiles')
      .select('email, role')
      .in('role', ['admin', 'manager'])
    staffCache = {
      at: Date.now(),
      emails: new Set(
        ((data as { email: string | null }[]) ?? [])
          .map((r) => (r.email ?? '').trim().toLowerCase())
          .filter(Boolean)
      ),
    }
  }
  return staffCache.emails
}

export function clearActiveStaffCache() {
  staffCache = null
}

/** The creator's email when it still belongs to active staff, else null
 *  (caller falls back to its admin default — never silently nobody). */
export async function creatorRecipient(createdBy: string | null | undefined): Promise<string | null> {
  const email = (createdBy ?? '').trim().toLowerCase()
  if (!email) return null
  try {
    const staff = await activeStaffEmails()
    return staff.has(email) ? email : null
  } catch (e) {
    console.error('creator recipient resolve failed — admin default used:', e)
    return null
  }
}
