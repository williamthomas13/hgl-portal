import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionFamily } from '../../../utils/family-gate'
import { suppressEmail } from '../../../utils/campaigns'

// PL-422A: the family portal's "Email preferences" — the signed-in twin of
// the tokenized /unsubscribe path, and the ONLY resubscribe surface. One
// switch: marketing & announcement emails. Semantics stay the machinery's
// own: OFF = the family-level flag + a suppression row for the PARENT's
// address (matching the legacy family-token unsubscribe); ON clears the flag
// and the parent's OWN suppression only — a student who unsubscribed stays
// unsubscribed (PL-280: one leg never silences or re-arms the other).
// Transactional email (registration, schedule, billing) always sends and the
// panel says so.

export async function GET() {
  const family = await sessionFamily()
  if (!family) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const [{ data: fams }, { data: sup }] = await Promise.all([
    supabase.from('families').select('id, marketing_opt_out').in('id', family.familyIds),
    supabase.from('marketing_suppressions').select('email').eq('email', family.email),
  ])
  const marketingOff = (fams ?? []).some((f) => f.marketing_opt_out) || (sup ?? []).length > 0
  return NextResponse.json({ marketingOff })
}

export async function POST(req: Request) {
  const family = await sessionFamily()
  if (!family) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const off = Boolean(body?.marketingOff)
  const { error } = await supabase
    .from('families')
    .update({ marketing_opt_out: off })
    .in('id', family.familyIds)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (off) {
    await suppressEmail(family.email, 'portal-prefs')
  } else {
    const { error: unsupError } = await supabase
      .from('marketing_suppressions')
      .delete()
      .eq('email', family.email)
    if (unsupError) return NextResponse.json({ error: unsupError.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, marketingOff: off })
}
