import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from './supabase-admin'

// Phase 4 account provisioning (docs/PHASE4_SPEC.md §2): passwordless login,
// accounts provisioned implicitly from existing data. Every legitimate user
// already exists in the DB — login is proving you own an email we already
// have. Roles are DERIVED from data, not granted: parent ⇐
// families.parent_email · counselor ⇐ school_counselors.email · instructor ⇐
// classes.instructor_email (or an instructors row) · admin ⇐ ADMIN_EMAILS
// allowlist or an existing admin/manager profile. RLS scopes reads by the JWT
// email claim, so the "active role" only ever decides which view renders —
// switching it grants nothing.

export type PortalRole = 'admin' | 'manager' | 'instructor' | 'counselor' | 'parent'

/** Highest first — used to pick the default view and the profiles.role value. */
export const ROLE_PRIORITY: PortalRole[] = ['admin', 'manager', 'instructor', 'counselor', 'parent']

export function adminAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/** All roles this email holds, derived from current DB state. */
export async function deriveRoles(emailRaw: string): Promise<PortalRole[]> {
  const email = emailRaw.trim().toLowerCase()
  if (!email) return []
  const roles = new Set<PortalRole>()

  if (adminAllowlist().includes(email)) roles.add('admin')

  // ilike with no wildcards = case-insensitive equality.
  const [family, counselor, teaching, instructorRow, profile] = await Promise.all([
    supabaseAdmin.from('families').select('id').ilike('parent_email', email).limit(1),
    supabaseAdmin.from('school_counselors').select('id').ilike('email', email).limit(1),
    supabaseAdmin.from('classes').select('id').ilike('instructor_email', email).limit(1),
    supabaseAdmin.from('instructors').select('id').ilike('email', email).limit(1),
    supabaseAdmin.from('profiles').select('role').ilike('email', email).limit(1),
  ])

  if (family.data?.length) roles.add('parent')
  if (counselor.data?.length) roles.add('counselor')
  if (teaching.data?.length || instructorRow.data?.length) roles.add('instructor')
  const storedRole = profile.data?.[0]?.role
  if (storedRole === 'admin') roles.add('admin')
  if (storedRole === 'manager') roles.add('manager')

  return ROLE_PRIORITY.filter((r) => roles.has(r))
}

/**
 * Lazy provisioning: make sure an auth user exists for this email (the signup
 * trigger creates the profiles row), then keep profiles.role in sync with the
 * top derived role. Stored admin/manager roles are never downgraded here —
 * those are granted by an admin, not derived.
 */
export async function ensureAuthUser(emailRaw: string, roles: PortalRole[]): Promise<void> {
  const email = emailRaw.trim().toLowerCase()

  const { error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  // "already been registered" is the normal case after first login.
  if (createError && createError.code !== 'email_exists') {
    throw new Error(`createUser failed for portal login: ${createError.message}`)
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .ilike('email', email)
    .limit(1)
    .single()
  if (!profile) return
  if (profile.role === 'admin' || profile.role === 'manager') return

  const target = roles.find((r) => r !== 'admin' && r !== 'manager') ?? 'parent'
  if (profile.role !== target) {
    await supabaseAdmin.from('profiles').update({ role: target }).eq('id', profile.id)
  }
}

// ---------------------------------------------------------------------------
// Signed login prefill (#0 "View your registration" → /login with the email
// prefilled, one tap to send the link). Distinct HMAC prefix, as with the
// claim/unsub/addon/resume tokens in lifecycle.ts.
// ---------------------------------------------------------------------------

export function loginPrefillToken(emailRaw: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`login:${emailRaw.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
}

export function verifyLoginPrefillToken(email: string, token: string) {
  const expected = Buffer.from(loginPrefillToken(email))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Only same-site relative paths may be used as post-login redirects. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null
  if (!next.startsWith('/') || next.startsWith('//')) return null
  return next
}
