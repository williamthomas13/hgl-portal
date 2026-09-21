import { supabaseAdmin as supabase } from './supabase-admin'

// PL-477/484: ONE Compass subscription path — the /compass form, the embed,
// and the interest-list / register-page opt-in checkbox (PL-484) all land
// here: same consent record, same linking, same (future) welcome. Never
// sends anything itself.
export async function subscribeCompass(opts: {
  email: string
  firstName?: string | null
  role?: 'parent' | 'student' | null
  gradYear?: string | null
  source: string
}): Promise<{ ok: boolean; error?: string; resubscribed?: boolean }> {
  const email = opts.email.trim().toLowerCase()
  const like = email.replace(/[%_]/g, '\\$&')
  const [{ data: fam }, { data: lead }, { data: supp }] = await Promise.all([
    supabase.from('families').select('id').ilike('parent_email', like).limit(1).maybeSingle(),
    supabase.from('leads').select('id').ilike('contact_email', like).limit(1).maybeSingle(),
    supabase.from('marketing_suppressions').select('email').eq('email', email).maybeSingle(),
  ])
  const now = new Date().toISOString()
  const resubscribed = Boolean(supp)
  // An explicit re-signup lifts the person's OWN suppression (their action).
  if (resubscribed) await supabase.from('marketing_suppressions').delete().eq('email', email)
  const src = opts.source
  const { error } = await supabase.from('marketing_subscribers').upsert(
    {
      email,
      first_name: opts.firstName ?? null,
      role: opts.role ?? null,
      grad_year: opts.gradYear ?? null,
      source: resubscribed ? 'compass-resubscribed' : src.startsWith('sqsp') || src.startsWith('embed') ? `embed:${src.replace(/^(sqsp|embed):/, '')}` : src,
      consented_at: now,
      original_opt_in_at: now,
      family_id: fam?.id ?? null,
      lead_id: fam ? null : (lead?.id ?? null),
      updated_at: now,
    },
    { onConflict: 'email', ignoreDuplicates: false }
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true, resubscribed }
}
