import { NextResponse } from 'next/server'
import { loadSendLimits } from '../../../utils/send-limits'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { loadContactInfo } from '../../../utils/tutoring-emails'
import { FROM, PERSONAL_FROM, clearFromIdentityCache } from '../../../utils/email'
import { DEFAULT_FOOTER_NAV, DEFAULT_SITE_NAV, loadSiteNav, parseNav } from '../../../utils/site-nav'

// PL-50: the tutoring point-of-contact (name/email/phone in app_settings).
// ADMIN-ONLY both ways — who the contact person is is an ownership decision,
// so the manager role (Kelsie herself) neither sees nor edits this card.
// Reassigning the contact updates the §8 contact block on every parent
// surface and the From identity of the PL-40/41 schedule emails at once.

export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  // PL-177: the sending identities ride along — current effective value
  // (setting override, else the deployed env value) per identity.
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['email_from_info', 'email_from_personal'])
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  return NextResponse.json({
    contact: await loadContactInfo(),
    limits: await loadSendLimits(),
    // PL-478: the editable public menu (defaults when unset).
    siteNav: await loadSiteNav(),
    identities: {
      info: { value: map.email_from_info ?? FROM, overridden: Boolean(map.email_from_info) },
      personal: {
        value: map.email_from_personal ?? PERSONAL_FROM,
        overridden: Boolean(map.email_from_personal),
      },
    },
  })
}

/** "Name <a@b.c>" or a bare address. */
function validFrom(v: string): boolean {
  const m = v.match(/^(?:[^<>]*<)?(\S+@\S+\.\S+?)>?$/)
  return Boolean(m)
}

export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Admin only.' }, { status: 403 })

  let body: {
    name?: string
    email?: string
    phone?: string
    action?: string
    identity?: 'info' | 'personal'
    value?: string
    dailyBrake?: string | number
    monthlyQuota?: string | number
    header?: unknown
    footer?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // PL-177: editing a sending identity is its own action — a plain settings
  // edit with understood consequences (future sends switch immediately; a
  // brand-new domain still needs Resend verification first).
  // PL-469: the sending limits — a campaign brake (NOT a Resend limit) and
  // the plan's monthly quota. Blank clears. Recorded with who changed it.
  if (body.action === 'set_site_nav') {
    // PL-478: the public header/footer lists — validated (label + a
    // site-relative or absolute http(s) URL), stored as JSON.
    const header = parseNav(body.header, DEFAULT_SITE_NAV)
    const footer = parseNav(body.footer, DEFAULT_FOOTER_NAV)
    const now = new Date().toISOString()
    const { error } = await supabase.from('app_settings').upsert([
      { key: 'site_nav', value: JSON.stringify(header), updated_by: caller.email, updated_at: now },
      { key: 'site_footer_nav', value: JSON.stringify(footer), updated_by: caller.email, updated_at: now },
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, siteNav: { header, footer } })
  }

  if (body.action === 'set_send_limits') {
    const parse = (v: unknown, label: string): number | null | 'bad' => {
      const t = String(v ?? '').trim()
      if (t === '') return null
      const n = Number(t)
      return Number.isInteger(n) && n > 0 ? n : 'bad'
    }
    const daily = parse(body.dailyBrake, 'daily')
    const monthly = parse(body.monthlyQuota, 'monthly')
    if (daily === 'bad' || monthly === 'bad') {
      return NextResponse.json({ error: 'Limits are whole numbers greater than zero — or blank for none.' }, { status: 400 })
    }
    const stamp = { updated_at: new Date().toISOString(), updated_by: caller.email }
    const { error } = await supabase.from('app_settings').upsert([
      { key: 'resend_daily_cap', value: daily == null ? '' : String(daily), ...stamp },
      { key: 'resend_monthly_quota', value: monthly == null ? '' : String(monthly), ...stamp },
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, limits: await loadSendLimits() })
  }

  if (body.action === 'set_identity') {
    const identity = body.identity
    const value = (body.value ?? '').trim()
    if (identity !== 'info' && identity !== 'personal') {
      return NextResponse.json({ error: 'Unknown identity.' }, { status: 400 })
    }
    if (!value || !validFrom(value)) {
      return NextResponse.json(
        { error: 'Use "Name <address@domain>" or a bare address@domain.' },
        { status: 400 }
      )
    }
    const { error } = await supabase.from('app_settings').upsert([
      {
        key: identity === 'info' ? 'email_from_info' : 'email_from_personal',
        value,
        updated_at: new Date().toISOString(),
      },
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    clearFromIdentityCache()
    return NextResponse.json({ ok: true })
  }

  const name = body.name?.trim()
  const email = body.email?.trim().toLowerCase()
  const phone = body.phone?.trim()
  if (!name || !email || !phone) {
    return NextResponse.json({ error: 'Name, email, and phone are all required.' }, { status: 400 })
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
  }

  const rows = [
    { key: 'contact_name', value: name },
    { key: 'contact_email', value: email },
    { key: 'contact_phone', value: phone },
  ].map((r) => ({ ...r, updated_at: new Date().toISOString() }))
  const { error } = await supabase.from('app_settings').upsert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
