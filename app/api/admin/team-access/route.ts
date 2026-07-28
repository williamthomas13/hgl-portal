import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { adminAllowlist, deriveRoles } from '../../../utils/portal-auth'
import { escapeLike } from '../../../utils/like-escape'

// PL-213: the Team access panel's API — admin-only (managers 403; the panel
// never renders for them). Managers are the ONLY grantable role here: admin
// comes exclusively from the ADMIN_EMAILS env allowlist (no admin-granting
// UI = no privilege-escalation path), and every other role derives from data
// (tutors panel, counselor affiliations, family records). Every change
// writes a team_access_audit line.

export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const [{ data: elevated }, { data: audit }] = await Promise.all([
    supabase
      .from('profiles')
      .select('email, role, created_at')
      .in('role', ['admin', 'manager'])
      .order('role')
      .order('email'),
    supabase
      .from('team_access_audit')
      .select('at, actor_email, action, target_email, detail')
      .order('at', { ascending: false })
      .limit(20),
  ])

  const allowlist = adminAllowlist()
  return NextResponse.json({
    profiles: (elevated ?? []).map((p) => ({
      email: p.email,
      role: p.role,
      allowlisted: allowlist.includes((p.email ?? '').toLowerCase()),
    })),
    // Allowlisted admins who have never logged in still belong on the list —
    // the env var is the authority, not the profiles table.
    allowlistOnly: allowlist.filter(
      (a) => !(elevated ?? []).some((p) => (p.email ?? '').toLowerCase() === a)
    ),
    audit: audit ?? [],
  })
}

export async function POST(request: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const action = body.action as 'grant' | 'revoke'
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!email || !['grant', 'revoke'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (adminAllowlist().includes(email)) {
    return NextResponse.json(
      { error: 'That address is an admin via the ADMIN_EMAILS allowlist — manage it in the environment settings, not here.' },
      { status: 400 }
    )
  }

  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, email, role')
    .ilike('email', escapeLike(email))
    .limit(1)
  let profile = profileRows?.[0] ?? null
  if (profile?.role === 'admin') {
    return NextResponse.json({ error: 'Admins are managed via the ADMIN_EMAILS allowlist.' }, { status: 400 })
  }

  if (action === 'grant') {
    if (profile?.role === 'manager') {
      return NextResponse.json({ error: `${email} is already a manager.` }, { status: 400 })
    }
    // "Any known email": the portal must already know this person somewhere —
    // a profile, an instructor, a school contact, or a family. Managers are
    // real teammates, not arbitrary addresses.
    if (!profile) {
      const [ins, contact, fam] = await Promise.all([
        supabase.from('instructors').select('id').ilike('email', escapeLike(email)).limit(1),
        supabase.from('contacts').select('id').ilike('email', escapeLike(email)).limit(1),
        supabase.from('families').select('id').ilike('parent_email', escapeLike(email)).limit(1),
      ])
      if (!ins.data?.length && !contact.data?.length && !fam.data?.length) {
        return NextResponse.json(
          { error: `${email} isn't anywhere in the portal yet — add them as a tutor, contact, or family first so access attaches to a real record.` },
          { status: 400 }
        )
      }
      // Provision the auth user (the signup trigger creates the profiles row).
      const { error: createErr } = await supabase.auth.admin.createUser({ email, email_confirm: true })
      if (createErr && createErr.code !== 'email_exists') {
        return NextResponse.json({ error: `Couldn't provision the account: ${createErr.message}` }, { status: 500 })
      }
      const { data: fresh } = await supabase
        .from('profiles')
        .select('id, email, role')
        .ilike('email', escapeLike(email))
        .limit(1)
      profile = fresh?.[0] ?? null
      if (!profile) {
        return NextResponse.json({ error: 'Account provisioned but no profile appeared — try again.' }, { status: 500 })
      }
    }
    const { error } = await supabase.from('profiles').update({ role: 'manager' }).eq('id', profile.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await supabase.from('team_access_audit').insert({
      actor_email: caller.email,
      action: 'grant_manager',
      target_email: email,
      detail: `manager granted (was ${profileRows?.[0]?.role ?? 'no profile'})`,
    })
    return NextResponse.json({ ok: true })
  }

  // revoke
  if (!profile || profile.role !== 'manager') {
    return NextResponse.json({ error: `${email} isn't a manager.` }, { status: 400 })
  }
  // Fall back to what the data says they are (parent/counselor/instructor) —
  // same rule as login provisioning.
  const roles = await deriveRoles(email)
  const target = roles.find((r) => r !== 'admin' && r !== 'manager') ?? 'parent'
  const { error } = await supabase.from('profiles').update({ role: target }).eq('id', profile.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await supabase.from('team_access_audit').insert({
    actor_email: caller.email,
    action: 'revoke_manager',
    target_email: email,
    detail: `manager revoked → ${target}`,
  })
  return NextResponse.json({ ok: true, demotedTo: target })
}
