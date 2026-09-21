import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { FORM_CORS_HEADERS } from '../../utils/embed-forms'
import { EMAIL_RE, ipThrottled, str } from '../../utils/public-forms'

// PL-477: College Prep Compass signup → marketing_subscribers. Consent is
// the form's own text (recorded as consented_at); the address is LINKED to
// an existing family/lead by email, never duplicated; an explicit re-signup
// by a previously-unsubscribed address lifts that person's OWN suppression
// (their action, recorded as source 'compass-resubscribed'). No welcome
// email is sent here — the Compass delivery/welcome content is Scarlett's
// (STOPPED in the ship note); nothing sends until a campaign targets
// subscribers.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: FORM_CORS_HEADERS })
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: FORM_CORS_HEADERS })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (str(body.company)) return json({ ok: true })
  if (ipThrottled(req)) return json({ error: 'Too many requests — please try again in a few minutes.' }, 429)
  const email = str(body.email, 200)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400)
  const firstName = str(body.firstName, 100)
  const roleRaw = str(body.role, 20)?.toLowerCase()
  const role = roleRaw === 'parent' || roleRaw === 'student' ? roleRaw : null
  const gradYear = str(body.gradYear, 10)
  const src = str(body.source, 100) ?? 'compass'

  const [{ data: fam }, { data: lead }, { data: supp }] = await Promise.all([
    supabase.from('families').select('id').ilike('parent_email', email.replace(/[%_]/g, '\\$&')).limit(1).maybeSingle(),
    supabase.from('leads').select('id').ilike('contact_email', email.replace(/[%_]/g, '\\$&')).limit(1).maybeSingle(),
    supabase.from('marketing_suppressions').select('email').eq('email', email).maybeSingle(),
  ])
  const now = new Date().toISOString()
  const resubscribed = Boolean(supp)
  if (resubscribed) await supabase.from('marketing_suppressions').delete().eq('email', email)
  const { error } = await supabase.from('marketing_subscribers').upsert(
    {
      email,
      first_name: firstName,
      role,
      grad_year: gradYear,
      source: resubscribed ? 'compass-resubscribed' : src.startsWith('sqsp') || src.startsWith('embed') ? `embed:${src.replace(/^(sqsp|embed):/, '')}` : 'compass',
      consented_at: now,
      original_opt_in_at: now,
      family_id: fam?.id ?? null,
      lead_id: fam ? null : (lead?.id ?? null),
      updated_at: now,
    },
    { onConflict: 'email', ignoreDuplicates: false }
  )
  if (error) {
    console.error('compass upsert failed:', error.message)
    return json({ error: 'That did not save — try again?' }, 500)
  }
  return json({ ok: true })
}
